// Setup shows the nine research scans with their prices and runs the ticked
// ones. Nine review items asked for a scan at setup; the decision was the
// middle option, because each one spends.
import pw from './pw.mjs';
const { chromium } = pw;
const B = 'http://127.0.0.1:4599';
const URL = `${B}/clients/c1/dashboard/setup`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

// The nine the review named, by the label the panel shows.
const NINE = ['Competitors', 'Subreddits', 'Starter keywords', 'Schema audit', 'Competition gap',
              'Competitor X-ray', 'Buyer-intent keywords', 'GBP ranking playbook', 'Ranking outliers'];

const panel = () => page.locator('.card', { has: page.locator('input[type="checkbox"][aria-label], label') })
  .filter({ hasText: /research scans/i }).first();
const boxes = () => panel().locator('input[type="checkbox"]');
const state = () => page.evaluate(async () => (await fetch('/__scans')).json());
const runBtn = () => panel().locator('button', { hasText: /run|tick the scans/i }).first();

await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => { await fetch('/__scans/reset'); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);

const text = await panel().innerText();
ok(await boxes().count() === 9, 'nine scans, each with a tick', String(await boxes().count()));
for (const label of NINE) ok(text.includes(label), `including "${label}"`);
ok(/0\/9 run/i.test(text), 'and none has run on this client', text.match(/\d\/9 run/i)?.[0]);

// Nothing ticked when it opens: a default selection is a default spend.
const checked = await page.evaluate(() =>
  [...document.querySelectorAll('input[type="checkbox"]')].filter(b => b.checked).length);
ok(checked === 0, 'nothing is ticked when the panel opens', String(checked));
ok(/none of them is ticked and none runs on its own/i.test(text), 'and it says so');
ok(/median of what that feature has actually cost/i.test(text),
   'the price is named as a median of real spend, not a quote');
ok(/Tick the scans to run/i.test(await runBtn().innerText()), 'the button waits for a tick');
ok(await runBtn().isDisabled(), 'and cannot be pressed yet');

// A scan missing its inputs says so on the row, before the button.
ok(/at least one competitor \(tick Competitors too and it runs first\)/i.test(text),
   'a scan with no competitors says what it needs and how to fix it');
const gapBox = boxes().nth(4);
ok(await gapBox.isDisabled(), 'and cannot be ticked while it cannot run');

// Service and city are only asked for when something ticked needs them.
ok(!/^Service$/im.test(text), 'the service and city are not asked for up front');
await boxes().nth(6).click();   // Buyer-intent keywords
await page.waitForTimeout(300);
let t2 = await panel().innerText();
ok(/Service/i.test(t2) && /City/i.test(t2), 'ticking a local scan asks for them');
ok(/not on the client record, so they are asked for here/i.test(t2), 'and says why');
ok(await runBtn().isDisabled(), 'the button is held until they are filled in');
ok(/fill in the service and city above/i.test(t2), 'and says what is holding it', t2.match(/A local scan.*/i)?.[0]);

await panel().locator('input.input').first().fill('garden design');
await panel().locator('input.input').nth(1).fill('Guildford');
await page.waitForTimeout(300);
ok(!(await runBtn().isDisabled()), 'filled in, it can be pressed');
ok(/Run 1 scan/i.test(await runBtn().innerText()), 'and it says how many', await runBtn().innerText());

// Run a mix: one that works, one that needs a competitor it will not get,
// and one the stub fails. Each reports its own outcome.
await boxes().nth(0).click();   // Competitors — runs
await boxes().nth(2).click();   // Starter keywords — the stub fails this one
await page.waitForTimeout(200);
ok(/Run 3 scans/i.test(await runBtn().innerText()), 'three ticked', await runBtn().innerText());
await runBtn().click();
await page.waitForTimeout(1200);

const s = await state();
ok(s.last.scans.length === 3, 'the press sends exactly what was ticked', JSON.stringify(s.last.scans));
ok(s.last.service === 'garden design' && s.last.city === 'Guildford',
   'with the service and city', JSON.stringify([s.last.service, s.last.city]));
ok(!s.run.includes('ai_seo'), 'a scan that failed did not record a result', JSON.stringify(s.run));
ok(s.run.includes('competitors') && s.run.includes('keyword_sniper'),
   'and the two that worked did', JSON.stringify(s.run));

let t3 = await panel().innerText();
ok(/DataForSEO returned 402/i.test(t3), 'the failure is on screen with its reason, not swallowed');
ok(/2\/9 run/i.test(t3), 'the count reflects what actually ran', t3.match(/\d\/9 run/i)?.[0]);
const afterChecked = await page.evaluate(() =>
  [...document.querySelectorAll('input[type="checkbox"]')].filter(b => b.checked).length);
ok(afterChecked === 0, 'and the ticks clear, so a second press is deliberate', String(afterChecked));

// A scan that has run is marked, and ticking it again costs nothing.
ok(/already run/i.test(t3), 'what has run is marked');
ok(/returns what it made the first time/i.test(t3), 'and the panel says a second tick is free');
await boxes().nth(0).click();
await page.waitForTimeout(200);
await runBtn().click();
await page.waitForTimeout(1000);
t3 = await panel().innerText();
ok(/2\/9 run/i.test(t3), 'running it again changes nothing', t3.match(/\d\/9 run/i)?.[0]);

ok(errors.length === 0, 'no page errors', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
