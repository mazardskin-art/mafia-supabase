export const ROLES = ['mafia', 'doctor', 'police', 'citizen'];
export class RoomError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function freshRoom() {
  return { gameId: crypto.randomUUID(), host: null, settings: { mafia: 1, doctor: true, police: true }, resetPasswordHash: null, phase: 'lobby', stage: 'day', round: 0, countdownAt: null, players: {}, notice: '진행자 또는 플레이어를 선택해 주세요.', vote: null, result: null, endReason: null };
}
export function counts(s) { const c = { mafia: 0, doctor: 0, police: 0, citizen: 0 }; for (const p of Object.values(s.players)) c[p.role]++; return c; }
function endCheck(s) {
  let m = 0, o = 0; for (const p of Object.values(s.players)) if (p.alive) p.role === 'mafia' ? m++ : o++;
  if (!m) { s.phase = 'ended'; s.result = 'citizens'; s.endReason = 'mafia_eliminated'; s.notice = '시민 팀이 승리했습니다.'; }
  else if (m >= o) { s.phase = 'ended'; s.result = 'mafia'; s.endReason = 'mafia_parity'; s.notice = '마피아 팀이 승리했습니다.'; }
}
const need = (ok, msg, status = 400) => { if (!ok) throw new RoomError(msg, status); };
export function applyCommand(s, uid, cmd, now = Date.now()) {
  const host = uid === s.host?.uid, p = s.players[uid];
  need(cmd.gameId === s.gameId && (cmd.round === undefined || Number(cmd.round) === Number(s.round)), '화면이 갱신되었습니다. 다시 확인해 주세요.', 409);
  if (['claim_host','join'].includes(cmd.action)) need(!host && !p, '이미 방에 입장했습니다.');
  switch (cmd.action) {
    case 'claim_host': need(!s.host && s.phase === 'lobby', '진행자가 이미 있거나 게임이 진행 중입니다.'); s.host = { uid, name: '진행자' }; s.notice = '플레이어가 입장하기를 기다리고 있습니다.'; break;
    case 'join': {
      need(s.phase === 'lobby' && s.host, '지금은 입장할 수 없습니다.'); const name = String(cmd.name || '').trim();
      need(name && [...name].length <= 12, '닉네임은 1~12자로 입력해 주세요.'); need(!Object.values(s.players).some(x => x.name.toLocaleLowerCase() === name.toLocaleLowerCase()), '이미 사용 중인 닉네임입니다.');
      s.players[uid] = { name, role: 'citizen', alive: true }; s.notice = `${name}님이 입장했습니다.`; break;
    }
    case 'settings': need(host && s.phase === 'lobby', '대기실 진행자만 설정할 수 있습니다.'); need(Number.isInteger(+cmd.mafia) && +cmd.mafia >= 1 && +cmd.mafia <= 100, '마피아 수를 확인해 주세요.'); s.settings = { mafia: +cmd.mafia, doctor: !!cmd.doctor, police: !!cmd.police }; break;
    case 'start': need(host && s.phase === 'lobby', '대기실 진행자만 시작할 수 있습니다.'); need(typeof cmd.password === 'string' && cmd.password.trim(), '비밀번호를 입력해 주세요.'); need(Object.keys(s.players).length >= 3, '플레이어 3명부터 시작할 수 있습니다.'); need(s.settings.mafia + +s.settings.doctor + +s.settings.police <= Object.keys(s.players).length, '직업 수를 확인해 주세요.'); s.resetPasswordHash = cmd.passwordHash; s.phase = 'assign'; for (const x of Object.values(s.players)) { x.role = 'citizen'; x.alive = true; delete x.nightTarget; delete x.investigation; } s.notice = '각 플레이어의 직업을 지정해 주세요.'; break;
    case 'assign': need(host && s.phase === 'assign', '직업 지정 단계가 아닙니다.'); need(s.players[cmd.player] && ROLES.includes(cmd.role), '직업 또는 플레이어를 확인해 주세요.'); s.players[cmd.player].role = cmd.role; break;
    case 'save_start': { need(host && s.phase === 'assign', '직업 지정 단계가 아닙니다.'); const c = counts(s); need(c.mafia === s.settings.mafia && c.doctor === +s.settings.doctor && c.police === +s.settings.police, '설정한 직업 수와 지정 인원이 일치하지 않습니다.'); s.phase = 'countdown'; s.countdownAt = now + 3000; s.stage = 'day'; s.round = 0; s.notice = '역할 공개까지 잠시 기다려 주세요.'; break; }
    case 'phase': {
      need(host && s.phase === 'game', '진행자만 게임 단계를 바꿀 수 있습니다.');
      if (s.stage === 'day' && cmd.stage === 'night') { need(s.vote?.result && s.vote.round === s.round, '먼저 이 낮 투표를 마감해 주세요.'); s.stage = 'night'; s.round++; for (const x of Object.values(s.players)) if (x.role === 'police') delete x.investigation; s.notice = '밤이 되었습니다.'; break; }
      need(s.stage === 'night' && cmd.stage === 'day', '단계를 확인해 주세요.');
      const unselected = Object.values(s.players).some(x => x.alive && ['mafia','doctor','police'].includes(x.role) && !x.nightTarget && !(x.role === 'police' && x.investigation?.round === s.round));
      need(!unselected || cmd.forceConfirm, '선택하지 않은 역할이 있습니다. 제출된 선택으로 낮을 시작할까요?', 409);
      const distinct = [...new Set(Object.values(s.players).filter(x => x.alive && x.role === 'mafia' && x.nightTarget).map(x => x.nightTarget))]; const target = distinct.length === 1 ? distinct[0] : distinct.length ? distinct[Math.floor(Math.random() * distinct.length)] : null;
      const doctor = Object.values(s.players).find(x => x.alive && x.role === 'doctor')?.nightTarget; let dead = null;
      if (target && target !== doctor && s.players[target]?.alive) { s.players[target].alive = false; dead = s.players[target].name; }
      for (const x of Object.values(s.players)) delete x.nightTarget; s.stage = 'day'; s.notice = dead ? `${dead}님이 밤에 사망했습니다.` : '밤 사이 사망자가 없습니다.'; endCheck(s); break;
    }
    case 'choose': {
      need(p && p.alive && s.phase === 'game' && s.stage === 'night' && ['mafia','doctor','police'].includes(p.role), '밤에 선택할 수 없습니다.'); const t = s.players[cmd.target]; need(t?.alive, '대상을 확인해 주세요.');
      if (p.role === 'mafia') need(t.role !== 'mafia', '마피아는 동료를 선택할 수 없습니다.');
      if (p.role === 'police') { need(t !== p, '자신은 조사할 수 없습니다.'); need(p.investigation?.round !== s.round, '이번 밤 조사는 이미 완료했습니다.'); p.investigation = { round: s.round, target: cmd.target, isMafia: t.role === 'mafia' }; }
      p.nightTarget = cmd.target; break;
    }
    case 'vote_start': need(host && s.phase === 'game' && s.stage === 'day', '낮에만 투표를 시작할 수 있습니다.'); need(!(s.vote?.round === s.round), '이번 낮 투표는 이미 마감했습니다.'); s.phase = 'voting'; s.vote = { id: crypto.randomUUID(), round: s.round, choices: {} }; s.notice = '투표 중입니다.'; break;
    case 'vote': need(p && p.alive && s.phase === 'voting' && s.vote?.id === cmd.voteId, '투표가 진행 중이 아닙니다.'); need(cmd.target === 'abstain' || (s.players[cmd.target]?.alive && cmd.target !== uid), '투표 대상을 확인해 주세요.'); s.vote.choices[uid] = cmd.target; break;
    case 'vote_close': {
      need(host && s.phase === 'voting' && s.vote?.id === cmd.voteId, '마감할 투표가 없습니다.'); const tally = {}; for (const t of Object.values(s.vote.choices)) if (t !== 'abstain') tally[t] = (tally[t] || 0) + 1;
      const max = Math.max(0, ...Object.values(tally)), leaders = Object.keys(tally).filter(k => tally[k] === max); const executed = max && leaders.length === 1 ? leaders[0] : null; if (executed) s.players[executed].alive = false;
      const named = {}; for (const [id,n] of Object.entries(tally)) named[id] = { name: s.players[id]?.name, votes: n }; s.vote.result = { tally: named, executed, executedName: executed ? s.players[executed].name : null }; s.phase = 'game'; s.notice = executed ? `${s.players[executed].name}님이 투표로 처형되었습니다.` : '동률 또는 유효한 표가 없어 처형되지 않았습니다.'; endCheck(s); break;
    }
    case 'leave': need(s.phase === 'lobby' && (host || p), '대기실에서만 나갈 수 있습니다.'); if (host) s.host = null; else delete s.players[uid]; s.notice = host ? '진행자가 퇴장했습니다.' : `${p.name}님이 퇴장했습니다.`; break;
    case 'clear_lobby': need(s.phase === 'lobby', '진행 중인 게임에서는 대기실을 비울 수 없습니다.'); s.gameId = crypto.randomUUID(); s.host = null; s.players = {}; s.notice = '대기실을 비웠습니다.'; break;
    case 'reset': need(cmd.passwordAuthorized, '비밀번호를 확인해 주세요.'); s.gameId = crypto.randomUUID(); s.host = null; s.players = {}; s.resetPasswordHash = cmd.masterHash; s.phase = 'lobby'; s.stage = 'day'; s.round = 0; s.countdownAt = null; s.vote = null; s.result = null; s.endReason = null; s.notice = '새 게임 대기실입니다.'; break;
    default: throw new RoomError('알 수 없는 요청입니다.');
  }
  return s;
}
export function projectRoom(s, uid, onlineIds = []) {
  const host = uid === s.host?.uid, me = s.players[uid]; const players = Object.entries(s.players).map(([id,p]) => ({ id, name:p.name, alive:p.alive, online:onlineIds.includes(id), ...(host || s.phase === 'ended' ? { role:p.role } : {}) }));
  const serverNow=Date.now();
  const v = { gameId:s.gameId, version:s.version||0, serverNow, host:s.host?{ id:s.host.uid, name:'진행자', online:onlineIds.includes(s.host.uid) }:null, settings:s.settings, phase:s.phase, stage:s.stage, round:s.round, countdownAt:s.countdownAt, countdownRemaining:s.countdownAt ? Math.max(0,(s.countdownAt-serverNow)/1000) : null, players, notice:s.notice, result:s.result, endReason:s.endReason, isHost:host, participant:!!me, authenticated:host||!!me };
  if (me && ['game','voting','ended'].includes(s.phase)) { v.me={id:uid,role:me.role,alive:me.alive}; if(me.role==='mafia') v.mafiaMates=Object.values(s.players).filter(x=>x.role==='mafia'&&x!==me).map(x=>x.name); v.allowedTargets=Object.entries(s.players).filter(([id,x])=>x.alive&&((me.role==='mafia'&&x.role!=='mafia')||me.role==='doctor'||(me.role==='police'&&id!==uid))).map(([id])=>id); if(me.investigation)v.investigation=me.investigation; if(me.nightTarget)v.myNightTarget=me.nightTarget; if(s.vote?.choices[uid])v.myVote=s.vote.choices[uid]; }
  if(host){v.counts=counts(s);v.nightActions=Object.entries(s.players).filter(([,p])=>['mafia','doctor','police'].includes(p.role)&&p.alive).map(([id,p])=>({id,name:p.name,role:p.role,target:p.nightTarget||null,done:!!p.nightTarget}));if(s.phase==='assign')v.assignments=Object.fromEntries(Object.entries(s.players).map(([id,p])=>[id,p.role]));}
  if(s.vote){v.voteRound=s.vote.round;if(s.vote.result)v.voteResult=s.vote.result;if(s.phase==='voting'){v.voteInfo={id:s.vote.id,submitted:Object.keys(s.vote.choices).length,eligible:Object.values(s.players).filter(p=>p.alive).length};v.voteChoices=s.vote.choices;}}
  return v;
}
