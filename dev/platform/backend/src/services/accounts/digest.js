// Weekly digest builder for the Accounts module.
// Produces a summary of reconciliation activity, missing invoices,
// and upcoming deadlines. Stored in acct_digests and optionally emailed.

const db = require('../../db');
const deadlines = require('./deadlines');
const reconcile = require('./reconcile');
const invoices = require('./invoices');
const suppliers = require('./suppliers');
const { sendAccountsDigest } = require('../emailService');

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
  const supplierStats = await suppliers.getStats();
  const autoCodedThisWeek = await suppliers.getAutoCodedSummary(weekAgo);

  // Items reconciled this week.
  const { rows: recentConfirmed } = await db.query(
    `SELECT count(*)::int as count FROM acct_confirmations
     WHERE confirmed_at >= $1`,
    [weekAgo.toISOString()]
  );

  // Overdue deadlines: past due date and not filed.
  const overdueDeadlines = upcomingDeadlines.filter(d =>
    d.effective_status === 'overdue'
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
    suppliers: {
      total: supplierStats.total,
      autoCoding: supplierStats.auto_coding,
      learning: supplierStats.learning,
      autoCodedThisWeek,
    },
    deadlines: upcomingDeadlines.map(d => ({
      type: d.tax_type,
      label: d.period_label,
      dueDate: typeof d.due_date === 'string' ? d.due_date : d.due_date?.toISOString?.()?.split('T')[0],
      status: d.effective_status || d.status,
      daysUntil: d.days_until != null ? d.days_until : Math.ceil((new Date(d.due_date) - now) / (1000 * 60 * 60 * 24)),
    })),
    overdueDeadlines: overdueDeadlines.length,
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

  try {
    await sendAccountsDigest({ summary });
    await db.query('UPDATE acct_digests SET sent_at = now() WHERE id = $1', [rows[0].id]);
    rows[0].sent_at = new Date().toISOString();
  } catch (emailErr) {
    console.warn('[Accounts] digest email failed:', emailErr.message);
  }

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

function formatDigestHtml(summary) {
  const s = summary;
  const deadlineRows = (s.deadlines || []).map(d => {
    const urgency = d.daysUntil <= 7 ? '#d32f2f' : d.daysUntil <= 14 ? '#f57c00' : '#388e3c';
    return `<tr>
      <td style="padding:6px 12px;border:1px solid #e0e0e0;">${d.type}</td>
      <td style="padding:6px 12px;border:1px solid #e0e0e0;">${d.label}</td>
      <td style="padding:6px 12px;border:1px solid #e0e0e0;">${d.dueDate}</td>
      <td style="padding:6px 12px;border:1px solid #e0e0e0;color:${urgency};font-weight:600;">${d.daysUntil}d</td>
    </tr>`;
  }).join('');

  const missingRows = (s.invoices?.missingList || []).slice(0, 10).map(m =>
    `<tr>
      <td style="padding:6px 12px;border:1px solid #e0e0e0;">${m.payee}</td>
      <td style="padding:6px 12px;border:1px solid #e0e0e0;">${m.date || ''}</td>
      <td style="padding:6px 12px;border:1px solid #e0e0e0;">${m.currency || 'GBP'} ${m.amount}</td>
    </tr>`
  ).join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;">
      <h2 style="color:#1a1a1a;margin-bottom:4px;">Accounts Weekly Digest</h2>
      <p style="color:#666;margin-top:0;">${s.period.start} to ${s.period.end}</p>

      <h3 style="color:#1a1a1a;">Reconciliation</h3>
      <table style="border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:4px 16px 4px 0;color:#666;">Confirmed this week</td><td style="font-weight:600;">${s.reconciliation.confirmedThisWeek}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#666;">Pending review</td><td style="font-weight:600;">${s.reconciliation.pending}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#666;">Written to Xero</td><td style="font-weight:600;">${s.reconciliation.totalWritten}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#666;">Total in queue</td><td style="font-weight:600;">${s.reconciliation.totalInQueue}</td></tr>
      </table>

      <h3 style="color:#1a1a1a;">Invoices</h3>
      <table style="border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:4px 16px 4px 0;color:#666;">Matched</td><td style="font-weight:600;">${s.invoices.matched}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#666;">Attached to Xero</td><td style="font-weight:600;">${s.invoices.attached}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#666;">Missing</td><td style="font-weight:600;color:${s.invoices.missing > 0 ? '#d32f2f' : '#388e3c'};">${s.invoices.missing}</td></tr>
      </table>

      ${missingRows ? `
        <h4 style="color:#1a1a1a;">Top missing invoices</h4>
        <table style="border-collapse:collapse;width:100%;margin:12px 0;">
          <thead><tr style="background:#f5f5f5;">
            <th style="padding:6px 12px;border:1px solid #e0e0e0;text-align:left;">Payee</th>
            <th style="padding:6px 12px;border:1px solid #e0e0e0;text-align:left;">Date</th>
            <th style="padding:6px 12px;border:1px solid #e0e0e0;text-align:left;">Amount</th>
          </tr></thead>
          <tbody>${missingRows}</tbody>
        </table>
      ` : ''}

      ${s.suppliers ? `
        <h3 style="color:#1a1a1a;">Supplier Brain</h3>
        <table style="border-collapse:collapse;margin:12px 0;">
          <tr><td style="padding:4px 16px 4px 0;color:#666;">Total suppliers</td><td style="font-weight:600;">${s.suppliers.total}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#666;">Auto-coding</td><td style="font-weight:600;">${s.suppliers.autoCoding}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#666;">Still learning</td><td style="font-weight:600;">${s.suppliers.learning}</td></tr>
        </table>
        ${(s.suppliers.autoCodedThisWeek || []).length ? `
          <h4 style="color:#1a1a1a;">Auto-coded this week</h4>
          <table style="border-collapse:collapse;width:100%;margin:12px 0;">
            <thead><tr style="background:#f5f5f5;">
              <th style="padding:6px 12px;border:1px solid #e0e0e0;text-align:left;">Supplier</th>
              <th style="padding:6px 12px;border:1px solid #e0e0e0;text-align:left;">Transactions</th>
            </tr></thead>
            <tbody>${(s.suppliers.autoCodedThisWeek || []).map(a =>
              `<tr><td style="padding:6px 12px;border:1px solid #e0e0e0;">${a.display_name}</td>
               <td style="padding:6px 12px;border:1px solid #e0e0e0;">${a.count}</td></tr>`
            ).join('')}</tbody>
          </table>
        ` : ''}
      ` : ''}

      ${s.overdueDeadlines ? `
        <div style="background:#fff3e0;border-left:4px solid #f57c00;padding:12px 16px;margin:16px 0;">
          <strong style="color:#e65100;">${s.overdueDeadlines} overdue deadline${s.overdueDeadlines > 1 ? 's' : ''}</strong>
          <span style="color:#666;"> require attention.</span>
        </div>
      ` : ''}

      ${deadlineRows ? `
        <h3 style="color:#1a1a1a;">Upcoming Deadlines</h3>
        <table style="border-collapse:collapse;width:100%;margin:12px 0;">
          <thead><tr style="background:#f5f5f5;">
            <th style="padding:6px 12px;border:1px solid #e0e0e0;text-align:left;">Type</th>
            <th style="padding:6px 12px;border:1px solid #e0e0e0;text-align:left;">Period</th>
            <th style="padding:6px 12px;border:1px solid #e0e0e0;text-align:left;">Due</th>
            <th style="padding:6px 12px;border:1px solid #e0e0e0;text-align:left;">Days</th>
          </tr></thead>
          <tbody>${deadlineRows}</tbody>
        </table>
      ` : ''}

      <p style="color:#999;font-size:12px;margin-top:24px;">October Marketing Intelligence &mdash; Accounts Module</p>
    </div>
  `;
}

async function sendDigestEmail(digestId) {
  const { rows } = await db.query('SELECT * FROM acct_digests WHERE id = $1', [digestId]);
  if (!rows.length) throw new Error('Digest not found');

  const digest = rows[0];
  if (digest.sent_at) return { alreadySent: true };

  const summary = typeof digest.summary === 'string' ? JSON.parse(digest.summary) : digest.summary;
  const html = formatDigestHtml(summary);

  const to = process.env.ACCOUNTS_DIGEST_EMAIL || process.env.ALERT_EMAIL;
  if (!to) throw new Error('No recipient configured (set ACCOUNTS_DIGEST_EMAIL or ALERT_EMAIL)');

  let getTransporter;
  try {
    const emailService = require('./../../services/emailService');
    getTransporter = () => {
      const { buildTransporter } = require('../../routes/settings');
      return { sendMail: (msg) => buildTransporter().sendMail(msg) };
    };
  } catch {
    throw new Error('Email service not available');
  }

  const sender = process.env.EMAIL_PROVIDER === 'ses'
    ? (process.env.SES_FROM_EMAIL || process.env.GMAIL_USER)
    : `"October Communications" <${process.env.GMAIL_USER}>`;

  await getTransporter().sendMail({
    from: sender,
    to,
    subject: `Accounts Digest: ${summary.period.start} to ${summary.period.end}`,
    html,
  });

  await markSent(digestId);
  return { sent: true, to };
}

// Build and send in one call (used by the scheduler).
async function buildAndSend() {
  const { digest, summary } = await buildWeeklyDigest();
  try {
    await sendDigestEmail(digest.id);
    return { digest, summary, emailed: true };
  } catch (err) {
    console.warn('[accounts] Digest built but email failed:', err.message);
    return { digest, summary, emailed: false, emailError: err.message };
  }
}

module.exports = { buildWeeklyDigest, markSent, getDigests, sendDigestEmail, buildAndSend, formatDigestHtml };
