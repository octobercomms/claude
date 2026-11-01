// Earned → Measure held one row holding one per-campaign table. Per-campaign
// attribution lives on each campaign's Results now, so the screen existed
// for the cross-campaign total alone. The total moved to the top of Coverage
// and the screen went.
//
// Fixture: two campaigns, pitched_rds 3 and 1, recipients 90 and 30. So the
// totals are 4 of 120, which is 3%. Asserted against those numbers rather
// than against "a number is present".
import pw from './pw.mjs';
const { chromium } = pw;
const B = 'http://127.0.0.1:4599';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto(`${B}/clients/c1/pr/coverage`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);

const tiles = await page.evaluate(() => [...document.querySelectorAll('.app-main .ds-stat')].map(t => ({
  value: t.querySelector('.ds-stat__value')?.innerText.trim(),
  label: t.querySelector('.ds-stat__label')?.innerText.trim(),
  feature: t.classList.contains('ds-stat--feature'),
})));
const by = (re) => tiles.find(t => re.test(t.label || ''));
ok(tiles.length >= 3, 'Coverage opens with the press link total', JSON.stringify(tiles));
ok(by(/linked back/i)?.value === '4', 'the two campaigns add to 4 outlets that linked back', JSON.stringify(by(/linked back/i)));
ok(by(/approached/i)?.value === '120', 'from 120 approached', JSON.stringify(by(/approached/i)));
ok(by(/hit rate/i)?.value === '3%', 'which is a 3% hit rate', JSON.stringify(by(/hit rate/i)));
ok(by(/linked back/i)?.feature === true, 'and the earned figure is the headline, not the approached count');

const text = await page.evaluate(() => document.querySelector('.app-main').innerText);
ok(/across 2 campaigns/i.test(text), 'it says how many campaigns it covers');
ok(/within 21 days of launch/i.test(text), 'and what counts as a link it earned');
ok(/per-campaign detail is on each campaign/i.test(text), 'and where the detail is');
// The wrong number must not come back as the headline: new_rds is 9 across
// the two campaigns and is context, not a result.
ok(!tiles.some(t => t.value === '9'), 'the whole-site domain count is not on the tiles', JSON.stringify(tiles.map(t => t.value)));

// The nav row is gone, and so is the group heading above it.
const nav = await page.evaluate(() => {
  const panel = document.querySelector('.section-panel') || document.querySelector('.app-nav') || document.body;
  return panel.innerText;
});
ok(!/^Measure$/im.test(nav), 'Earned has no Measure group any more', JSON.stringify(nav.split('\n').filter(l => /measure|report/i.test(l))));
ok(!/\bReports\b/.test(nav), 'and no Reports row');

// And the screen it pointed at does not render a table of campaigns.
await page.goto(`${B}/clients/c1/pr/reports`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1100);
const gone = await page.evaluate(() => {
  const main = document.querySelector('.app-main');
  const heads = [...main.querySelectorAll('.table th')].map(e => e.innerText.trim().toLowerCase());
  return { heads, text: main.innerText };
});
ok(!gone.heads.some(h => /linked back/i.test(h)),
   'the old per-campaign backlink table is gone', JSON.stringify(gone.heads));
ok(!/all new domains/i.test(gone.text), 'and so is the column that once read 939');

ok(errors.length === 0, 'no page errors', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
