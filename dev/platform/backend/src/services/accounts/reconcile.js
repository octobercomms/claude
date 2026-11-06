// Reconciliation service. Orchestrates the weekly poll:
// 1. Pull unreconciled bank lines from Xero
// 2. Match against the rules engine
// 3. Send unknown lines to Claude for classification
// 4. Queue everything for review
// 5. Optionally write confirmed lines back to Xero

const db = require('../../db');
const xero = require('../../connectors/xero');
const rules = require('./rules');
const { classifyBatch } = require('./classify');

async function pullAndClassify(opts = {}) {
  const token = await xero.getValidToken();
  const bankAccounts = await xero.getBankAccounts(token);

  let chartOfAccounts = null;
  try {
    chartOfAccounts = await xero.getChartOfAccounts(token);
  } catch (e) {
    console.warn('[Accounts] Could not fetch chart of accounts:', e.message);
  }

  let totalNew = 0;
  let totalRuleMatched = 0;
  let totalAiClassified = 0;

  for (const account of bankAccounts) {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const lines = await xero.getBankStatementLines(token, account.accountId, {
        since: opts.since,
        page,
      });

      if (!lines.length) { hasMore = false; break; }

      const needsClassification = [];

      for (const line of lines) {
        // Skip lines already in the queue.
        const { rows: existing } = await db.query(
          'SELECT id FROM acct_reconcile_queue WHERE line_ref = $1',
          [line.lineRef]
        );
        if (existing.length) continue;

        // Try the rules engine first.
        const rule = await rules.findMatch(line.payee || line.description, line.currency);

        if (rule && rule.confidence >= 0.8) {
          await insertQueueItem(line, {
            suggestedCode: rule.account_code,
            suggestedName: rule.account_name,
            suggestedRate: rule.tax_rate,
            confidence: rule.confidence,
            matchSource: 'rule',
          });
          totalRuleMatched++;
        } else {
          needsClassification.push(line);
        }
        totalNew++;
      }

      // Classify the unknown lines with Claude.
      if (needsClassification.length) {
        const classifications = await classifyBatch(needsClassification, chartOfAccounts);

        for (let i = 0; i < needsClassification.length; i++) {
          const line = needsClassification[i];
          const cls = classifications[i] || {};

          await insertQueueItem(line, {
            suggestedCode: cls.accountCode,
            suggestedName: cls.accountName,
            suggestedRate: cls.taxRate,
            confidence: cls.confidence || 0,
            matchSource: 'ai',
            aiReasoning: cls.reasoning,
          });
          totalAiClassified++;
        }
      }

      if (lines.length < 100) hasMore = false;
      else page++;
    }
  }

  return { totalNew, totalRuleMatched, totalAiClassified };
}

async function insertQueueItem(line, suggestion) {
  await db.query(
    `INSERT INTO acct_reconcile_queue
       (line_ref, bank_account, bank_account_id, line_date, amount, currency,
        payee, description, reference, suggested_code, suggested_name,
        suggested_rate, confidence, match_source, ai_reasoning, xero_line_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (line_ref) DO NOTHING`,
    [
      line.lineRef,
      line.bankAccount || null,
      line.bankAccountId || null,
      line.date || null,
      line.amount || null,
      line.currency || null,
      line.payee || null,
      line.description || null,
      line.reference || null,
      suggestion.suggestedCode || null,
      suggestion.suggestedName || null,
      suggestion.suggestedRate || null,
      suggestion.confidence || null,
      suggestion.matchSource || null,
      suggestion.aiReasoning || null,
      line.raw ? JSON.stringify(line.raw) : null,
    ]
  );
}

// Confirm a queue item: update status, record confirmation, promote to rule.
async function confirmItem(id, data) {
  const { rows } = await db.query('SELECT * FROM acct_reconcile_queue WHERE id = $1', [id]);
  if (!rows.length) throw new Error('Queue item not found');
  const item = rows[0];

  const confirmedCode = data.accountCode || item.suggested_code;
  const confirmedRate = data.taxRate || item.suggested_rate;

  // Update queue status.
  await db.query(
    `UPDATE acct_reconcile_queue SET status = 'confirmed', suggested_code = $1,
     suggested_rate = $2, updated_at = now() WHERE id = $3`,
    [confirmedCode, confirmedRate, id]
  );

  // Record the confirmation for audit.
  await db.query(
    `INSERT INTO acct_confirmations
       (line_ref, bank_account, proposed_code, proposed_rate, confirmed_code,
        confirmed_rate, reasoning, source, rule_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      item.line_ref,
      item.bank_account,
      item.suggested_code,
      item.suggested_rate,
      confirmedCode,
      confirmedRate,
      item.ai_reasoning || data.reasoning || null,
      item.match_source || 'manual',
      null,
    ]
  );

  // Promote to a rule so next time this payee hits, it's deterministic.
  if (item.payee) {
    await rules.promoteToRule({
      payee: item.payee,
      currency: item.currency,
      confirmed_code: confirmedCode,
      confirmed_name: data.accountName || item.suggested_name,
      confirmed_rate: confirmedRate,
      reasoning: item.ai_reasoning,
    });
  }

  return { id, status: 'confirmed', accountCode: confirmedCode, taxRate: confirmedRate };
}

// Batch confirm all high-confidence rule-matched items.
async function autoConfirmHighConfidence(threshold = 0.95) {
  const { rows } = await db.query(
    `SELECT id FROM acct_reconcile_queue
     WHERE status = 'pending' AND match_source = 'rule' AND confidence >= $1`,
    [threshold]
  );
  let count = 0;
  for (const row of rows) {
    await confirmItem(row.id, {});
    count++;
  }
  return count;
}

// Write confirmed items back to Xero (when WRITE_BACK_ENABLED=true).
async function writeBackToXero() {
  if (process.env.WRITE_BACK_ENABLED !== 'true') {
    return { written: 0, message: 'Write-back is disabled (WRITE_BACK_ENABLED != true)' };
  }

  const token = await xero.getValidToken();
  const { rows } = await db.query(
    `SELECT * FROM acct_reconcile_queue WHERE status = 'confirmed' ORDER BY line_date`
  );

  let written = 0;
  const errors = [];

  for (const item of rows) {
    try {
      await xero.createBankTransactionLineItems(token, item.line_ref, [{
        accountCode: item.suggested_code,
        taxRate: item.suggested_rate || 'NONE',
        description: item.description || '',
        amount: item.amount,
      }]);

      await db.query(
        `UPDATE acct_reconcile_queue SET status = 'written', updated_at = now() WHERE id = $1`,
        [item.id]
      );
      written++;
    } catch (err) {
      errors.push({ id: item.id, lineRef: item.line_ref, error: err.message });
      await db.query(
        `UPDATE acct_reconcile_queue SET status = 'error', updated_at = now() WHERE id = $1`,
        [item.id]
      );
    }
  }

  return { written, errors };
}

// Queue stats for the dashboard.
async function getQueueStats() {
  const { rows } = await db.query(`
    SELECT
      status,
      count(*)::int as count,
      coalesce(sum(amount), 0) as total_amount
    FROM acct_reconcile_queue
    GROUP BY status
  `);
  const stats = { pending: 0, confirmed: 0, written: 0, skipped: 0, error: 0, total: 0 };
  for (const r of rows) {
    stats[r.status] = r.count;
    stats.total += r.count;
  }
  return stats;
}

// Get queue items with filtering.
async function getQueueItems(opts = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (opts.status) {
    conditions.push(`status = $${idx}`);
    params.push(opts.status);
    idx++;
  }
  if (opts.bankAccount) {
    conditions.push(`bank_account = $${idx}`);
    params.push(opts.bankAccount);
    idx++;
  }
  if (opts.search) {
    conditions.push(`(lower(payee) LIKE $${idx} OR lower(description) LIKE $${idx})`);
    params.push(`%${opts.search.toLowerCase()}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit || 100;
  const offset = opts.offset || 0;

  const { rows } = await db.query(
    `SELECT * FROM acct_reconcile_queue ${where}
     ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END,
              confidence ASC NULLS FIRST, line_date DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  return rows;
}

async function skipItem(id) {
  await db.query(
    `UPDATE acct_reconcile_queue SET status = 'skipped', updated_at = now() WHERE id = $1`,
    [id]
  );
}

module.exports = {
  pullAndClassify,
  confirmItem,
  autoConfirmHighConfidence,
  writeBackToXero,
  getQueueStats,
  getQueueItems,
  skipItem,
};
