const db = require('../../db');
const xeroApi = require('./xeroApi');
const classifier = require('./classifier');

async function syncUnreconciled() {
  const conn = await db.query('SELECT * FROM acct_xero_connection LIMIT 1');
  if (!conn.rows.length) throw new Error('Xero not connected');

  const since = conn.rows[0].last_sync_at
    ? new Date(conn.rows[0].last_sync_at)
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const transactions = await xeroApi.fetchAllUnreconciled(since);
  const accounts = await xeroApi.fetchAccounts();
  const taxRates = await xeroApi.fetchTaxRates();

  let added = 0;
  let skipped = 0;

  for (const txn of transactions) {
    const txnId = txn.BankTransactionID;
    const existing = await db.query(
      'SELECT id FROM acct_reconcile_queue WHERE xero_txn_id = $1',
      [txnId]
    );
    if (existing.rows.length) { skipped++; continue; }

    const payee = txn.Contact?.Name || '';
    const amount = Number(txn.Total) || 0;
    const currency = txn.CurrencyCode || 'GBP';
    const lineDate = txn.Date ? txn.Date.substring(0, 10) : null;
    const reference = txn.Reference || '';
    const bankAccount = txn.BankAccount?.Name || '';
    const bankAccountId = txn.BankAccount?.AccountID || '';

    const suggestion = await classifier.classify(txn, accounts, taxRates);

    await db.query(`
      INSERT INTO acct_reconcile_queue
        (xero_txn_id, line_ref, bank_account, bank_account_id, line_date,
         amount, currency, payee, reference, description,
         suggested_code, suggested_name, suggested_rate, confidence,
         match_source, ai_reasoning, xero_line_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `, [
      txnId,
      txnId,
      bankAccount,
      bankAccountId,
      lineDate,
      amount,
      currency,
      payee,
      reference,
      txn.LineItems?.map(l => l.Description).filter(Boolean).join('; ') || '',
      suggestion.accountCode,
      suggestion.accountName,
      suggestion.taxRate,
      suggestion.confidence,
      suggestion.matchSource,
      suggestion.aiReasoning,
      JSON.stringify(txn),
    ]);
    added++;
  }

  await db.query(
    'UPDATE acct_xero_connection SET last_sync_at = now() WHERE tenant_id = $1',
    [conn.rows[0].tenant_id]
  );

  return { added, skipped, total: transactions.length };
}

async function approveItem(id, overrides = {}) {
  const { rows } = await db.query('SELECT * FROM acct_reconcile_queue WHERE id = $1', [id]);
  if (!rows.length) throw new Error('Queue item not found');
  const item = rows[0];

  const confirmedCode = overrides.accountCode || item.suggested_code;
  const confirmedName = overrides.accountName || item.suggested_name;
  const confirmedRate = overrides.taxRate || item.suggested_rate;

  await db.query(`
    INSERT INTO acct_confirmations
      (queue_item_id, line_ref, bank_account, proposed_code, proposed_rate,
       confirmed_code, confirmed_rate, confirmed_name, reasoning, source, confirmed_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'daniel')
  `, [
    item.id,
    item.line_ref,
    item.bank_account,
    item.suggested_code,
    item.suggested_rate,
    confirmedCode,
    confirmedRate,
    confirmedName,
    overrides.reasoning || item.ai_reasoning,
    item.match_source || 'manual',
  ]);

  await db.query(`
    UPDATE acct_reconcile_queue
    SET status = 'confirmed', reviewed_at = now(), updated_at = now(),
        suggested_code = COALESCE($2, suggested_code),
        suggested_name = COALESCE($3, suggested_name),
        suggested_rate = COALESCE($4, suggested_rate)
    WHERE id = $1
  `, [id, confirmedCode, confirmedName, confirmedRate]);

  await classifier.promoteToRule({
    payee: item.payee,
    confirmed_code: confirmedCode,
    confirmed_name: confirmedName,
    confirmed_rate: confirmedRate,
    currency: item.currency,
  });

  return { id, status: 'confirmed' };
}

async function rejectItem(id, reason) {
  await db.query(`
    UPDATE acct_reconcile_queue
    SET status = 'skipped', reviewed_at = now(), updated_at = now()
    WHERE id = $1
  `, [id]);

  if (reason) {
    await db.query(`
      INSERT INTO acct_confirmations
        (queue_item_id, line_ref, proposed_code, confirmed_code, reasoning, source, confirmed_by)
      SELECT $1, line_ref, suggested_code, 'SKIPPED', $2, 'manual', 'daniel'
      FROM acct_reconcile_queue WHERE id = $1
    `, [id, reason]);
  }

  return { id, status: 'skipped' };
}

async function getDashboardStats() {
  const { rows } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
      COUNT(*) FILTER (WHERE status = 'written') AS written,
      COUNT(*) FILTER (WHERE status = 'skipped') AS skipped,
      COUNT(*) FILTER (WHERE status = 'error') AS errored,
      COUNT(*) FILTER (WHERE invoice_status = 'missing_amber') AS invoices_amber,
      COUNT(*) FILTER (WHERE invoice_status = 'missing_red') AS invoices_red,
      COUNT(*) FILTER (WHERE invoice_status = 'matched') AS invoices_matched,
      COUNT(*) AS total
    FROM acct_reconcile_queue
  `);

  const deadlines = await db.query(`
    SELECT * FROM acct_tax_deadlines
    WHERE due_date >= CURRENT_DATE AND status NOT IN ('filed', 'paid')
    ORDER BY due_date LIMIT 3
  `);

  const conn = await db.query('SELECT tenant_name, last_sync_at FROM acct_xero_connection LIMIT 1');

  return {
    queue: rows[0],
    nextDeadlines: deadlines.rows,
    xero: conn.rows[0] || null,
  };
}

module.exports = { syncUnreconciled, approveItem, rejectItem, getDashboardStats };
