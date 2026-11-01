// Biz dev → Leads: archive, and a permanent delete with a real confirm.
import pw from './pw.mjs';
const browser = await pw.chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const B = 'http://127.0.0.1:4599';
const state = () => page.evaluate(async () => (await fetch('/__leads')).json());
const rows = () => page.evaluate(() =>
  [...document.querySelectorAll('.app-main table.table tbody tr')].map(r => r.innerText.replace(/\n/g, ' | ')));
const main = () => page.evaluate(() => document.querySelector('.app-main').innerText);

await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => fetch('/__leads/reset'));
await page.goto(`${B}/biz-dev/leads`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);

// 1 · Archived leads are out of the pipeline by default.
let r = await rows();
ok(r.length === 3, 'the three live leads are listed', `rows: ${r.length}`);
ok(!r.some(x => /Morrow Comms/.test(x)), 'and the archived one is not among them');
let text = await main();
ok(/Show archived \(1\)/.test(text), 'with a way to see it, and a count', (text.match(/Show archived \([0-9]+\)/) || [])[0]);

await page.evaluate(() => {
  [...document.querySelectorAll('.app-main input[type="checkbox"]')][0].click();
});
await page.waitForTimeout(400);
r = await rows();
ok(r.length === 4 && r.some(x => /Morrow Comms/.test(x)), 'ticking it brings the archived lead back into view');

// 2 · Archive is reversible, and does not open the lead it archived.
await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.app-main table.table tbody tr')]
    .find(x => /Northgate Studio/.test(x.innerText));
  [...tr.querySelectorAll('button')].find(b => b.innerText.trim() === 'Archive').click();
});
await page.waitForTimeout(1000);
ok(page.url().endsWith('/biz-dev/leads'), 'archiving stays on the list', page.url().split('/').slice(-2).join('/'));
let st = await state();
ok(st.lastPatch?.status === 'archived' && st.lastPatch?.id === 'l1',
   'and sends the status change for that lead', JSON.stringify(st.lastPatch));
ok(st.leads.find(l => l.id === 'l1')?.status === 'archived', 'which is stored');

await page.waitForTimeout(400);
const restore = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.app-main table.table tbody tr')]
    .find(x => /Northgate Studio/.test(x.innerText));
  const b = [...(tr?.querySelectorAll('button') || [])].find(x => x.innerText.trim() === 'Restore');
  if (b) { b.click(); return true; }
  return false;
});
ok(restore, 'an archived lead offers Restore rather than Archive');
await page.waitForTimeout(900);
st = await state();
ok(st.leads.find(l => l.id === 'l1')?.status !== 'archived', 'and restoring puts it back');

// 3 · Delete is permanent, and asks for the name.
await page.waitForTimeout(400);
await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.app-main table.table tbody tr')]
    .find(x => /Falcon Workshop/.test(x.innerText));
  tr.querySelector('button.btn-icon.danger').click();
});
await page.waitForTimeout(600);
let dialog = await page.evaluate(() => document.querySelector('.modal-backdrop .modal')?.innerText || '');
ok(/Delete Falcon Workshop\?/.test(dialog), 'the dialog names the lead', dialog.split('\n')[0]);
ok(/snapshot/.test(dialog) && /call notes/.test(dialog), 'and what goes with it');
ok(/Archive instead/.test(dialog), 'and offers the reversible option');
ok(/cannot be undone/i.test(dialog), 'and says it cannot be undone');

let armed = await page.evaluate(() => !document.querySelector('.modal-backdrop .modal button.btn-danger').disabled);
ok(!armed, 'it starts disabled');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
st = await state();
ok(st.lastDelete === null, 'Return with nothing typed deletes nothing', String(st.lastDelete));

// Typing the count, which is what a batch delete asks for, must NOT work here.
await page.evaluate(() => { document.querySelector('.modal-backdrop .modal input').focus(); });
await page.keyboard.type('1');
await page.waitForTimeout(300);
armed = await page.evaluate(() => !document.querySelector('.modal-backdrop .modal button.btn-danger').disabled);
ok(!armed, 'typing "1" does not arm a single named delete');

await page.evaluate(() => { const i = document.querySelector('.modal-backdrop .modal input'); i.value = ''; });
await page.evaluate(() => {
  const i = document.querySelector('.modal-backdrop .modal input');
  i.focus(); i.select();
});
await page.keyboard.press('Backspace');
await page.keyboard.type('Falcon Workshop');
await page.waitForTimeout(300);
armed = await page.evaluate(() => !document.querySelector('.modal-backdrop .modal button.btn-danger').disabled);
ok(armed, 'typing the name arms it');

await page.evaluate(() => document.querySelector('.modal-backdrop .modal button.btn-danger').click());
await page.waitForTimeout(1100);
st = await state();
ok(st.lastDelete === 'l2', 'and the delete reaches the server', String(st.lastDelete));
ok(!st.leads.some(l => l.id === 'l2'), 'the lead is gone');
r = await rows();
ok(!r.some(x => /Falcon Workshop/.test(x)), 'and off the list');

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await page.screenshot({ path: '/tmp/claude-0/-home-user-claude/678f754e-8874-5413-b278-fc834fcb4dab/scratchpad/leads.png' });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
