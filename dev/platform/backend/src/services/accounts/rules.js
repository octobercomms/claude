// Rules engine for the Accounts module.
//
// The single most important design decision: "learn once, remember" is built
// as a rules table, not as LLM memory. A rule hit is deterministic, needs no
// AI call, and is fully auditable.
//
// Head (the 80%): Postgres acct_rules table. Payee pattern to account code.
// Long tail (the 20%): Claude classifies, human confirms, rule is born.

const db = require('../../db');

function escapeLike(str) {
  return str.replace(/[%_\\]/g, '\\$&');
}

async function findMatch(payee, currency) {
  if (!payee) return null;
  const normalised = payee.trim().toLowerCase();

  // Exact matches first (highest confidence).
  const { rows: exact } = await db.query(
    `SELECT * FROM acct_rules
     WHERE match_type = 'exact' AND lower(payee_pattern) = $1
       AND (currency IS NULL OR currency = $2)
     ORDER BY times_confirmed DESC LIMIT 1`,
    [normalised, currency || 'GBP']
  );
  if (exact.length) return exact[0];

  // starts_with matches: escaped payee_pattern used as LIKE prefix.
  const { rows: starts } = await db.query(
    `SELECT * FROM acct_rules
     WHERE match_type = 'starts_with'
       AND $1 LIKE replace(replace(replace(lower(payee_pattern), '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%' ESCAPE '\\'
       AND (currency IS NULL OR currency = $2)
     ORDER BY times_confirmed DESC LIMIT 1`,
    [normalised, currency || 'GBP']
  );
  if (starts.length) return starts[0];

  // Contains matches: escaped payee_pattern used as LIKE substring.
  const { rows: contains } = await db.query(
    `SELECT * FROM acct_rules
     WHERE match_type = 'contains'
       AND $1 LIKE '%' || replace(replace(replace(lower(payee_pattern), '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%' ESCAPE '\\'
       AND (currency IS NULL OR currency = $2)
     ORDER BY times_confirmed DESC LIMIT 1`,
    [normalised, currency || 'GBP']
  );
  if (contains.length) return contains[0];

  return null;
}

async function createRule(data) {
  const { rows } = await db.query(
    `INSERT INTO acct_rules (payee_pattern, match_type, account_code, account_name, tax_rate, currency, confidence, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      data.payee_pattern || data.payeePattern,
      data.match_type || data.matchType || 'contains',
      data.account_code || data.accountCode,
      data.account_name || data.accountName || null,
      data.tax_rate || data.taxRate || null,
      data.currency || null,
      data.confidence || 1.0,
      data.notes || null,
    ]
  );
  return rows[0];
}

async function updateRule(id, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  for (const [keys, col] of [
    [['payee_pattern', 'payeePattern'], 'payee_pattern'],
    [['match_type', 'matchType'], 'match_type'],
    [['account_code', 'accountCode'], 'account_code'],
    [['account_name', 'accountName'], 'account_name'],
    [['tax_rate', 'taxRate'], 'tax_rate'],
    [['currency'], 'currency'],
    [['confidence'], 'confidence'],
    [['notes'], 'notes'],
  ]) {
    const key = keys.find(k => data[k] !== undefined);
    if (key) {
      fields.push(`${col} = $${idx}`);
      values.push(data[key]);
      idx++;
    }
  }

  if (!fields.length) return null;
  fields.push(`updated_at = now()`);
  values.push(id);

  const { rows } = await db.query(
    `UPDATE acct_rules SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function deleteRule(id) {
  const { rowCount } = await db.query('DELETE FROM acct_rules WHERE id = $1', [id]);
  return rowCount > 0;
}

async function listRules(opts = {}) {
  let where = '';
  const params = [];
  if (opts.search) {
    const escaped = escapeLike(opts.search.toLowerCase());
    params.push(`%${escaped}%`);
    where = `WHERE lower(payee_pattern) LIKE $1 ESCAPE '\\' OR lower(account_name) LIKE $1 ESCAPE '\\'`;
  }
  const { rows } = await db.query(
    `SELECT * FROM acct_rules ${where} ORDER BY times_confirmed DESC, last_seen DESC NULLS LAST`,
    params
  );
  return rows;
}

// Bump a rule's confirmation count and last-seen timestamp.
async function confirmRule(ruleId) {
  await db.query(
    `UPDATE acct_rules SET times_confirmed = times_confirmed + 1, last_seen = now(), updated_at = now()
     WHERE id = $1`,
    [ruleId]
  );
}

// Promote a confirmation into a new rule (the AI -> deterministic path).
async function promoteToRule(confirmation) {
  const existing = await findMatch(confirmation.payee, confirmation.currency);
  if (existing) {
    await confirmRule(existing.id);
    return existing;
  }
  return createRule({
    payeePattern: confirmation.payee.trim().toLowerCase(),
    matchType: 'contains',
    accountCode: confirmation.confirmed_code,
    accountName: confirmation.confirmed_name || null,
    taxRate: confirmation.confirmed_rate || null,
    currency: confirmation.currency || null,
    confidence: 0.9,
    notes: confirmation.reasoning ? `AI-originated: ${confirmation.reasoning.substring(0, 200)}` : null,
  });
}

module.exports = {
  findMatch,
  createRule,
  updateRule,
  deleteRule,
  listRules,
  confirmRule,
  promoteToRule,
};
