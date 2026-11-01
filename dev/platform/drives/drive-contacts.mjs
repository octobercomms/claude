// Database → Journalists: sort, on the server.
//
// Search already worked and was already server-side, for the reason sorting
// now is: the library holds 21,000 contacts and the list draws a 200-row
// page, so doing either in the browser orders or filters the page you happen
// to be looking at and calls it the library.
import pw from './pw.mjs';
const browser = await pw.chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const B = 'http://127.0.0.1:4599';
const q = () => page.evaluate(async () => (await fetch('/__lib')).json());
const col = (i) => page.evaluate((n) =>
  [...document.querySelectorAll('.app-main table.contacts-list-table tbody tr')]
    .map(r => (r.children[n]?.innerText || '').trim()), i);
const headers = () => page.evaluate(() =>
  [...document.querySelectorAll('.app-main table.contacts-list-table thead th')].map(t => t.innerText.trim()));
// Headers are uppercased by CSS, so match on the text, not the casing.
const clean = (t) => t.trim().replace(/[▲▼]\s*$/, '').trim().toLowerCase();
const click = (label) => page.evaluate((l) => {
  const strip = (t) => t.trim().replace(/[\u25b2\u25bc]\s*$/, '').trim().toLowerCase();
  const b = [...document.querySelectorAll('.app-main table.contacts-list-table thead button.th-sort')]
    .find(x => strip(x.innerText) === l.toLowerCase());
  if (!b) return false;
  b.click();
  return true;
}, label);

await page.goto(`${B}/database/journalists`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

ok((await headers()).length > 5, 'the library table renders', (await headers()).join(' | '));
let rows = await col(1);
ok(rows.length === 200, 'and draws a 200-row page of 420', `rows: ${rows.length}`);

// Which is the point: a client-side sort could only ever order these 200.
let state = await q();
ok(state.count === 420, 'while the library holds 420', `count: ${state.count}`);
ok(state.lastQuery?.sort === 'created_at' && state.lastQuery?.dir === 'desc',
   'the first load asks the server for newest first', JSON.stringify(state.lastQuery));

// Sortable columns, and the ones that are deliberately not.
const sortable = (await page.evaluate(() =>
  [...document.querySelectorAll('.app-main table.contacts-list-table thead button.th-sort')]
    .map(b => b.innerText))).map(clean);
ok(['Name', 'Email', 'Publication', 'Country', 'Beat', 'Engagement'].every(c => sortable.includes(c.toLowerCase())),
   'every column worth sorting is sortable', sortable.join(' | '));
ok(!sortable.includes('Tags') && !sortable.includes('Attached to'),
   'and the two array columns are not, because sorting a list sorts by whichever is first');

// Name ascending: the server is asked, and the page comes back in order.
ok(await click('Name'), 'Name is clickable');
await page.waitForTimeout(900);
state = await q();
ok(state.lastQuery?.sort === 'name' && state.lastQuery?.dir === 'asc',
   'one click asks for Name ascending — A-first is what "sort by name" means',
   JSON.stringify(state.lastQuery));
let names = (await col(1)).map(t => t.split('\n')[0].toLowerCase());
ok(names.length > 2 && names.every((n, i) => i === 0 || names[i - 1] <= n),
   'and the rows arrive in that order', `${names[0]} … ${names[names.length - 1]}`);
ok(/^amy/.test(names[0]), 'starting at the top of the alphabet', names[0]);

// Clicking it again flips it, and the arrow says which way.
ok(await click('Name'), 'Name is clickable again');
await page.waitForTimeout(900);
state = await q();
ok(state.lastQuery?.dir === 'desc', 'the second click flips it', JSON.stringify(state.lastQuery));
names = (await col(1)).map(t => t.split('\n')[0].toLowerCase());
ok(names.every((n, i) => i === 0 || names[i - 1] >= n), 'and the order flips with it');
const pip = await page.evaluate(() =>
  [...document.querySelectorAll('.app-main table.contacts-list-table thead button.th-sort')]
    .map(b => b.innerText.trim()).find(t => /^NAME/i.test(t)));
ok(/▼/.test(pip), 'with an arrow showing which way', pip);

// A count column starts at "most", not at zero.
ok(await click('Engagement'), 'Engagement is clickable');
await page.waitForTimeout(900);
state = await q();
ok(state.lastQuery?.sort === 'total_replied' && state.lastQuery?.dir === 'desc',
   'Engagement starts descending, because most replies is what you are after',
   JSON.stringify(state.lastQuery));

// Email: a contact with no email must not be the first thing you see when
// you sort by email to find the ones you can write to.
ok(await click('Email'), 'Email is clickable');
await page.waitForTimeout(900);
const emails = await col(2);
ok(emails[0] && emails[0] !== '—' && emails[0] !== '',
   'sorting by email puts the empty ones last, both ways', `first: ${JSON.stringify(emails[0])}`);
await click('Email');
await page.waitForTimeout(900);
const emailsDesc = await col(2);
ok(emailsDesc[0] && emailsDesc[0] !== '—' && emailsDesc[0] !== '',
   'and still last when reversed', `first: ${JSON.stringify(emailsDesc[0])}`);

// Search still reaches the server, and composes with the sort.
// Typed through the real input, not by assigning .value: React's controlled
// input ignores a direct write, which is how the first run of this drive
// "searched" without the component ever hearing about it.
const searchBox = await page.evaluateHandle(() =>
  [...document.querySelectorAll('.app-main input')].find(x => /search/i.test(x.placeholder || '')));
await searchBox.asElement().click();
await page.keyboard.type('Dezeen');
await page.waitForTimeout(1200);
state = await q();
ok(state.lastQuery?.search === 'Dezeen', 'search goes to the server', JSON.stringify(state.lastQuery));
ok(state.lastQuery?.sort === 'email', 'and keeps the sort you chose', state.lastQuery?.sort);
const pubs = await col(3);
ok(pubs.length > 0 && pubs.every(p => /Dezeen/.test(p)), 'every row matches', `${pubs.length} rows`);

// ── The red button on this screen, which really does delete all 21,000 ──────
//
// It had a confirm() and then, above 100 rows, a prompt() asking for the word
// DELETE. A fixed word becomes muscle memory in a week, and prompt() is
// blocked outright in some embedded views: it returns null and the delete
// silently does nothing, which teaches you the button is broken rather than
// guarded.
await page.evaluate(() => {
  const i = [...document.querySelectorAll('.app-main input')].find(x => /search/i.test(x.placeholder || ''));
  i.focus();
});
for (let k = 0; k < 6; k++) await page.keyboard.press('Backspace');
await page.waitForTimeout(1200);

await page.evaluate(() => {
  [...document.querySelectorAll('.app-main button')].find(b => /Delete all/.test(b.innerText))?.click();
});
await page.waitForTimeout(600);
let dialog = await page.evaluate(() => document.querySelector('.modal-backdrop .modal')?.innerText || '');
ok(/Delete 420 journalists\?/.test(dialog), 'the dialog names the real total, not the page', dialog.split('\n')[0]);
ok(/not only the 200 on screen/.test(dialog), 'and says so explicitly');
ok(/removed from every client/.test(dialog), 'and what else it takes');

let armed = await page.evaluate(() => !document.querySelector('.modal-backdrop .modal button.btn-danger').disabled);
ok(!armed, 'it starts disabled');
await page.evaluate(() => { document.querySelector('.modal-backdrop .modal input').focus(); });
await page.keyboard.type('DELETE');
await page.waitForTimeout(300);
armed = await page.evaluate(() => !document.querySelector('.modal-backdrop .modal button.btn-danger').disabled);
ok(!armed, 'typing DELETE no longer arms it, because a fixed word is muscle memory');

await page.keyboard.press('Enter');
await page.waitForTimeout(600);
let lib = await q();
ok(lib.count === 420, 'and Return on a wrong answer deletes nothing', `count: ${lib.count}`);

for (let k = 0; k < 6; k++) await page.keyboard.press('Backspace');
await page.keyboard.type('420');
await page.waitForTimeout(300);
armed = await page.evaluate(() => !document.querySelector('.modal-backdrop .modal button.btn-danger').disabled);
ok(armed, 'typing the count arms it');

await page.evaluate(() => {
  [...document.querySelectorAll('.modal-backdrop .modal button')].find(b => b.innerText.trim() === 'Cancel')?.click();
});
await page.waitForTimeout(600);
lib = await q();
ok(lib.count === 420, 'and cancelling still deletes nothing', `count: ${lib.count}`);

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await page.screenshot({ path: '/tmp/claude-0/-home-user-claude/678f754e-8874-5413-b278-fc834fcb4dab/scratchpad/contacts.png' });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
