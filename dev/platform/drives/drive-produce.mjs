// Produce opens with the posts ticked on Review, each with its own
// production options. Before this it offered an avatar reel and a board,
// and the only way to bring a post into production was the "Produce →"
// link on a Review tile.
import pw from './pw.mjs';
const { chromium } = pw;
const B = 'http://127.0.0.1:4599';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const HOOKS = ['The one bed rule', 'Autumn is the planting season'];
const mainText = () => page.evaluate(() => document.querySelector('.app-main').innerText);
// PostCard is an editor: the hook lives in an input value, which innerText
// does not report. Each card is read by the hook it is holding.
const cards = () => page.evaluate((hooks) => {
  const out = [];
  for (const c of document.querySelectorAll('.app-main .card')) {
    const vals = [...c.querySelectorAll('input, textarea')].map(i => i.value);
    const hook = hooks.find(h => vals.includes(h));
    if (hook) out.push({ hook, open: /you only need one route to a finished asset/i.test(c.innerText) });
  }
  return out;
}, HOOKS);
const boxes = () => page.locator('.app-main input[type="checkbox"][aria-label^="Include post"]');

// Start from all ticked.
await page.goto(`${B}/clients/c1/social/brief`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
const tickAll = page.locator('.app-main button', { hasText: /^Tick all$/ });
if (await tickAll.count()) { await tickAll.click(); await page.waitForTimeout(250); }

await page.goto(`${B}/clients/c1/social/workbench`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
let text = await mainText();
let shown = await cards();
ok(/2 posts you ticked/i.test(text), 'Produce opens with the ticked posts', text.match(/The \d+ posts? you ticked/i)?.[0]);
// Each post is there by its own hook, not just a count.
for (const h of HOOKS) ok(shown.some(c => c.hook === h), `and shows "${h}"`, JSON.stringify(shown.map(c => c.hook)));
// And each one carries its production options.
const prodButtons = await page.locator('.app-main button', { hasText: /^Produce [▴▾]$/ }).count();
ok(prodButtons === 2, 'each with its own production options', String(prodButtons));

// Arriving from a tile opens that post's options, not the other's.
await page.goto(`${B}/clients/c1/social/brief`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
await page.locator('.app-main button', { hasText: /Produce →/ }).nth(1).click();
await page.waitForTimeout(900);
const opened = await cards();
ok(opened[0]?.hook === HOOKS[1], 'the post you came from is first', JSON.stringify(opened.map(o => o.hook)));
ok(opened[0]?.open === true, 'with its options open');
ok(opened.some(o => o.hook === HOOKS[0] && o.open === false),
   'and the other sits collapsed rather than filling the page', JSON.stringify(opened));

// An unticked post is not on Produce.
await page.goto(`${B}/clients/c1/social/brief`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
await boxes().nth(1).click();
await page.waitForTimeout(300);
await page.goto(`${B}/clients/c1/social/workbench`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
text = await mainText();
shown = await cards();
ok(shown.some(c => c.hook === HOOKS[0]) && !shown.some(c => c.hook === HOOKS[1]),
   'an unticked post is not on Produce at all', JSON.stringify(shown.map(c => c.hook)));
ok(/1 post you ticked/i.test(text), 'and the count says one', text.match(/The \d+ posts? you ticked/i)?.[0]);

// Asking to produce an unticked post ticks it rather than sending you to
// a step that will not show it.
await page.goto(`${B}/clients/c1/social/brief`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
ok(await boxes().nth(1).isChecked() === false, 'the second post is still unticked');
await page.locator('.app-main button', { hasText: /Produce →/ }).nth(1).click();
await page.waitForTimeout(900);
text = await mainText();
shown = await cards();
ok(shown.some(c => c.hook === HOOKS[1]), 'producing an unticked post brings it back in', JSON.stringify(shown.map(c => c.hook)));
ok(/2 posts you ticked/i.test(text), 'and ticks it', text.match(/The \d+ posts? you ticked/i)?.[0]);

// Nothing ticked: the step says where to choose rather than looking broken.
await page.goto(`${B}/clients/c1/social/brief`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
await page.locator('.app-main button', { hasText: /^Untick all$/ }).click();
await page.waitForTimeout(300);
await page.goto(`${B}/clients/c1/social/workbench`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
text = await mainText();
ok(/nothing is ticked/i.test(text), 'with nothing ticked, Produce says so');
ok(/where you choose which posts you are making/i.test(text), 'and where to choose');
ok((await cards()).length === 0, 'and lists no posts');

ok(errors.length === 0, 'no page errors', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
