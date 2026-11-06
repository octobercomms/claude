// Weekly digest builder for the Accounts module.
// Produces a summary of reconciliation activity, missing invoices,
// and upcoming deadlines. Stored in acct_digests and optionally emailed.

const db = require('../../db');
const deadlines = require('./deadlines');
const reconcile = require('./reconcile');
const invoices = require('./invoices');

async function buildWeeklyDigest() {
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const periodStart = weekAgo.toISOString().split('T')[0];
  const periodEnd = now.toISOString().split('T')[0];

  const queueStats = await reconcile.getQueueStats();
  const invoiceStats = await invoices.getInvoiceStats();
  const upcomingDeadlines = await deadlines.getUpcoming(30);
  const missingInvoices = await invoices.getMissingInvoices();

  // Items reconciled this week.
  const { rows: recentConfirmed } = await db.query(
    `SELECT count(*)::int as count FROM acct_confirmations
     WHERE confirmed_at >= $1`,
    [weekAgo.toISOString()]
  );

  const summary = {
    period: { start: periodStart, end: periodEnd },
    reconciliation: {
      pending: queueStats.pending,
      confirmedThisWeek: recentConfirmed[0]?.count || 0,
      totalWritten: queueStats.written,
      totalInQueue: queueStats.total,
    },
    invoices: {
      missing: invoiceStats.missing,
      matched: invoiceStats.matched,
      attached: invoiceStats.attached,
      missingList: missingInvoices.slice(0, 20).map(m => ({
        payee: m.xero_contact,
        date: m.invoice_date,
        amount: m.amount,
        currency: m.currency,
      })),
    },
    deadlines: upcomingDeadlines.map(d => ({
      type: d.tax_type,
      label: d.period_label,
      dueDate: d.due_date,
      status: d.status,
      daysUntil: Math.ceil((new Date(d.due_date) - now) / (1000 * 60 * 60 * 24)),
    })),
  };

  // Store the digest.
  const { rows } = await db.query(
    `INSERT INTO acct_digests
       (period_start, period_end, summary, items_reconciled, items_pending, invoices_missing)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      periodStart,
      periodEnd,
      JSON.stringify(summary),
      summary.reconciliation.confirmedThisWeek,
      summary.reconciliation.pending,
      summary.invoices.missing,
    ]
  );

  return { digest: rows[0], summary };
}

// Mark a digest as sent (after email delivery).
async function markSent(digestId) {
  await db.query(
    'UPDATE acct_digests SET sent_at = now() WHERE id = $1',
    [digestId]
  );
}

async function getDigests(limit = 12) {
  const { rows } = await db.query(
    'SELECT * FROM acct_digests ORDER BY period_end DESC LIMIT $1',
    [limit]
  );
  return rows;
}

module.exports = { buildWeeklyDigest, markSent, getDigests };
