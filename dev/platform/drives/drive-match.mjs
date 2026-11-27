// Earned → Match: one list, and the two ways out of it.
//
// This screen replaced two cards that asked the same question with two boxes
// to paste the same release into. Everything it has to get right is about
// what happens to rows after they are ranked, and none of it is visible to
// lint or to a build.
//
// Three rows in the fixture, for the three cases the merge exists to handle:
// one both engines picked (scored, with a reason), one only the ranker found
// (scored, topic chips, a guessed address), and one only Claude found (no
// score, no address, a reason). The last is the one the merge exists for: the
// free matcher structurally cannot return a contact with no email, so if it
// is missing from this table it is missing from the product.
//
//   node drive-match.mjs      (with stub-server.js running on 4599)

import { load } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await load();
const here = path.dirname(fileURLToPath(import.meta.url));
const B = 'http://127.0.0.1:4599';
const SENT = path.join(here, 'segment-members.log');

let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };

try { fs.writeFileSync(SENT, ''); } catch { /* first run */ }
const lastSent = () => {
  const lines = (fs.existsSync(SENT) ? fs.readFileSync(SENT, 'utf8') : '').trim().split('\n').filter(Boolean);
  try { return lines.length ? JSON.parse(lines[lines.length - 1]) : null; } catch { return null; }
};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1300 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const card = () => page.locator('.card').filter({ hasText: 'Who should I pitch this to?' }).first();
const rows = () => page.locator('table tbody tr').filter({ has: page.locator('input[type="checkbox"]') });
const rowFor = (name) => rows().filter({ hasText: name }).first();

await page.goto(`${B}/clients/c1/pr/match`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// ── one card, three ways in ──────────────────────────────────────────────────

ok(await card().count() === 1, 'one card, not two');
ok(await page.locator('h3', { hasText: 'Best contacts for a story' }).count() === 0,
   'the second card is gone', 'two boxes for one release was the thing being fixed');

const text = await card().innerText();
ok(/Start from a release/i.test(text), 'the release already in OMI can be picked');
ok(/Press release URL/i.test(text), 'a URL can be pasted');
ok(/or the story itself/i.test(text), 'or the story typed');

ok(await page.locator('button:has-text("Rank contacts")').isDisabled(),
   'nothing to rank yet, so the button is disabled',
   'clicking and then being told off is a wasted click and a wasted second');

// ── the list ─────────────────────────────────────────────────────────────────

await page.locator('textarea').first().fill('A Margate studio opens its first public workshop this spring.');
await page.locator('button:has-text("Rank contacts")').click();
await page.waitForTimeout(900);

ok(await rows().count() === 3, 'every match is in one table', `${await rows().count()} rows`);

const imogen = await rowFor('Imogen Clarke').innerText();
ok(/no email/i.test(imogen),
   'the contact with no address is in the list, flagged',
   'the free matcher cannot return these at all, so dropping them here hides them completely');
ok(/—/.test(imogen),
   'and shows a dash for fit rather than a nought',
   'a row with no score must not read as a 0% match');

ok(/guess/i.test(await rowFor('Tom Hale').innerText()),
   'a guessed address is called a guess');

const order = await rows().allInnerTexts();
ok(/Anna Fitzgerald/.test(order[0]) && /Tom Hale/.test(order[1]),
   'the list is in fit order', order.map(o => o.split('\n')[0]).join(' / '));

// ── the two ways out ─────────────────────────────────────────────────────────

ok(await page.locator('button:has-text("Export")').count() === 1, 'the list can be exported');

await rowFor('Anna Fitzgerald').locator('input[type="checkbox"]').check();
await rowFor('Imogen Clarke').locator('input[type="checkbox"]').check();
await page.waitForTimeout(200);

const resultsCard = page.locator('.card').filter({ hasText: /match(es)?/ }).last();
ok(/2 selected/.test(await resultsCard.innerText()),
   'the count follows the selection');
ok(/Export 2/.test(await page.locator('button:has-text("Export")').innerText()),
   'and the export button says what it will export',
   'you will not pitch all of them, so the selection is the unit');

// What the file actually holds, not what the button claims. Asserting only
// the label let a mutation that exported every row while the button said
// "Export 2" go straight through: the button lying is the whole failure.
const dl = page.waitForEvent('download');
await page.locator('button:has-text("Export")').click();
const file = await dl;
const csv = fs.readFileSync(await file.path(), 'utf8');
const dataRows = csv.trim().split('\n').slice(1);

ok(dataRows.length === 2, 'the export contains exactly the selection', `${dataRows.length} rows`);
ok(/Anna Fitzgerald/.test(csv) && /Imogen Clarke/.test(csv), 'both selected contacts are in it');
ok(!/Tom Hale/.test(csv), 'and the unselected one is not',
   'exporting everything while the button says "Export 2" is the button lying');
ok(/no email/.test(csv), 'the unmailable contact is exported, with its state',
   'this is the list you hand to someone to go and find addresses');
ok(csv.charCodeAt(0) === 0xfeff, 'it carries a byte-order mark',
   'without one Excel on Windows renders £ as Â£');

const addLabel = await page.locator('button:has-text("to an audience")').innerText();
ok(/Add 1 to an audience/.test(addLabel),
   'the audience button counts only the ones that can be emailed',
   `says "${addLabel}" with 2 selected, one of whom has no address`);

ok(await page.locator('text=/no usable address/').count() > 0,
   'and says plainly why the two numbers differ');

await page.locator('button:has-text("to an audience")').click();
await page.waitForTimeout(400);
// Scoped to the audience callout: the release picker is a select too, and
// `.last()` found a hidden one in the shell.
const addCallout = page.locator('.callout').filter({ hasText: 'Add to' }).first();
await addCallout.locator('select').selectOption({ label: 'Trade press' });
await addCallout.locator('button:has-text("Add")').click();
await page.waitForTimeout(600);

const sent = lastSent();
ok(!!sent && sent.contact_ids.length === 1 && sent.contact_ids[0] === 'jm1',
   'only the mailable contact is sent to the audience',
   JSON.stringify(sent));

ok(errors.length === 0, 'no page errors', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
