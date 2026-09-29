import { createClient } from '@supabase/supabase-js';
import { applyCommand, projectRoom, RoomError } from '../_shared/room-rules.mjs';
import { hashPassword, verifyPassword } from '../_shared/password.mjs';

const url = Deno.env.get('SUPABASE_URL')!;
const secret = Deno.env.get('MAFIA_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const master = Deno.env.get('MAFIA_MASTER_PASSWORD') || '';
const origin = Deno.env.get('MAFIA_ALLOWED_ORIGIN') || '*';
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

async function room(): Promise<{ version: number; state: any }> {
  const { data, error } = await admin.from('mafia_room_state').select('version,state').eq('room_id', 'main').single();
  if (error || !data) throw new Error('게임방 상태를 불러오지 못했습니다.');
  return { version: Number(data.version), state: data.state };
}
async function commit(version: number, state: any) {
  const members = [state.host?.uid, ...Object.keys(state.players || {})].filter(Boolean);
  const { data, error } = await admin.rpc('commit_mafia_room', { p_expected_version: version, p_next_state: state, p_member_ids: members });
  if (error) throw error;
  return Number(data);
}
async function publishRevision(version: number) {
  const channel = admin.channel('mafia-room:main', { config: { private: true } });
  try { await channel.send({ type: 'broadcast', event: 'revision', payload: { revision: version } }); }
  catch { /* committed state is returned; reconnect/manual refresh repairs delivery */ }
  finally { try { await admin.removeChannel(channel); } catch { /* best effort cleanup */ } }
}
async function maybeCountdown(snapshot: Awaited<ReturnType<typeof room>>) {
  if (snapshot.state.phase !== 'countdown' || Number(snapshot.state.countdownAt) > Date.now()) return snapshot;
  const next = structuredClone(snapshot.state); next.phase = 'game'; next.countdownAt = null; next.notice = '역할을 확인하세요.';
  try { const version = await commit(snapshot.version, next); next.version = version; await publishRevision(version); return { version, state: next }; }
  catch { return await room(); }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return response({ error: 'POST 요청만 지원합니다.' }, 405);
  const authHeader = req.headers.get('Authorization') || '';
  const bearer = authHeader.replace(/^Bearer\s+/i, '');
  if (!bearer || !secret) return response({ error: '로그인이 필요합니다.' }, 401);
  const { data: authData, error: authError } = await admin.auth.getUser(bearer);
  if (authError || !authData.user) return response({ error: '로그인이 만료되었습니다.' }, 401);
  const uid = authData.user.id;
  let body: any;
  try { body = await req.json(); } catch { return response({ error: '요청 형식을 확인해 주세요.' }, 400); }
  try {
    if (body.action === 'state') {
      const snapshot = await maybeCountdown(await room()); snapshot.state.version = snapshot.version;
      return response(projectRoom(snapshot.state, uid));
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const snapshot = await room(); const s = structuredClone(snapshot.state);
      if (body.action === 'start') {
        if (typeof body.password !== 'string' || !body.password.trim()) throw new RoomError('비밀번호를 입력해 주세요.');
        body.passwordHash = await hashPassword(body.password);
      }
      if (body.action === 'reset') {
        if (!master) throw new RoomError('서버 초기화 비밀번호가 설정되지 않았습니다.', 503);
        const valid = await verifyPassword(body.password, s.resetPasswordHash, master);
        if (!valid) throw new RoomError('비밀번호를 확인해 주세요.');
        body.passwordAuthorized = true; body.masterHash = await hashPassword(master);
      }
      applyCommand(s, uid, body);
      try {
        const version = await commit(snapshot.version, s); s.version = version;
        await publishRevision(version);
        return response({ ok: true, credential: undefined, state: projectRoom(s, uid) });
      } catch (e) {
        if (e?.code !== '40001' && !String(e?.message || '').includes('STALE_VERSION')) throw e;
      }
    }
    return response({ error: '다른 동작이 먼저 반영되었습니다. 상태를 새로고침하고 다시 시도해 주세요.' }, 409);
  } catch (e) {
    if (e instanceof RoomError) return response({ error: e.message }, e.status);
    console.error('room command failed');
    return response({ error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 500);
  }
});
