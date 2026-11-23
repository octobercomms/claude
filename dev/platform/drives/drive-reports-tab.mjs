// The Reports tab's setup: two cards, one client record, one Save.
//
// The agent guide has said since 29 October that three layout rules here are
// "invisible to lint, the tests and the build" and that the guard for them is
// a browser drive script. There was no such script. This is it.
//
// What it is really protecting. Every control on this screen edits ONE client
// record and the PUT sends all of it, so which card a field sits in is purely
// a claim about what that field covers — and a wrong claim here is silent.
// "Hold reports for review before sending" is one flag governing the weekly
// report and the monthly one, and it shipped inside the Monthly card, directly
// above "This month's focus", which really is monthly only. It read as a
// monthly setting. Nothing failed; it just said the wrong thing.
//
//   node drive-reports-tab.mjs      (with stub-server.js running on 4599)

import { load } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await load();
const here = path.dirname(fileURLToPath(import.meta.url));
const PUTS = path.join(here, 'put-clients.log');
const B = 'http://127.0.0.1:4599';

let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };

// The stub appends every client PUT here. Start from a known point so the
// last line is this drive's, not an earlier one's.
try { fs.writeFileSync(PUTS, ''); } catch { /* first run */ }
const lastPut = () => {
  const lines = (fs.existsSync(PUTS) ? fs.readFileSync(PUTS, 'utf8') : '').trim().split('\n').filter(Boolean);
  if (!lines.length) return null;
  try { return JSON.parse(lines[lines.length - 1]); } catch { return null; }
};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto(`${B}/clients/c1/dashboard/reports`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const weeklyCard = page.locator('.report-card').first();
const monthlyCard = page.locator('.report-card--monthly').first();
const hold = page.locator('label', { hasText: 'Hold reports for review before sending' }).first();

ok(await weeklyCard.count() === 1 && await monthlyCard.count() === 1, 'both setup cards are on the screen');

// ── the hold flag belongs to neither card, because it governs both ──────────

ok(await hold.count() === 1, 'the hold-for-review setting is on the screen');

const inMonthly = await monthlyCard.locator('input[type="checkbox"]').count();
ok(inMonthly === 0,
  'the hold setting is not inside the Monthly card',
  'one flag covering the weekly report too, drawn under a heading that says Monthly, reads as monthly only');

const holdBox = await hold.boundingBox();
const monthlyBox = await monthlyCard.boundingBox();
const weeklyBox = await weeklyCard.boundingBox();
ok(!!holdBox && !!monthlyBox && holdBox.y >= monthlyBox.y + monthlyBox.height - 2,
  'it sits below both cards',
  `hold at ${Math.round(holdBox?.y)}, monthly ends at ${Math.round(monthlyBox?.y + monthlyBox?.height)}`);

const holdText = await hold.innerText();
ok(/both the weekly and the monthly report/i.test(holdText),
  'and says in words which reports it covers',
  'without it, the only way to find out is to read reportService');

// ── it saves ────────────────────────────────────────────────────────────────

// Moving it away from the two cards left it with no button beside it, which
// is how a setting gets ticked and lost. It carries its own Save.
const holdCard = page.locator('.card').filter({ has: page.locator('input[type="checkbox"]') }).last();
ok(await holdCard.locator('button[type="submit"]').count() === 1,
  'the hold setting has a Save button of its own');

await hold.locator('input[type="checkbox"]').check();
await holdCard.locator('button[type="submit"]').click();
await page.waitForTimeout(700);

const saved = lastPut();
ok(saved && saved.review_before_send === true,
  'ticking it and saving sends review_before_send',
  JSON.stringify(saved && { review_before_send: saved.review_before_send }));

// ── one record, so either card's Save sends everything ──────────────────────

// This is the rule the two "Save changes" labels exist for. Edit a WEEKLY
// field, save from the MONTHLY card, and the weekly edit still has to travel:
// a per-section label would be a lie, and so would a per-section save.
const weeklyRecipients = weeklyCard.locator('textarea').first();
await weeklyRecipients.fill('someone@example.com');
await monthlyCard.locator('button[type="submit"]').click();
await page.waitForTimeout(700);

const crossSave = lastPut();
const weeklyTo = crossSave && crossSave.report_recipients && crossSave.report_recipients.weekly;
ok(Array.isArray(weeklyTo) && weeklyTo.includes('someone@example.com'),
  'saving from the Monthly card still carries a weekly edit',
  JSON.stringify(weeklyTo));
ok(crossSave && crossSave.review_before_send === true,
  'and does not drop the hold flag on the way',
  'every button here sends the whole record; one that sent part of it would quietly undo the rest');

// ── the layout rules the guide names ────────────────────────────────────────

ok(!!weeklyBox && !!monthlyBox && Math.abs(weeklyBox.width - monthlyBox.width) < 2,
  'the two cards are the same width');

const saveButtons = await page.locator('button[type="submit"]').allInnerTexts();
ok(saveButtons.every(t => !/save (weekly|monthly)/i.test(t)),
  'no Save button claims to save only its own section',
  JSON.stringify(saveButtons));

ok(errors.length === 0, 'no page errors', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
