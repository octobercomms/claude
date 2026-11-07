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
  const t0 = Date.now();
  console.log('[Accounts] Sync started', opts.since ? `(since ${opts.since})` : '(full)');

  console.log('[Accounts] Fetching valid token...');
  const token = await xero.getValidToken();
  console.log('[Accounts] Token OK (%dms)', Date.now() - t0);

  console.log('[Accounts] Fetching bank accounts...');
  const bankAccounts = await xero.getBankAccounts(token);
  console.log('[Accounts] Found %d bank account(s) (%dms)', bankAccounts.length, Date.now() - t0);

  let chartOfAccounts = null;
  try {
    console.log('[Accounts] Fetching chart of accounts...');
    chartOfAccounts = await xero.getChartOfAccounts(token);
    console.log('[Accounts] Chart of accounts: %d codes (%dms)', (chartOfAccounts || []).length, Date.now() - t0);
  } catch (e) {
    console.warn('[Accounts] Could not fetch chart of accounts:', e.message);
  }

  let queued = 0;
  let ruleMatched = 0;
  let aiClassified = 0;

  for (const account of bankAccounts) {
    console.log('[Accounts] Processing bank account %s (%s)', account.name, account.accountId);
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      console.log('[Accounts] Fetching page %d for %s...', page, account.name);
      const lines = await xero.getBankStatementLines(token, account.accountId, {
        since: opts.since,
        page,
      });
      console.log('[Accounts] Page %d: %d lines (%dms)', page, lines.length, Date.now() - t0);

      if (!lines.length) { hasMore = false; break; }

      const needsClassification = [];

      const lineRefs = lines.map(l => l.lineRef);
      const { rows: existingRows } = await db.query(
        'SELECT line_ref FROM acct_reconcile_queue WHERE line_ref = ANY($1)',
        [lineRefs]
      );
      const existingRefs = new Set(existingRows.map(r => r.line_ref));
      const newLines = lines.filter(l => !existingRefs.has(l.lineRef));
      console.log('[Accounts] %d already queued, %d new', existingRefs.size, newLines.length);

      for (const line of newLines) {
        const rule = await rules.findMatch(line.payee || line.description, line.currency);

        if (rule && rule.confidence >= 0.8) {
          await insertQueueItem(line, {
            suggestedCode: rule.account_code,
            suggestedName: rule.account_name,
            suggestedRate: rule.tax_rate,
            confidence: rule.confidence,
            matchSource: 'rule',
          });
          ruleMatched++;
        } else {
          needsClassification.push(line);
        }
        queued++;
      }

      console.log('[Accounts] Rules matched %d, need classification %d', ruleMatched, needsClassification.length);

      if (needsClassification.length) {
        console.log('[Accounts] Sending %d lines to AI classification...', needsClassification.length);
        const classifications = await classifyBatch(needsClassification, chartOfAccounts);
        console.log('[Accounts] AI classification returned (%dms)', Date.now() - t0);

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
          aiClassified++;
        }
      }

      if (lines.length < 100) hasMore = false;
      else page++;
    }
    console.log('[Accounts] Finished bank account %s', account.name);
  }

  console.log('[Accounts] Sync complete: %d queued, %d rule-matched, %d AI-classified (%dms)', queued, ruleMatched, aiClassified, Date.now() - t0);
  return { queued, ruleMatched, aiClassified };
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
       (queue_item_id, line_ref, bank_account, proposed_code, proposed_rate,
        confirmed_code, confirmed_rate, reasoning, source, rule_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      item.id,
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

  await checkVatExceptions(item, confirmedCode, confirmedRate);

  return { id, status: 'confirmed', accountCode: confirmedCode, taxRate: confirmedRate };
}

async function checkVatExceptions(item, accountCode, taxRate) {
  const flags = [];
  const amount = Math.abs(parseFloat(item.amount) || 0);
  const payee = (item.payee || '').toLowerCase();
  const currency = (item.currency || 'GBP').toUpperCase();

  if (currency !== 'GBP' && taxRate && !['RRINPUT', 'NONE', 'ZERORATEDINPUT'].includes(taxRate)) {
    flags.push('Non-GBP transaction with domestic VAT rate; should likely be reverse charge (RRINPUT) or NONE');
  }

  if (taxRate === 'RRINPUT' && currency === 'GBP') {
    flags.push('Reverse charge applied to a GBP transaction; reverse charge is for overseas suppliers');
  }

  if (amount > 250 && taxRate === 'INPUT2' && !accountCode) {
    flags.push('High-value purchase with standard VAT but no account code; verify invoice and recoverability');
  }

  const reverseChargePayees = ['meta', 'facebook', 'google', 'dataforseo', 'dropbox', 'slack', 'adobe', 'zoom', 'github', 'anthropic', 'openai', 'amazon web', 'aws', 'notion', 'canva', 'figma', 'vercel', 'linkedin', 'hetzner', 'brevo'];
  if (reverseChargePayees.some(p => payee.includes(p)) && taxRate && taxRate !== 'RRINPUT' && taxRate !== 'NONE') {
    flags.push(`${item.payee} is typically reverse charge (RRINPUT); currently set to ${taxRate}`);
  }

  if (amount > 1000 && taxRate === 'NONE' && !['2201', '2202', '2210', '7020'].includes(accountCode)) {
    flags.push('High-value transaction with no VAT; confirm this is correct (e.g. wages, inter-account transfer)');
  }

  const currentQuarter = getCurrentVatPeriod();
  for (const reason of flags) {
    await db.query(
      `INSERT INTO acct_vat_exceptions (period, line_ref, amount, currency, payee, flag_reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [currentQuarter, item.line_ref, item.amount, item.currency, item.payee, reason]
    );
  }
}

function getCurrentVatPeriod() {
  const now = new Date();
  const m = now.getMonth();
  const y = now.getFullYear();
  const qEnd = m < 3 ? `${y}-03` : m < 6 ? `${y}-06` : m < 9 ? `${y}-09` : `${y}-12`;
  return `Q${Math.floor(m / 3) + 1} ${y} (to ${qEnd})`;
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
    const escaped = opts.search.toLowerCase().replace(/[%_\\]/g, '\\$&');
    conditions.push(`(lower(payee) LIKE $${idx} ESCAPE '\\' OR lower(description) LIKE $${idx} ESCAPE '\\')`);
    params.push(`%${escaped}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(opts.limit || 100);
  const limitIdx = idx++;
  params.push(opts.offset || 0);
  const offsetIdx = idx++;

  const { rows } = await db.query(
    `SELECT * FROM acct_reconcile_queue ${where}
     ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END,
              confidence ASC NULLS FIRST, line_date DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
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

async function batchApprove(ids, data = {}) {
  let confirmed = 0;
  const errors = [];
  for (const id of ids) {
    try {
      await confirmItem(id, data);
      confirmed++;
    } catch (e) {
      errors.push({ id, error: e.message });
    }
  }
  return { confirmed, errors };
}

async function batchSkip(ids) {
  let skipped = 0;
  for (const id of ids) {
    await db.query(
      `UPDATE acct_reconcile_queue SET status = 'skipped', updated_at = now()
       WHERE id = $1 AND status = 'pending'`,
      [id]
    );
    skipped++;
  }
  return { skipped };
}

async function getAuditTrail(opts = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (opts.lineRef) {
    conditions.push(`c.line_ref = $${idx}`);
    params.push(opts.lineRef);
    idx++;
  }
  if (opts.source) {
    conditions.push(`c.source = $${idx}`);
    params.push(opts.source);
    idx++;
  }
  if (opts.from) {
    conditions.push(`c.confirmed_at >= $${idx}`);
    params.push(opts.from);
    idx++;
  }
  if (opts.to) {
    conditions.push(`c.confirmed_at <= $${idx}`);
    params.push(opts.to);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(opts.limit || 100);
  const limitIdx = idx++;
  params.push(opts.offset || 0);
  const offsetIdx = idx++;

  const { rows } = await db.query(
    `SELECT c.*, q.payee, q.description, q.amount, q.currency, q.line_date
     FROM acct_confirmations c
     LEFT JOIN acct_reconcile_queue q ON q.id = c.queue_item_id
     ${where}
     ORDER BY c.confirmed_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  const { rows: countRows } = await db.query(
    `SELECT count(*)::int as total FROM acct_confirmations c ${where}`,
    params.slice(0, -2)
  );

  return { confirmations: rows, total: countRows[0]?.total || 0 };
}

module.exports = {
  pullAndClassify,
  confirmItem,
  autoConfirmHighConfidence,
  writeBackToXero,
  getQueueStats,
  getQueueItems,
  skipItem,
  batchApprove,
  batchSkip,
  getAuditTrail,
};
