import { clearCookie, json } from '../_lib/auth.js';

export const onRequestPost = () => json({ ok: true }, { headers: { 'Set-Cookie': clearCookie() } });
