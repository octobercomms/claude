import pw from './pw.mjs';
const b = await pw.chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
let loads = 0;
p.on('load', () => { loads++; });
// Exactly what production does: no session cookie, so the authenticated
// endpoint answers 401.
await p.route('**/api/auth/me', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"no session"}' }));
await p.route('**/api/settings/usage/feature-costs', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' }));
await p.goto('http://127.0.0.1:4599/login', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);
console.log('loads in 6s:', loads);
console.log('url:', p.url());
await b.close();
