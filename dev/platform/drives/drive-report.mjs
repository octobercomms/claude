// The downloadable social report, on Shared's Measure screen. Four review
// items were one product: a report to download and send, covering OMI and
// the connected accounts, with Claude's read on the month.
//
// The stub serves 7 posts of which 2 came through OMI when Instagram is
// connected, and 2 of 2 when it is not.
import pw from './pw.mjs';
const { chromium } = pw;
const B = 'http://127.0.0.1:4599';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, acceptDownloads: true });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const card = () => page.locator('.app-main .card').filter({ hasText: /monthly report/i }).first();
const btn = () => card().locator('button', { hasText: /download the report|building/i });
const sent = () => page.evaluate(async () => (await fetch('/__report')).json());

await page.goto(`${B}/clients/c1/social/review`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);

ok(await card().count() === 1, 'Measure opens with the report');
const text = await card().innerText();
ok(/whoever published it/i.test(text), 'it says it covers the account, not only what OMI published');
ok(/counted alongside ours and named as theirs/i.test(text),
   'and that the client\'s own posts are named as theirs');
ok(/what worked and what did not/i.test(text), 'and that it carries the analysis');
ok(/covers OMI's own posts only/i.test(text),
   'and what it says when nothing is connected');
ok(await card().locator('select').count() === 1, 'with a window to pick');

// The window reaches the request.
await card().locator('select').selectOption('90');
await page.waitForTimeout(200);
const dl = page.waitForEvent('download');
await btn().click();
const file = await dl;
await page.waitForTimeout(600);
ok(/\.pdf$/.test(file.suggestedFilename()), 'the download is a PDF', file.suggestedFilename());
ok(/social-hillcroft-gardens/.test(file.suggestedFilename()), 'named for the client and the day', file.suggestedFilename());
const body = await sent();
ok(body.days === 90, 'the window picked is the window asked for', JSON.stringify(body));

// It says what it covered without being opened.
const toast = await page.evaluate(() => document.body.innerText);
ok(/7 posts in the report/i.test(toast), 'the page says how many posts went in', toast.match(/\d+ posts? in the report[^.]*\./i)?.[0]);
ok(/5 of them published outside OMI/i.test(toast),
   'and how many were not ours', toast.match(/\d+ of them published outside OMI/i)?.[0]);

ok(errors.length === 0, 'no page errors', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
