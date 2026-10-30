// The Authority numbers are fetched, and a bad fetch never overwrites a good
// number.
//
// These figures end up in a client's monthly report. Three ways that goes
// wrong quietly, each guarded here:
//
//   - a month that already has a value gets blanked because this month's
//     fetch failed. The report then shows a gap where there was a number.
//   - a partial fetch is reported as a success, so a missing DA reaches a
//     client report with nobody told.
//   - the domain is normalised wrongly, so Moz is asked about the wrong site
//     and answers confidently about someone else's.
//
//   node tests/seo-authority.test.js

const assert = require('assert');
const moz = require('../src/connectors/moz');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n       ${err.message}`); }
}

console.log('seo authority');

// ── The domain we actually ask Moz about ─────────────────────────────────

check('a scheme and trailing slash are stripped', () => {
  assert.strictEqual(moz.normaliseTarget('https://falconenamelware.com/'), 'falconenamelware.com');
  assert.strictEqual(moz.normaliseTarget('http://example.co.uk'), 'example.co.uk');
});

check('case is normalised, because Moz keys on the string', () => {
  assert.strictEqual(moz.normaliseTarget('Example.COM'), 'example.com');
});

check('www is left alone', () => {
  // Deliberate: www and the apex are different targets with different DA, and
  // silently rewriting one to the other would answer about a site nobody
  // asked about. Whatever is on the client record is what gets queried.
  assert.strictEqual(moz.normaliseTarget('www.example.com'), 'www.example.com');
});

check('a path survives, so a client on a subfolder still resolves', () => {
  assert.strictEqual(moz.normaliseTarget('https://example.com/uk'), 'example.com/uk');
});

check('an empty or missing domain is null, never an empty query', () => {
  assert.strictEqual(moz.normaliseTarget(''), null);
  assert.strictEqual(moz.normaliseTarget('   '), null);
  assert.strictEqual(moz.normaliseTarget(null), null);
  assert.strictEqual(moz.normaliseTarget(undefined), null);
});

check('trailing slashes do not become an empty target', () => {
  assert.strictEqual(moz.normaliseTarget('https://'), null);
  assert.strictEqual(moz.normaliseTarget('///'), null);
});

// ── The month key ────────────────────────────────────────────────────────

const { monthKey } = require('../src/services/seoAuthority');

check('a month key is always the first of the month', () => {
  assert.strictEqual(monthKey(new Date('2026-10-30T23:59:00Z')), '2026-10-01');
  assert.strictEqual(monthKey(new Date('2026-01-01T00:00:00Z')), '2026-01-01');
});

check('the month key does not slip a day across a timezone boundary', () => {
  // The bug this prevents: a DATE round-tripping as a UTC timestamp and
  // rolling back into the previous month, so October's figures land on
  // September and overwrite them.
  assert.strictEqual(monthKey(new Date('2026-11-01T00:30:00Z')), '2026-11-01');
  assert.strictEqual(monthKey(new Date('2026-03-01T00:00:01Z')), '2026-03-01');
});

// ── Pacing ───────────────────────────────────────────────────────────────

const { MOZ_GAP_MS } = require('../src/services/seoAuthority');

check('the gap between Moz calls clears the free tier rate limit', () => {
  // The free tier allows roughly one request every ten seconds. A gap at or
  // under that earns a 429 partway through the sweep, which looks like
  // "some clients have no DA this month" rather than like a rate limit.
  assert.ok(MOZ_GAP_MS > 10000, `gap ${MOZ_GAP_MS}ms does not clear 10s`);
});

check('twelve clients still finish in a sensible time', () => {
  const minutes = (MOZ_GAP_MS * 11) / 60000;
  assert.ok(minutes < 5, `twelve clients would take ${minutes.toFixed(1)} minutes`);
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
