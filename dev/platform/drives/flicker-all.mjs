import pw from './pw.mjs';
const b = await pw.chromium.launch();
const PATHS = ['/login', '/', '/share/tok123', '/watch/tok123', '/coverage/tok123',
  '/press-release/tok123', '/approve/tok123', '/p/tok123', '/b/tok123', '/set-password/tok123'];
for (const path of PATHS) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  let loads = 0;
  p.on('load', () => { loads++; });
  // Signed out: every authenticated endpoint answers 401.
  await p.route('**/api/**', async r => {
    r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
  });
  await p.goto('http://127.0.0.1:4599' + path, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  console.log(String(loads).padStart(3), 'loads  ', path.padEnd(22), '->', new URL(p.url()).pathname);
  await ctx.close();
}
// And the rule it must not have removed: an expired session on a real screen
// still goes to the login form.
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.route('**/api/**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' }));
  await p.goto('http://127.0.0.1:4599/clients', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  console.log('expired session on /clients ->', new URL(p.url()).pathname);
  await ctx.close();
}
await b.close();
