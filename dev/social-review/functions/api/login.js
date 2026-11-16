import { checkPassword, issueCookie, json } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  if (!env.TEAM_PASSWORD || !env.AUTH_SECRET) {
    return json({ error: 'TEAM_PASSWORD and AUTH_SECRET are not set on this project.' }, { status: 500 });
  }
  let password = '';
  try {
    ({ password } = await request.json());
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }
  if (!checkPassword(password, env)) {
    // Slow a brute force attempt to a crawl without any storage.
    await new Promise((r) => setTimeout(r, 600));
    return json({ error: 'Wrong password' }, { status: 401 });
  }
  return json({ ok: true }, { headers: { 'Set-Cookie': await issueCookie(env) } });
}
