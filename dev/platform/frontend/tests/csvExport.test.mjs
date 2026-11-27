// What goes into an exported CSV, and what must not come back out of it.
//
// Every table that exports had its own copy of this code. The copies agree on
// the easy part and differ on the parts that only break on someone else's
// machine, which is why there is one now.
//
// The case that matters most is the first one. These exports carry journalist
// names, outlet names and matched-topic strings scraped from the open web, so
// the content is not ours. A cell beginning "=" is a formula to Excel and to
// Sheets, and an export of scraped data is exactly where one arrives. The
// guard is a leading apostrophe, which both read as text.
//
//   node --test tests/csvExport.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv, csvCell, csvEscape, csvSlug } from '../src/utils/csv.js';

const COLS = [['Name', r => r.name], ['Outlet', r => r.outlet], ['Fit', r => r.fit]];

test('a cell that would be a formula is neutralised', () => {
  // Excel and Sheets evaluate all four of these.
  for (const nasty of ['=1+1', '+1', '-1', '@SUM(A1)']) {
    assert.equal(csvCell(nasty), `'${nasty}`,
      `${nasty} reached the file as a formula — these exports carry scraped names`);
  }
  // A tab or carriage return at the start does the same thing in some
  // importers by shifting what the parser thinks the first character is.
  assert.equal(csvCell('\them'), "'\them");
});

test('ordinary text is left exactly alone', () => {
  for (const plain of ['Anna Fitzgerald', 'Dezeen', '82%', 'e-commerce', '', '0', 'a-b']) {
    assert.equal(csvCell(plain), plain,
      `the guard rewrote "${plain}", which would put an apostrophe in front of real copy`);
  }
  // A hyphen INSIDE a word is not a leading one.
  assert.equal(csvCell('Jean-Pierre'), 'Jean-Pierre');
  // A negative number genuinely does start with "-", and genuinely is a
  // formula character. Correctness beats tidiness: it gets the guard.
  assert.equal(csvCell('-12'), "'-12");
});

test('commas, quotes and newlines survive a round trip', () => {
  assert.equal(csvEscape('Smith, Anna'), '"Smith, Anna"');
  assert.equal(csvEscape('he said "no"'), '"he said ""no"""');
  assert.equal(csvEscape('line one\nline two'), '"line one\nline two"');
  assert.equal(csvEscape('plain'), 'plain');
});

test('the file has a header row and one row per record', () => {
  const csv = buildCsv(COLS, [
    { name: 'Anna Fitzgerald', outlet: 'Dezeen', fit: 82 },
    { name: 'Tom Hale', outlet: 'Wallpaper*', fit: 74 },
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3, 'header plus two rows');
  assert.equal(lines[0], 'Name,Outlet,Fit');
  assert.equal(lines[1], 'Anna Fitzgerald,Dezeen,82');
});

test('CRLF line endings, because Excel needs them', () => {
  const csv = buildCsv(COLS, [{ name: 'A', outlet: 'B', fit: 1 }]);
  assert.ok(csv.includes('\r\n'), 'bare \\n leaves Excel showing one long row');
});

test('no rows still produces a usable file', () => {
  // An empty export must be a header, not an empty file: a zero-byte download
  // reads as a broken button rather than as an empty result.
  assert.equal(buildCsv(COLS, []), 'Name,Outlet,Fit');
  assert.equal(buildCsv(COLS, null), 'Name,Outlet,Fit');
});

test('a missing value is empty, not the word undefined', () => {
  const csv = buildCsv(COLS, [{ name: 'Anna' }]);
  assert.equal(csv.split('\r\n')[1], 'Anna,,',
    'null and undefined reached the file as text, which an importer then stores');
});

test('the filename stem is safe and bounded', () => {
  assert.equal(csvSlug('Northgate Studio', 'Q4 / 2026'), 'northgate-studio-q4-2026');
  assert.equal(csvSlug('  '), 'export', 'an empty stem would produce a file called ".csv"');
  assert.equal(csvSlug(null, undefined), 'export');
  // A path separator must not survive into a download filename.
  assert.ok(!csvSlug('../../etc/passwd').includes('/'));
  assert.ok(csvSlug('x'.repeat(200)).length <= 60);
});
