// Accounts module — reconciliation pure-logic tests.
//
//   node tests/accounts-reconcile.test.js

const assert = require('assert');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// getCurrentVatPeriod is unexported, so we test it indirectly via the module.
// We can still test the invoices matching logic.

const { findBestMatch } = require('../src/services/accounts/invoices');

// ── findBestMatch ───────────────────────────────────────────────────

console.log('findBestMatch (invoice-to-queue matching)');

const driveFiles = [
  { id: 'f1', name: 'DataForSEO-Invoice-250.00-2026-10.pdf', mimeType: 'application/pdf', modifiedTime: '2026-10-15T10:00:00Z' },
  { id: 'f2', name: 'receipt-coffee-5.50.jpg', mimeType: 'image/jpeg', modifiedTime: '2026-10-14T08:00:00Z' },
  { id: 'f3', name: 'adobe-creative-cloud-49.99.pdf', mimeType: 'application/pdf', modifiedTime: '2026-10-01T12:00:00Z' },
  { id: 'f4', name: 'random-document.pdf', mimeType: 'application/pdf', modifiedTime: '2026-01-01T00:00:00Z' },
];

check('matches by amount in filename', () => {
  const match = findBestMatch(
    { payee: 'Unknown', amount: '250.00', line_date: '2026-10-16' },
    driveFiles
  );
  assert.ok(match, 'Expected a match');
  assert.strictEqual(match.id, 'f1');
});

check('matches by payee name and amount', () => {
  const match = findBestMatch(
    { payee: 'DataForSEO', amount: '250.00', line_date: '2026-10-16' },
    driveFiles
  );
  assert.ok(match);
  assert.strictEqual(match.id, 'f1');
  assert.ok(match.confidence > 0.5, `Expected high confidence, got ${match.confidence}`);
});

check('matches Adobe invoice', () => {
  const match = findBestMatch(
    { payee: 'Adobe', amount: '49.99', line_date: '2026-10-02' },
    driveFiles
  );
  assert.ok(match);
  assert.strictEqual(match.id, 'f3');
});

check('returns null for unmatched transaction', () => {
  const match = findBestMatch(
    { payee: 'Completely Unknown Vendor', amount: '999.99', line_date: '2024-01-01' },
    driveFiles
  );
  assert.strictEqual(match, null);
});

check('confidence is capped at 1.0', () => {
  const match = findBestMatch(
    { payee: 'DataForSEO', amount: '250.00', line_date: '2026-10-15' },
    driveFiles
  );
  assert.ok(match);
  assert.ok(match.confidence <= 1.0, `Confidence ${match.confidence} exceeds 1.0`);
});

check('minimum confidence threshold is 0.3', () => {
  const emptyFiles = [
    { id: 'z1', name: 'holiday-photo.jpg', mimeType: 'image/jpeg', modifiedTime: '2020-06-01T00:00:00Z' },
  ];
  const match = findBestMatch(
    { payee: 'Unique Vendor Name XYZ', amount: '777.77', line_date: '2025-01-15' },
    emptyFiles
  );
  assert.strictEqual(match, null, 'Low-confidence match should be rejected');
});

// ── Summary ─────────────────────────────────────────────────────────

console.log('');
process.exit(failed ? 1 : 0);
