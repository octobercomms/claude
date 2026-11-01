// Earned → Campaigns → Results: one emphasised tile, no black slabs.
//
// Checked as computed pixels, not as a class name: the claim is that the
// screen no longer reads as a page of black blocks, and only the browser can
// answer that.
import pw from './pw.mjs';
const browser = await pw.chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1400 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const B = 'http://127.0.0.1:4599';
await page.goto(`${B}/clients/c1/pr/campaigns`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// Open the first campaign, then its Results view.
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.app-main *')]
    .find(e => /Atlas launch pitch/.test(e.textContent || '') && e.children.length === 0);
  (el?.closest('button, a, tr, [role="button"]') || el)?.click();
});
await page.waitForTimeout(1200);
const toResults = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.app-main button')].find(x => x.innerText.trim() === 'Results');
  if (!b) return false;
  b.click();
  return true;
});
ok(toResults, 'the campaign opens and has a Results view');
await page.waitForTimeout(1500);

const tiles = await page.evaluate(() => [...document.querySelectorAll('.app-main .ds-stat')].map(t => {
  const cs = getComputedStyle(t);
  const val = t.querySelector('.ds-stat__value');
  return {
    label: (t.querySelector('.ds-stat__label')?.innerText || '').trim(),
    value: (val?.innerText || '').trim(),
    bg: cs.backgroundColor,
    border: cs.borderTopColor,
    ink: val ? getComputedStyle(val).color : null,
    feature: t.classList.contains('ds-stat--feature'),
    accent: t.classList.contains('ds-stat--accent'),
  };
}));
ok(tiles.length >= 9, 'both stat rows are on screen at once', `tiles: ${tiles.length}`);

// Luminance, so "dark" is measured rather than guessed.
//
// Composited over white first. The accent wash is rgba(231,205,65,0.12), and
// reading its luminance raw gives the luminance of solid yellow — which is
// what the first version of this drive did, and it called a very pale wash
// "not light". What the eye sees is the colour over the page.
const lum = (col) => {
  const n = col.match(/[\d.]+/g).map(Number);
  const [r, g, b] = n;
  const a = n.length > 3 ? n[3] : 1;
  const over = (c) => c * a + 255 * (1 - a);
  return (0.2126 * over(r) + 0.7152 * over(g) + 0.0722 * over(b)) / 255;
};
const dark = tiles.filter(t => lum(t.bg) < 0.4);
ok(dark.length === 0, 'no tile on Results has a dark fill',
   dark.map(t => `${t.label} ${t.bg}`).join(', '));

const accents = tiles.filter(t => t.accent);
ok(accents.length === 1, 'exactly one tile is emphasised', accents.map(t => t.label).join(', '));
ok(/from outlets you pitched/i.test(accents[0]?.label || ''),
   'and it is the defensible number', accents[0]?.label);

// The emphasis has to be visible, and the number has to stay readable.
const a = accents[0];
ok(a && a.border !== tiles.find(t => !t.accent && !t.feature).border,
   'the emphasised tile is distinguishable from a plain one', `${a?.border} vs plain`);
ok(a && lum(a.ink) < 0.3, 'its number is dark ink, not accent-coloured', a?.ink);
ok(a && lum(a.bg) > 0.8, 'on a light wash', a?.bg);

// The figures themselves, so the tile is not emphasising the wrong one.
const byLabel = (re) => tiles.find(t => re.test(t.label));
ok(byLabel(/from outlets you pitched/)?.value === '2', 'pitched_rds reads from the API', byLabel(/from outlets you pitched/)?.value);
ok(byLabel(/new referring domains/)?.value === '7', 'new referring domains still shows its own figure');
ok(!byLabel(/new referring domains/)?.accent && !byLabel(/new referring domains/)?.feature,
   'and is no longer the emphasised one');
ok(byLabel(/warm/) && !byLabel(/warm/).feature && !byLabel(/warm/).accent,
   'warm carries no emphasis at all, so the screen has exactly one');

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await page.screenshot({ path: '/tmp/claude-0/-home-user-claude/678f754e-8874-5413-b278-fc834fcb4dab/scratchpad/tiles.png' });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
