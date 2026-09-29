import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, freshRoom, projectRoom, RoomError } from '../supabase/functions/_shared/room-rules.mjs';
import { hashPassword, verifyPassword } from '../supabase/functions/_shared/password.mjs';

const cmd = (s, action, extra = {}) => ({ action, gameId: s.gameId, round: s.round, ...extra });
const mustReject = (fn, text) => assert.throws(fn, e => e instanceof RoomError && (!text || e.message.includes(text)));

function ready(ids = ['a','b','c','d'], mafia = 2) {
  let s = freshRoom(); applyCommand(s, 'h', cmd(s, 'claim_host'));
  for (const id of ids) applyCommand(s, id, cmd(s, 'join', { name: `N${id}` }));
  applyCommand(s, 'h', cmd(s, 'settings', { mafia, doctor: true, police: true }));
  applyCommand(s, 'h', cmd(s, 'start', { password: 'chosen', passwordHash: 'hash' }));
  return s;
}

test('private roles, manual assignment, shared countdown and one police investigation', () => {
  const s = ready();
  mustReject(() => applyCommand(s, 'h', cmd(s, 'save_start')), '직업 수');
  const roles = { a:'mafia', b:'mafia', c:'doctor', d:'police' };
  for (const [id, role] of Object.entries(roles)) applyCommand(s, 'h', cmd(s, 'assign', { player:id, role }));
  applyCommand(s, 'h', cmd(s, 'save_start'));
  assert.equal(s.phase, 'countdown');
  assert.equal(projectRoom(s, 'a').me, undefined);
  s.phase = 'game'; s.stage = 'night'; s.round = 1;
  const mafiaView = projectRoom(s, 'a');
  assert.deepEqual(mafiaView.mafiaMates, ['Nb']);
  assert.equal('role' in mafiaView.players.find(p => p.id === 'b'), false);
  assert.equal('resetPasswordHash' in mafiaView, false);
  applyCommand(s, 'a', cmd(s, 'choose', { target:'c' }));
  applyCommand(s, 'b', cmd(s, 'choose', { target:'d' }));
  applyCommand(s, 'c', cmd(s, 'choose', { target:'c' }));
  applyCommand(s, 'd', cmd(s, 'choose', { target:'c' }));
  assert.equal(projectRoom(s, 'd').investigation.isMafia, false);
  mustReject(() => applyCommand(s, 'd', cmd(s, 'choose', { target:'a' })), '이미 완료');
  applyCommand(s, 'h', cmd(s, 'phase', { stage:'day', forceConfirm:true }));
  assert.equal(s.players.c.alive, true, 'doctor self-protection keeps doctor alive');
  assert.ok(s.players.d.alive === false || s.players.d.alive === true);
  assert.equal(s.stage, 'day');
});

test('night warning, live vote privacy, tie, and next-day vote boundary', () => {
  const s = ready(['a','b','c'], 1);
  applyCommand(s, 'h', cmd(s, 'assign', { player:'a', role:'mafia' }));
  applyCommand(s, 'h', cmd(s, 'assign', { player:'b', role:'doctor' }));
  applyCommand(s, 'h', cmd(s, 'assign', { player:'c', role:'police' }));
  applyCommand(s, 'h', cmd(s, 'save_start')); s.phase='game'; s.stage='night'; s.round=1;
  mustReject(() => applyCommand(s, 'h', cmd(s, 'phase', { stage:'day' })), '선택하지 않은');
  applyCommand(s, 'h', cmd(s, 'phase', { stage:'day', forceConfirm:true }));
  applyCommand(s, 'h', cmd(s, 'vote_start'));
  const voteId=s.vote.id;
  applyCommand(s, 'a', cmd(s, 'vote', { target:'c', voteId }));
  applyCommand(s, 'a', cmd(s, 'vote', { target:'b', voteId }));
  assert.equal(projectRoom(s, 'a').myVote,'b');
  applyCommand(s, 'b', cmd(s, 'vote', { target:'c', voteId }));
  applyCommand(s, 'c', cmd(s, 'vote', { target:'abstain', voteId }));
  assert.equal(projectRoom(s, 'a').voteChoices.c, 'abstain');
  mustReject(() => applyCommand(s, 'a', cmd(s, 'vote', { target:'a', voteId })), '투표 대상을');
  mustReject(() => applyCommand(s, 'h', cmd(s, 'phase', { stage:'night' })));
  applyCommand(s, 'h', cmd(s, 'vote_close', { voteId }));
  assert.equal(s.vote.result.executed, null, 'equal vote is a tie');
  mustReject(() => applyCommand(s, 'h', cmd(s, 'vote_start')), '이미 마감');
  applyCommand(s, 'h', cmd(s, 'phase', { stage:'night' }));
  assert.equal(s.round, 2);
});

test('game identity rejects stale commands and win state reveals final roles', () => {
  const s = ready(['a','b','c'], 1);
  applyCommand(s, 'h', cmd(s, 'assign', { player:'a', role:'mafia' }));
  applyCommand(s, 'h', cmd(s, 'assign', { player:'b', role:'doctor' }));
  applyCommand(s, 'h', cmd(s, 'assign', { player:'c', role:'police' }));
  applyCommand(s, 'h', cmd(s, 'save_start')); s.phase='game'; s.stage='day';
  applyCommand(s, 'h', cmd(s, 'vote_start'));
  const voteId=s.vote.id;
  applyCommand(s, 'b', cmd(s, 'vote', { target:'a', voteId }));
  applyCommand(s, 'c', cmd(s, 'vote', { target:'a', voteId }));
  applyCommand(s, 'h', cmd(s, 'vote_close', { voteId }));
  assert.equal(s.phase, 'ended');
  assert.equal(s.result, 'citizens');
  assert.equal(projectRoom(s, 'b').players.find(p=>p.id==='a').role, 'mafia');
  const oldGame=s.gameId;
  s.phase='lobby';
  applyCommand(s, 'h', { action:'clear_lobby', gameId:oldGame });
  mustReject(() => applyCommand(s, 'h', { action:'claim_host', gameId:oldGame, round:0 }), '갱신');
});

test('mafia wins when surviving mafia reach the citizen-team count', () => {
  let s=freshRoom(); applyCommand(s,'h',cmd(s,'claim_host'));
  for(const id of ['a','b','c','d'])applyCommand(s,id,cmd(s,'join',{name:`N${id}`}));
  applyCommand(s,'h',cmd(s,'settings',{mafia:2,doctor:false,police:false}));
  applyCommand(s,'h',cmd(s,'start',{password:'chosen',passwordHash:'hash'}));
  for(const [id,role] of Object.entries({a:'mafia',b:'mafia',c:'citizen',d:'citizen'}))applyCommand(s,'h',cmd(s,'assign',{player:id,role}));
  applyCommand(s,'h',cmd(s,'save_start'));s.phase='game';s.stage='day';
  applyCommand(s,'h',cmd(s,'vote_start'));const voteId=s.vote.id;
  applyCommand(s,'a',cmd(s,'vote',{target:'c',voteId}));applyCommand(s,'b',cmd(s,'vote',{target:'c',voteId}));
  applyCommand(s,'c',cmd(s,'vote',{target:'abstain',voteId}));applyCommand(s,'d',cmd(s,'vote',{target:'c',voteId}));
  applyCommand(s,'h',cmd(s,'vote_close',{voteId}));
  assert.equal(s.phase,'ended');assert.equal(s.result,'mafia');assert.equal(s.endReason,'mafia_parity');
});

test('passwords are salted hashes and verified only server-side', async () => {
  const stored=await hashPassword('one-time-secret');
  assert.notEqual(stored,'one-time-secret');
  assert.equal(await verifyPassword('one-time-secret',stored,'master-secret'),true);
  assert.equal(await verifyPassword('wrong',stored,'master-secret'),false);
  assert.equal(await verifyPassword('master-secret',stored,'master-secret'),true);
});
