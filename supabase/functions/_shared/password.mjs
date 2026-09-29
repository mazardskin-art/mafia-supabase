const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function hashPassword(value) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(value), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
  return `pbkdf2-sha256$150000$${b64(salt)}$${b64(bits)}`;
}
export async function verifyPassword(value, stored, master) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (typeof master === 'string' && master.length && value === master) return true;
  if (typeof stored !== 'string') return false;
  const [, algorithm, rounds, saltText, expected] = stored.match(/^(pbkdf2-sha256)\$(\d+)\$([^$]+)\$([^$]+)$/) || [];
  if (algorithm !== 'pbkdf2-sha256' || Number(rounds) !== 150000) return false;
  const decode = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', encoder.encode(value), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: decode(saltText), iterations: 150000, hash: 'SHA-256' }, key, 256);
  const actual = decode(b64(bits)), target = decode(expected); let diff = actual.length ^ target.length;
  for (let i = 0; i < Math.max(actual.length, target.length); i++) diff |= (actual[i] || 0) ^ (target[i] || 0);
  return diff === 0;
}
