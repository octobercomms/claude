// A figure in a currency never travels without the sentence that qualifies it.
//
// `/sales-traffic` answers three things about money, not one: `currency` (the
// symbol to print), `notes` (why that symbol may be wrong — stores reporting
// different currencies, or one disagreeing with the client's setting) and
// `currency_unset` (nobody has said). services/ecomCurrency.js computes all
// three precisely so a mixed-currency sum is never stamped with one store's
// symbol and read as fact.
//
// Two screens took the symbol and dropped the sentence: the client-facing
// ClientHomeDashboard and PillarMeasure, both of which print revenue with no
// way for the reader to know it is a plain sum across currencies. Nothing
// failed; the number simply read as true. MeasurePanel had it right, which is
// why the gap survived — reviewing the component that was correct tells you
// nothing about the two that were not.
//
// So this is a repository scan, not a test of one component. Any future screen
// that formats money out of this endpoint has to carry the caveat too, and a
// human noticing is not a plan.
//
//   node --test tests/moneyCaveat.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { walk(p, out); continue; }
    if (/\.(jsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

// Comments stripped, so prose about notes never counts as rendering one.
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const CALLS_ENDPOINT = /['"`][^'"`]*\/sales-traffic\//;
const FORMATS_MONEY = /\bformatMoney\s*\(|\bfmtMoney\s*\(/;
// Rendering the caveat: reads `notes` off the response, and reads
// `currency_unset`. Both, because they answer different questions and a screen
// showing only one still misleads in the other case.
const SHOWS_NOTES = /\bnotes\b/;
const SHOWS_UNSET = /currency_unset|currencyUnset/;

function audit(files) {
  const offenders = [];
  for (const file of files) {
    const src = code(fs.readFileSync(file, 'utf8'));
    if (!CALLS_ENDPOINT.test(src) || !FORMATS_MONEY.test(src)) continue;
    const missing = [];
    if (!SHOWS_NOTES.test(src)) missing.push('notes');
    if (!SHOWS_UNSET.test(src)) missing.push('currency_unset');
    if (missing.length) offenders.push(`${path.basename(file)} (missing: ${missing.join(', ')})`);
  }
  return offenders;
}

test('every screen that prints money from /sales-traffic shows its caveat', () => {
  const files = walk(SRC);
  const users = files.filter(f => {
    const src = code(fs.readFileSync(f, 'utf8'));
    return CALLS_ENDPOINT.test(src) && FORMATS_MONEY.test(src);
  });

  // If this hits zero the scan has stopped looking at anything, and an empty
  // offender list below would be meaningless.
  assert.ok(users.length >= 3,
    `expected at least 3 screens formatting money from /sales-traffic, found ${users.length}: `
    + users.map(f => path.basename(f)).join(', '));

  assert.deepStrictEqual(audit(files), [],
    'these print a currency symbol without the sentence that qualifies it');
});

test('the scan would catch a screen that drops the caveat', async (t) => {
  // Positive control. The real check passing means nothing unless this can
  // fail, and the first draft of a scan like this matched its own comments.
  const dir = fs.mkdtempSync(path.join(SRC, '..', '.scan-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (name, body) => { fs.writeFileSync(path.join(dir, name), body); return path.join(dir, name); };

  const bad = write('Bad.jsx', `
    api.get(\`/sales-traffic/\${id}?start=\${a}&end=\${b}\`).then(setData);
    return <div>{formatMoney(d.revenue, d.currency)}</div>;
  `);
  assert.strictEqual(audit([bad]).length, 1, 'a screen with neither was not caught');
  assert.match(audit([bad])[0], /notes/);
  assert.match(audit([bad])[0], /currency_unset/);

  // Half of it is still a gap: notes shown, nothing said when nobody set one.
  const half = write('Half.jsx', `
    api.get(\`/sales-traffic/\${id}\`).then(setData);
    return <><span>{formatMoney(d.revenue, d.currency)}</span><p>{d.notes.join(' ')}</p></>;
  `);
  assert.strictEqual(audit([half]).length, 1, 'a screen missing only currency_unset was passed');
  assert.match(audit([half])[0], /currency_unset/);
  assert.doesNotMatch(audit([half])[0], /missing: notes/);

  // A comment mentioning them is not rendering them.
  const commented = write('Commented.jsx', `
    // notes and currency_unset are handled elsewhere
    /* notes */
    api.get(\`/sales-traffic/\${id}\`).then(setData);
    return <div>{formatMoney(d.revenue, d.currency)}</div>;
  `);
  assert.strictEqual(audit([commented]).length, 1, 'a comment was accepted as the caveat');

  // And the scan leaves alone what it should: no money, or no endpoint.
  const noMoney = write('NoMoney.jsx', `
    api.get(\`/sales-traffic/\${id}\`).then(setData);
    return <div>{d.sessions}</div>;
  `);
  const noEndpoint = write('NoEndpoint.jsx', `
    api.get('/ads/summary').then(setData);
    return <div>{formatMoney(d.spend, d.currency)}</div>;
  `);
  assert.deepStrictEqual(audit([noMoney, noEndpoint]), [],
    'the scan fired on a screen it has no business flagging');
});
