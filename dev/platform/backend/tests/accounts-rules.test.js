// Accounts module — rules engine tests.
//
//   node tests/accounts-rules.test.js

const assert = require('assert');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// The rules module uses db calls, so we test the SEED_RULES data integrity
// and the pure-logic parts without hitting the database.

const path = require('path');
const rulesPath = path.resolve(__dirname, '../src/services/accounts/rules');

// Test SEED_RULES export.
let SEED_RULES;
try {
  SEED_RULES = require(rulesPath).SEED_RULES;
} catch {
  SEED_RULES = null;
}

console.log('SEED_RULES data integrity');

check('SEED_RULES is an array', () => {
  assert.ok(Array.isArray(SEED_RULES), 'SEED_RULES should be an array');
});

check('SEED_RULES has at least 20 entries', () => {
  assert.ok(SEED_RULES.length >= 20, `Expected >= 20, got ${SEED_RULES.length}`);
});

check('each seed rule has required fields', () => {
  for (const rule of SEED_RULES) {
    assert.ok(rule.payee_pattern, `Missing payee_pattern: ${JSON.stringify(rule)}`);
    assert.ok(rule.account_code, `Missing account_code: ${JSON.stringify(rule)}`);
    assert.ok(rule.account_name, `Missing account_name: ${JSON.stringify(rule)}`);
    assert.ok(rule.tax_rate, `Missing tax_rate: ${JSON.stringify(rule)}`);
  }
});

check('no duplicate payee patterns', () => {
  const patterns = SEED_RULES.map(r => r.payee_pattern.toLowerCase());
  const dupes = patterns.filter((p, i) => patterns.indexOf(p) !== i);
  assert.deepStrictEqual(dupes, [], `Duplicate patterns: ${dupes.join(', ')}`);
});

check('known reverse-charge suppliers use RRINPUT', () => {
  const rcPayees = ['meta', 'google ads', 'dataforseo', 'dropbox', 'slack', 'adobe', 'anthropic', 'openai'];
  for (const p of rcPayees) {
    const rule = SEED_RULES.find(r => r.payee_pattern.toLowerCase().includes(p));
    if (rule) {
      assert.strictEqual(rule.tax_rate, 'RRINPUT',
        `${rule.payee_pattern} should use RRINPUT, got ${rule.tax_rate}`);
    }
  }
});

check('HMRC rules use NONE tax rate', () => {
  const hmrc = SEED_RULES.filter(r => r.payee_pattern.toLowerCase().includes('hmrc'));
  for (const rule of hmrc) {
    assert.strictEqual(rule.tax_rate, 'NONE',
      `${rule.payee_pattern} should use NONE, got ${rule.tax_rate}`);
  }
});

check('all match_type values are valid', () => {
  const valid = ['contains', 'exact', 'starts_with', 'regex'];
  for (const rule of SEED_RULES) {
    const mt = rule.match_type || 'contains';
    assert.ok(valid.includes(mt), `Invalid match_type '${mt}' for ${rule.payee_pattern}`);
  }
});

check('account codes are non-empty strings', () => {
  for (const rule of SEED_RULES) {
    assert.ok(typeof rule.account_code === 'string' && rule.account_code.length > 0,
      `Bad account_code for ${rule.payee_pattern}`);
  }
});

// ── Summary ─────────────────────────────────────────────────────────

console.log(`\n${SEED_RULES?.length ?? 0} seed rules validated`);
process.exit(failed ? 1 : 0);
