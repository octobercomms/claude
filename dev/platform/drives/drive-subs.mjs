// Reddit leads with the subreddits, stored, as a table you configure. They
// were chips that filled a text box and vanished on reload, so the screen's
// real first action cost a Claude call every time.
import pw from './pw.mjs';
const { chromium } = pw;
const B = 'http://127.0.0.1:4599';
const URL = `${B}/clients/c1/social/reddit`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const main = () => page.evaluate(() => document.querySelector('.app-main').innerText);
const state = () => page.evaluate(async () => (await fetch('/__subs')).json());
const rowNames = () => page.evaluate(() =>
  [...document.querySelectorAll('.app-main .table tbody tr td:first-child strong')].map(e => e.innerText.trim()));

await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => { await fetch('/__subs/reset'); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// Empty: the screen says what the first action is and why it is stored.
let text = await main();
ok(/nothing stored yet/i.test(text), 'with no list, the screen says so');
ok(/customers<?\/?strong>? gather|customers\s+gather/i.test(text) || /customers/i.test(text),
   'and says Claude names where the customers gather');
ok(/costs nothing/i.test(text), 'and that looking again is free');
ok(await page.locator('.app-main button', { hasText: /^Suggest subreddits$/ }).count() === 1,
   'the suggest is the primary, and it is the only one');

await page.locator('.app-main button', { hasText: /^Suggest subreddits$/ }).click();
await page.waitForTimeout(600);
let names = await rowNames();
ok(names.length === 3, 'suggesting fills a table, not a row of chips', JSON.stringify(names));
ok(names.includes('r/GardeningUK'), 'with the subreddits in it', JSON.stringify(names));
text = await main();
ok(/where owners ask what a garden should cost/i.test(text),
   'and the reason Claude gave for each, on screen rather than in a tooltip');

// The three columns the review asked for, per row.
const headers = await page.evaluate(() =>
  [...document.querySelectorAll('.app-main .table th')].map(e => e.innerText.trim()));
ok(/subreddit/i.test(headers.join('|')) && /focus/i.test(headers.join('|'))
   && /window/i.test(headers.join('|')) && /research/i.test(headers.join('|')),
   'the table has a focus, a window and a research per row', JSON.stringify(headers));

// A focus and a window are stored against the row, not against the screen.
const firstFocus = page.locator('.app-main .table tbody tr').first().locator('input');
await firstFocus.click();
await firstFocus.fill('what a garden costs');
await page.locator('.app-main').click({ position: { x: 5, y: 5 } });
await page.waitForTimeout(500);
let s = await state();
ok(s.subs[0].focus === 'what a garden costs', 'typing a focus saves it to the row', JSON.stringify(s.subs[0].focus));
await page.locator('.app-main .table tbody tr').first().locator('select').selectOption('year');
await page.waitForTimeout(400);
s = await state();
ok(s.subs[0].time_window === 'year', 'and so does picking a window', s.subs[0].time_window);

// Reload: the whole point. The list survives and costs no second call.
const callsBefore = (await state()).suggestCalls;
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
names = await rowNames();
ok(names.length === 3, 'the list survives a reload', JSON.stringify(names));
const focusAfter = await page.locator('.app-main .table tbody tr').first().locator('input').inputValue();
ok(focusAfter === 'what a garden costs', 'with the focus still on its row', focusAfter);
ok((await state()).suggestCalls === callsBefore,
   'and opening the screen asks Claude for nothing', `${(await state()).suggestCalls} vs ${callsBefore}`);

// Adding one by hand, and removing one.
await page.locator('.app-main input[placeholder="Add one yourself"]').fill('r/Surrey');
await page.locator('.app-main .card button', { hasText: /^Add$/ }).first().click();
await page.waitForTimeout(600);
names = await rowNames();
ok(names.includes('r/Surrey'), 'a subreddit can be added by hand', JSON.stringify(names));
ok(!names.includes('r/r/Surrey'), 'and the r/ it was typed with is not doubled', JSON.stringify(names));

// "Suggest more" is the one press that pays, so it asks first.
page.once('dialog', d => d.dismiss());
await page.locator('.app-main button', { hasText: /^Suggest more$/ }).click();
await page.waitForTimeout(500);
ok((await state()).suggestCalls === callsBefore, 'suggesting more asks before it spends',
   `${(await state()).suggestCalls} vs ${callsBefore}`);

// The one-off is still there, behind a disclosure rather than leading.
text = await main();
ok(/research a subreddit without adding it/i.test(text), 'a one-off run is still possible');
const promoted = await page.evaluate(() => {
  const d = [...document.querySelectorAll('.app-main details')].find(x => /without adding it/i.test(x.innerText));
  return d ? d.open : null;
});
ok(promoted === false, 'but it is not what the screen leads with', String(promoted));

ok(errors.length === 0, 'no page errors', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
