import pw from './pw.mjs';

// Produce is agency-only and desktop-only.
//
// Two decisions Daniel made on 9 November: "read only clients dont see
// Produce - good point. and they dont need it", and "phone - lets not have it
// on phone. its a desktop application."
//
// The unit guards check the nav data. What they cannot see is the failure
// this had to avoid, which only exists in a browser with a client session:
// hiding a rail link hides nothing from an address bar, and the obvious
// implementation — redirect them to a row they can see — cannot work, because
// `useScreen`'s setTab returns early and SILENTLY when a tab has no row for
// this viewer. A client who typed the URL would land on the compose branch,
// which is gated on `!readOnly`, and get a blank page with the nav insisting
// they were somewhere.
//
// The client session comes from a `stubrole=client` cookie the stub reads,
// so one run covers both roles. An env flag would have meant restarting the
// stub between passes, and CI starts one and loops.
const b = await pw.chromium.launch();
const errs = [];
let fails = 0;
const say = (ok, what, extra = '') => {
  if (!ok) fails += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  — ' + extra : ''}`);
};

const open = async (path, asClient = false) => {
  const ctx = await b.newContext();
  if (asClient) {
    await ctx.addCookies([{ name: 'stubrole', value: 'client', domain: '127.0.0.1', path: '/' }]);
  }
  const p = await ctx.newPage();
  p.on('pageerror', (e) => {
    if (/stub: no route/.test(e.message)) return;
    errs.push(`${path}: ${e.message}`);
  });
  await p.goto('http://127.0.0.1:4599' + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1100);
  return p;
};
const text = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ');

// ── The agency half ────────────────────────────────────────────────────
{
  const p = await open('/clients/c1/produce/studio');
  const links = await p.$$eval('a[href]', as => as.map(a => a.getAttribute('href')).filter(h => /\/produce$/.test(h)));
  say(links.length > 0, 'the agency still has Produce in the rail');
  const t = await text(p);
  say(/Frame size/i.test(t), 'and the Studio still opens');
  say(!/Produce is for the agency/.test(t), 'and is not shown the client notice');
  await p.close();
}

// ── The client half ────────────────────────────────────────────────────
{
  // What a client gets. The rail first: a link to a section whose every row
  // is hidden lands on a page with an empty directory beside it.
  {
    const p = await open('/clients/c1/dashboard', true);
    const links = await p.$$eval('a[href]', as => as.map(a => a.getAttribute('href')).filter(h => /\/produce/.test(h)));
    say(links.length === 0, 'a client is offered no Produce link anywhere in the rail',
      links.join(', '));
    await p.close();
  }

  // Then the addresses. A bookmark, a typo and an old email all reach these.
  for (const path of ['/clients/c1/produce', '/clients/c1/produce/studio',
    '/clients/c1/produce/record', '/clients/c1/produce/library',
    '/clients/c1/produce/nonsense']) {
    const p = await open(path, true);
    const t = await text(p);
    say(/Produce is for the agency/.test(t),
      `${path} tells the client what this is`,
      // The failure mode is a blank content area under a lit nav, so the
      // diagnostic that matters is what WAS on the page.
      /Produce is for the agency/.test(t) ? '' : `page read: "${t.slice(0, 200)}"`);
    // The specific failure: a blank content area under a lit nav.
    say(!/Frame size/i.test(t), `${path} does not leak the editor`);
    await p.close();
  }
}

say(errs.length === 0, 'no page errors', errs.join(' | '));
await b.close();
console.log(`\n${fails === 0 ? 'ALL' : 'SOME'} — ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
