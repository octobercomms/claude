import pw from './pw.mjs';
const b = await pw.chromium.launch();

// Four worlds, one per cause of an empty list.
const CASES = [
  { name: 'nothing ever ingested',
    notices: { notices: [], counts: { match:0, maybe:0, noise:0, total:0 }, vcounts: {shortlist:0,go:0,nogo:0}, totals: { stored: 0, closed: 0, dismissed: 0 } },
    expect: /nothing ingested yet/i, notExpect: null },
  { name: '200 stored, all closed',
    notices: { notices: [], counts: { match:0, maybe:0, noise:0, total:0 }, vcounts: {shortlist:0,go:0,nogo:0}, totals: { stored: 200, closed: 200, dismissed: 0 } },
    expect: /200 notices stored.*none of them are open and undismissed.*200 have closed/is, notExpect: /nothing ingested yet/i },
  { name: '7 stored, all dismissed',
    notices: { notices: [], counts: { match:0, maybe:0, noise:0, total:0 }, vcounts: {shortlist:0,go:0,nogo:0}, totals: { stored: 7, closed: 0, dismissed: 7 } },
    expect: /7 notices stored.*7 were dismissed/is, notExpect: /nothing ingested yet/i },
  { name: '31 open, all filtered out by the dropdowns',
    notices: { notices: [], counts: { match:0, maybe:12, noise:19, total:31 }, vcounts: {shortlist:0,go:0,nogo:31}, totals: { stored: 31, closed: 0, dismissed: 0 } },
    expect: /31 notices in this view, none of them past the filters/i, notExpect: /nothing ingested yet/i },
];

for (const c of CASES) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('   PAGEERROR', e.message));
  let lastQuery = null;
  await p.route('**/api/**', async r => {
    const u = new URL(r.request().url());
    const j = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/auth/me') return j({ id: 'u1', username: 'daniel', role: 'admin' });
    if (u.pathname === '/api/tender/notices') { lastQuery = u.search; return j(c.notices); }
    if (u.pathname === '/api/tender/sources') return j([]);
    if (u.pathname === '/api/tender/profile/company-fields') return j([]);
    if (u.pathname === '/api/tender/profile') return j({ company: {} });
    if (u.pathname === '/api/tender/settings') return j({ digest_enabled: false, digest_email: '' });
    if (u.pathname.startsWith('/api/tender/')) return j({});
    // Everything else on the Settings shell: an array is the shape most of
    // its panels expect, and an object breaks .map before Tenders renders.
    return j([]);
  });
  await p.goto('http://127.0.0.1:4599/biz-dev/tenders', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const body = await p.locator('body').innerText();
  const flat = body.replace(/\s+/g, ' ');
  const hit = c.expect.test(flat);
  const bad = c.notExpect ? c.notExpect.test(flat) : false;
  console.log((hit && !bad ? 'PASS ' : 'FAIL ') + c.name);
  if (!hit || bad) console.log('   screen said:', JSON.stringify(flat.slice(flat.search(/notice|Nothing/i) - 40, flat.search(/notice|Nothing/i) + 260)));
  // The checkbox labels must carry the counts, and ticking must change the request.
  const labels = (await p.locator('label').allInnerTexts()).filter(t => /include/i.test(t));
  console.log('   switches:', JSON.stringify(labels), 'query:', lastQuery);
  if (c.name.includes('closed')) {
    await p.getByText(/include closed/i).click();
    await p.waitForTimeout(600);
    console.log('   after ticking closed, query:', lastQuery);
  }
  if (c.name.includes('dismissed')) {
    await p.getByText(/include dismissed/i).click();
    await p.waitForTimeout(600);
    console.log('   after ticking dismissed, query:', lastQuery);
  }
  await ctx.close();
}
await b.close();
