// Database → Publications: a full-width table, a modal, a typed confirm, and
// a bulk delete that deletes what it says.
//
// The one that matters is the last. "Delete all 2000 matching" sat behind a
// window.confirm() one Return away, while the list drew 500. A click deleted
// 1,500 publications nobody had looked at, detaching every journalist and
// coverage entry attached to them, and it could not be undone.
import pw from './pw.mjs';
const browser = await pw.chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const B = 'http://127.0.0.1:4599';
const main = () => page.evaluate(() => document.querySelector('.app-main').innerText);
const state = () => page.evaluate(async () => (await fetch('/__pubs')).json());

await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => fetch('/__pubs/reset'));
await page.goto(`${B}/database/publications`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 1 · The label. This page serves Settings, Database and Biz dev, and said
// "Settings" above every one of them.
const heading = await page.evaluate(() => {
  const h1 = document.querySelector('h1.display');
  const h2 = document.querySelector('h2.ds-shell__screen');
  return { h1: h1?.innerText.trim(), h2: h2?.innerText.trim() };
});
ok(heading.h1 === 'Database', 'the page says Database, not Settings', `h1: ${heading.h1}`);
ok(heading.h2 === 'Publications', 'with Publications as the screen', `h2: ${heading.h2}`);

// 2 · A table, full width, with the facts that were competing for one line.
// Headers are uppercased by CSS, so compare the text, not the casing.
const cols = await page.evaluate(() =>
  [...document.querySelectorAll('.app-main table.table thead th')].map(t => t.innerText.trim().toLowerCase()));
ok(['publication', 'tier', 'coverage', 'journalists', 'region', 'feed'].every(c => cols.includes(c)),
   'every fact has its own column', cols.filter(Boolean).join(' | '));

// Measured against the card's own inner box and the card against the canvas,
// rather than table-against-canvas: the first version of this assertion did
// the latter and read the page's gutters and the card's padding as the table
// failing to be full width.
const width = await page.evaluate(() => {
  const t = document.querySelector('.app-main table.table');
  const card = t.closest('.card');
  const m = document.querySelector('.app-main');
  // clientWidth excludes the card's 2px border; getBoundingClientRect does
  // not, and subtracting only the padding left a phantom 4px shortfall.
  const cs = getComputedStyle(card);
  const inner = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const mcs = getComputedStyle(m);
  const canvas = m.getBoundingClientRect().width
    - parseFloat(mcs.paddingLeft) - parseFloat(mcs.paddingRight);
  return { table: t.getBoundingClientRect().width, inner, card: card.getBoundingClientRect().width, canvas };
});
ok(width.table >= width.inner - 1, 'the table fills the card',
   `${Math.round(width.table)} of ${Math.round(width.inner)}`);
ok(width.card >= width.canvas - 1, 'and the card fills the canvas',
   `${Math.round(width.card)} of ${Math.round(width.canvas)}`);
ok(!(await page.evaluate(() => !!document.querySelector('.app-main .ds-workbench--sidebar'))),
   'the 300px picker rail is gone');

const rows = await page.evaluate(() => document.querySelectorAll('.app-main table.table tbody tr').length);
ok(rows === 500, 'the list draws its 500-row page', `rows: ${rows}`);

// 3 · The record opens in a modal, not a third of the screen.
await page.evaluate(() => {
  [...document.querySelectorAll('.app-main table.table tbody button.btn-link')]
    .find(b => b.innerText.trim() === 'Dezeen')?.click();
});
await page.waitForTimeout(900);
ok(await page.evaluate(() => !!document.querySelector('.modal-backdrop .modal')),
   'clicking a publication opens a modal');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
ok(!(await page.evaluate(() => !!document.querySelector('.modal-backdrop'))), 'and Escape closes it');

// 4 · The bulk delete. First, that the button no longer claims more than it does.
let text = await main();
ok(/Delete all 500 shown/.test(text), 'the button says what it will delete',
   (text.match(/Delete all [\d,]+ \w+/) || [])[0]);
ok(!/Delete all 620 matching/.test(text), 'and not the 620 that match but are not drawn');

const before = await state();
ok(before.count === 620, 'and there are 620 to start with', `count: ${before.count}`);

await page.evaluate(() => {
  [...document.querySelectorAll('.app-main button')].find(b => /Delete all/.test(b.innerText))?.click();
});
await page.waitForTimeout(600);

let dialog = await page.evaluate(() => document.querySelector('.modal-backdrop .modal')?.innerText || '');
ok(/Delete 500 publications\?/.test(dialog), 'the confirm names the count', dialog.split('\n')[0]);
ok(/detached, not deleted/.test(dialog), 'and says what happens to the journalists and coverage');
ok(/120 more match and are left alone/.test(dialog), 'and names what it is leaving behind');
ok(/cannot be undone/i.test(dialog), 'and that it cannot be undone');

// Nothing goes until the count is typed.
let armed = await page.evaluate(() =>
  !document.querySelector('.modal-backdrop .modal button.btn-danger').disabled);
ok(!armed, 'the delete button starts disabled');

// Enter on an empty field must not fire it either, which is what confirm() did.
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
let mid = await state();
ok(mid.count === 620, 'pressing Return with nothing typed deletes nothing', `count: ${mid.count}`);
ok(await page.evaluate(() => !!document.querySelector('.modal-backdrop')), 'and the dialog stays open');

// A wrong number does not arm it.
await page.evaluate(() => { const i = document.querySelector('.modal-backdrop .modal input'); i.focus(); });
await page.keyboard.type('50');
await page.waitForTimeout(300);
armed = await page.evaluate(() =>
  !document.querySelector('.modal-backdrop .modal button.btn-danger').disabled);
ok(!armed, 'a near-miss does not arm it either');

// The right number does.
await page.keyboard.type('0');
await page.waitForTimeout(300);
armed = await page.evaluate(() =>
  !document.querySelector('.modal-backdrop .modal button.btn-danger').disabled);
ok(armed, 'typing 500 arms it');

await page.evaluate(() => document.querySelector('.modal-backdrop .modal button.btn-danger').click());
await page.waitForTimeout(1200);
const after = await state();
ok(after.lastBulk === 500, 'exactly the 500 shown were sent for deletion', `sent: ${after.lastBulk}`);
ok(after.count === 120, 'and the 120 that were never drawn survive', `left: ${after.count}`);
ok(!(await page.evaluate(() => !!document.querySelector('.modal-backdrop'))), 'the dialog closes on success');

// 5 · Cancel is a real way out.
await page.waitForTimeout(600);
await page.evaluate(() => {
  [...document.querySelectorAll('.app-main button')].find(b => /Delete all/.test(b.innerText))?.click();
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  [...document.querySelectorAll('.modal-backdrop .modal button')].find(b => b.innerText.trim() === 'Cancel')?.click();
});
await page.waitForTimeout(600);
const final = await state();
ok(final.count === 120, 'cancelling deletes nothing', `count: ${final.count}`);

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await page.screenshot({ path: '/tmp/claude-0/-home-user-claude/678f754e-8874-5413-b278-fc834fcb4dab/scratchpad/pubs.png' });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
