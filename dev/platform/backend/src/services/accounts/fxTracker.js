// FX gain/loss tracker.
// Monitors foreign-currency invoices and bank transactions, calculating
// realised gains/losses when a non-GBP transaction settles at a different
// rate from the one it was raised at.

const db = require('../../db');

async function recordFxEvent({
  xeroTxnId,
  invoiceRef,
  currency,
  raiseRate,
  settleRate,
  amount,
  accountCode,
  notes,
}) {
  if (!currency || currency === 'GBP') return null;

  const realisedGbp = raiseRate && settleRate && amount
    ? Number(((1 / settleRate - 1 / raiseRate) * Math.abs(amount)).toFixed(2))
    : null;

  const { rows } = await db.query(
    `INSERT INTO acct_fx_events
       (xero_txn_id, invoice_ref, currency, raise_rate, settle_rate,
        realised_gbp, account_code, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      xeroTxnId || null,
      invoiceRef || null,
      currency,
      raiseRate || null,
      settleRate || null,
      realisedGbp,
      accountCode || null,
      notes || null,
    ]
  );
  return rows[0];
}

async function getFxEvents(opts = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (opts.currency) {
    conditions.push(`currency = $${idx}`);
    params.push(opts.currency);
    idx++;
  }
  if (opts.from) {
    conditions.push(`created_at >= $${idx}`);
    params.push(opts.from);
    idx++;
  }
  if (opts.to) {
    conditions.push(`created_at <= $${idx}`);
    params.push(opts.to);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(opts.limit || 100);
  const limitIdx = idx++;
  params.push(opts.offset || 0);
  const offsetIdx = idx++;

  const { rows } = await db.query(
    `SELECT * FROM acct_fx_events ${where}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );
  return rows;
}

async function getFxSummary(opts = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (opts.from) {
    conditions.push(`created_at >= $${idx}`);
    params.push(opts.from);
    idx++;
  }
  if (opts.to) {
    conditions.push(`created_at <= $${idx}`);
    params.push(opts.to);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT
       currency,
       count(*)::int as event_count,
       coalesce(sum(realised_gbp), 0)::numeric as total_realised_gbp,
       coalesce(sum(CASE WHEN realised_gbp > 0 THEN realised_gbp ELSE 0 END), 0)::numeric as gains_gbp,
       coalesce(sum(CASE WHEN realised_gbp < 0 THEN realised_gbp ELSE 0 END), 0)::numeric as losses_gbp
     FROM acct_fx_events ${where}
     GROUP BY currency
     ORDER BY currency`,
    params
  );

  const totals = rows.reduce((acc, r) => {
    acc.eventCount += r.event_count;
    acc.totalRealisedGbp += Number(r.total_realised_gbp);
    acc.gainsGbp += Number(r.gains_gbp);
    acc.lossesGbp += Number(r.losses_gbp);
    return acc;
  }, { eventCount: 0, totalRealisedGbp: 0, gainsGbp: 0, lossesGbp: 0 });

  return { byCurrency: rows, totals };
}

async function scanQueueForFx() {
  const { rows } = await db.query(
    `SELECT q.*, c.confirmed_code, c.confirmed_rate
     FROM acct_reconcile_queue q
     LEFT JOIN acct_confirmations c ON c.queue_item_id = q.id
     WHERE q.currency IS NOT NULL
       AND q.currency != 'GBP'
       AND q.status IN ('confirmed', 'written')
       AND NOT EXISTS (
         SELECT 1 FROM acct_fx_events fx WHERE fx.xero_txn_id = q.line_ref
       )`
  );

  let recorded = 0;
  for (const row of rows) {
    await recordFxEvent({
      xeroTxnId: row.line_ref,
      currency: row.currency,
      amount: row.amount,
      accountCode: row.confirmed_code || row.suggested_code,
      notes: `Auto-detected from reconcile queue: ${row.payee || row.description || 'unknown payee'}`,
    });
    recorded++;
  }
  return { scanned: rows.length, recorded };
}

module.exports = {
  recordFxEvent,
  getFxEvents,
  getFxSummary,
  scanQueueForFx,
};
