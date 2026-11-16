// Shared session helpers. Files under functions/_lib are imported, never routed.

const COOKIE = 'ocsr_session';
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return b64url(mac);
}

// Constant-time string compare so a wrong password cannot be timed out character by character.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueCookie(env) {
  if (!env.AUTH_SECRET) throw new Error('AUTH_SECRET is not set');
  const exp = String(Math.floor(Date.now() / 1000) + TTL_SECONDS);
  const token = `${exp}.${await sign(exp, env.AUTH_SECRET)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_SECONDS}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function isSignedIn(request, env) {
  if (!env.AUTH_SECRET) return false;
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return false;
  const [exp, mac] = decodeURIComponent(match[1]).split('.');
  if (!exp || !mac) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(mac, await sign(exp, env.AUTH_SECRET));
}

export function checkPassword(submitted, env) {
  if (!env.TEAM_PASSWORD) return false;
  return safeEqual(String(submitted || ''), env.TEAM_PASSWORD);
}

export const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  });
