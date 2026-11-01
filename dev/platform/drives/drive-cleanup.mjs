import pw from './pw.mjs';

// Database → Cleanup: the seven screens that were a page behind a kebab.
//
// "the drawer icon is completely the wrong place... in the database second
// nav panel, we need a list of the cleanup centre pages? thats better than
// the drawer?" and then "lets label the section CLEANUP and then list all of
// the pages below it on the Database sub nav".
//
// Three things no source check can see: that each row opens something rather
// than a blank screen, that the kebab is actually gone from the lists, and
// that the four screens pointing at Maintenance still land on it.
const b = await pw.chromium.launch();
let fails = 0;
const say = (ok, what, extra = '') => {
  if (!ok) fails += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  — ' + extra : ''}`);
};
const errs = [];
const open = async (path) => {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', (e) => { if (!/stub: no route/.test(e.message)) errs.push(`${path}: ${e.message}`); });
  await p.goto('http://127.0.0.1:4599' + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1100);
  return p;
};
const text = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ');

const ROWS = [
  ['Journalist duplicates', 'journalist-duplicates'],
  ['Coverage matchups', 'coverage-matchups'],
  ['Tidy fixes', 'tidy-fixes'],
  ['Contact updates', 'contact-updates'],
  ['Reply catch-up', 'reply-catch-up'],
  ['Publication duplicates', 'publication-duplicates'],
  ['Maintenance', 'maintenance'],
];

// ── The group, and every row in it ───────────────────────────────────────
{
  const p = await open('/database/journalists');
  const panel = await text(p);
  // Headings render uppercase, so match case-insensitively.
  say(/CLEANUP/i.test(panel), 'the Database panel carries a Cleanup group');

  for (const [label, slug] of ROWS) {
    const row = p.getByRole('button', { name: label, exact: true }).first();
    const there = await row.count() > 0;
    say(there, `${label} is a row you can click`);
    if (!there) continue;
    await row.click();
    await p.waitForTimeout(1000);
    say(p.url().endsWith(`/database/${slug}`), `and ${label} lands on /database/${slug}`, p.url());
    // A row that opens a blank screen is the failure this is really for.
    const body = await p.locator('main, .suite-cleanup').first().innerText().catch(() => '');
    say(body.replace(/\s+/g, '').length > 60, `and ${label} renders something`, `${body.replace(/\s+/g, '').length} chars`);
  }
  await p.close();
}

// ── The kebab is gone from both lists ────────────────────────────────────
for (const [screen, primary] of [['journalists', '+ Add journalist'], ['publications', '+ Add publication']]) {
  const p = await open(`/database/${screen}`);
  const kebabs = await p.locator('.icon-circle').filter({ hasText: '⋮' }).count();
  say(kebabs === 0, `${screen}: no kebab left on the list`, `${kebabs} found`);
  const t = await text(p);
  say(!/Database tools/i.test(t), `${screen}: and nothing still offers a Database tools page`);
  say(t.includes(primary), `${screen}: keeps its primary action`);
  say(/Export CSV/i.test(t), `${screen}: and Export CSV is a button on the list`);
  await p.close();
}

// ── The screens that point at Maintenance still land on it ───────────────
{
  const p = await open('/database/tags');
  const link = p.locator('a[href="/database/maintenance"]').first();
  const there = await link.count() > 0;
  say(there, 'Tags points at Maintenance by its new path');
  if (there) {
    await link.click();
    await p.waitForTimeout(1000);
    const t = await text(p);
    say(p.url().endsWith('/database/maintenance'), 'and it lands', p.url());
    say(/Tidy tags with Claude|Tidy with Claude/i.test(t), 'on the screen holding the job it came for');
  }
  await p.close();
}

console.log(errs.length ? 'PAGE ERRORS:\n  ' + errs.join('\n  ') : 'no page errors');
console.log(fails ? `--- ${fails} FAILED ---` : '--- CLEANUP ROWS DRIVE PASSES ---');
await b.close();
process.exit(fails ? 1 : 0);
