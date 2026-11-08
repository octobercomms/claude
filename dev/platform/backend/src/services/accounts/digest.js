// Weekly digest builder for the Accounts module.
// Produces a summary of reconciliation activity, missing invoices,
// and upcoming deadlines. Stored in acct_digests and optionally emailed.

const db = require('../../db');
const deadlines = require('./deadlines');
const reconcile = require('./reconcile');
const invoices = require('./invoices');
const suppliers = require('./suppliers');
const precode = require('./precode');
const { sendAccountsDigest } = require('../emailService');

async function previewDigest() {
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

  let precodedThisWeek = [];
  try {
    precodedThisWeek = await precode.getRecentPrecodes(weekAgo.toISOString());
  } catch { /* table may not exist yet */ }

  const { rows: recentConfirmed } = await db.query(
    `SELECT count(*)::int as count FROM acct_confirmations
     WHERE confirmed_at >= $1`,
    [weekAgo.toISOString()]
  );

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
    precoded: {
      count: precodedThisWeek.length,
      written: precodedThisWeek.filter(p => p.status === 'written').length,
      errors: precodedThisWeek.filter(p => p.status === 'error').length,
      totalAmount: precodedThisWeek
        .filter(p => p.status === 'written')
        .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0),
      items: precodedThisWeek.filter(p => p.status === 'written').slice(0, 20).map(p => ({
        supplier: p.supplier_name,
        accountCode: p.account_code,
        vatTreatment: p.vat_treatment,
        amount: p.amount,
        currency: p.currency,
        date: p.created_at,
        invoiceAttached: !!p.invoice_filename,
      })),
    },
  };

  return { summary, periodStart, periodEnd };
}

async function buildWeeklyDigest() {
  const { summary, periodStart, periodEnd } = await previewDigest();

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

  // Deadlines: split into needing attention vs confirmed paid.
  const deadlines = s.deadlines || [];
  const needsAttention = deadlines.filter(d =>
    d.status !== 'filed' && d.status !== 'paid' && d.daysUntil <= 30
  );
  const paidOrFiled = deadlines.filter(d =>
    d.status === 'filed' || d.status === 'paid'
  );
  const upcoming = deadlines.filter(d =>
    d.status !== 'filed' && d.status !== 'paid' && d.daysUntil > 30
  );

  function deadlineChip(d) {
    if (d.status === 'filed' || d.status === 'paid') {
      return `<span style="background:#f0fdf4;color:#16a34a;font-size:12px;font-weight:600;padding:3px 10px;border-radius:12px;white-space:nowrap;">Paid</span>`;
    }
    if (d.status === 'overdue') {
      return `<span style="background:#fef2f2;color:#dc2626;font-size:12px;font-weight:600;padding:3px 10px;border-radius:12px;white-space:nowrap;">Overdue</span>`;
    }
    if (d.daysUntil <= 14) {
      return `<span style="background:#fffbeb;color:#d97706;font-size:12px;font-weight:600;padding:3px 10px;border-radius:12px;white-space:nowrap;">Due ${d.dueDate}</span>`;
    }
    return `<span style="background:#f3f4f6;color:#6b7280;font-size:12px;font-weight:600;padding:3px 10px;border-radius:12px;white-space:nowrap;">${d.dueDate}</span>`;
  }

  function deadlineRow(d) {
    return `<tr>
      <td style="padding:10px 8px 10px 0;border-bottom:1px solid #e5e7eb;">
        <div style="font-weight:600;font-size:14px;">${d.type}</div>
        <div style="font-size:13px;color:#6b7280;">${d.label}</div>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;">${deadlineChip(d)}</td>
    </tr>`;
  }

  // Alert banner for deadlines needing attention.
  let alertBanner = '';
  if (needsAttention.length > 0) {
    const overdue = needsAttention.filter(d => d.status === 'overdue');
    const dueSoon = needsAttention.filter(d => d.status !== 'overdue');
    const parts = [];
    if (overdue.length) parts.push(`${overdue.length} overdue`);
    if (dueSoon.length) parts.push(`${dueSoon.length} due within 30 days`);
    alertBanner = `
      <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;margin-bottom:20px;border-radius:0 4px 4px 0;">
        <strong style="color:#dc2626;">${needsAttention.length} deadline${needsAttention.length > 1 ? 's need' : ' needs'} attention</strong>
        <p style="margin:4px 0 0;font-size:14px;color:#6b7280;">${parts.join(', ')}. No matching payment found.</p>
      </div>`;
  } else if (deadlines.length > 0) {
    alertBanner = `
      <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;margin-bottom:20px;border-radius:0 4px 4px 0;">
        <strong style="color:#16a34a;">All deadlines on track</strong>
      </div>`;
  }

  const missingRows = (s.invoices?.missingList || []).slice(0, 10).map(m =>
    `<tr>
      <td style="padding:8px 8px 8px 0;border-bottom:1px solid #e5e7eb;">${m.payee}</td>
      <td style="padding:8px 8px 8px 0;border-bottom:1px solid #e5e7eb;">${m.date || ''}</td>
      <td style="padding:8px 0 8px 0;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">${m.currency || 'GBP'} ${Number(m.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
    </tr>`
  ).join('');

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px 0 40px;line-height:1.5;color:#1a1a1a;">
      <div style="text-align:center;padding:20px 0 16px;border-bottom:2px solid #1a1a1a;margin-bottom:24px;">
        <h1 style="font-size:20px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin:0 0 2px;">Accounts Weekly</h1>
        <div style="font-size:13px;color:#6b7280;">${s.period.start} to ${s.period.end}</div>
      </div>

      ${alertBanner}

      ${deadlines.length > 0 ? `
        <h2 style="font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:28px 0 12px;padding-bottom:6px;border-bottom:1px solid #e5e7eb;">Deadlines</h2>
        <table style="width:100%;border-collapse:collapse;">
          ${[...needsAttention, ...upcoming, ...paidOrFiled].map(deadlineRow).join('')}
        </table>
      ` : ''}

      <h2 style="font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:28px 0 12px;padding-bottom:6px;border-bottom:1px solid #e5e7eb;">Reconciliation</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:50%;padding:14px 16px;background:#f9fafb;border-radius:6px;">
            <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;">Confirmed this week</div>
            <div style="font-size:22px;font-weight:700;color:#16a34a;">${s.reconciliation.confirmedThisWeek}</div>
          </td>
          <td style="width:8px;"></td>
          <td style="width:50%;padding:14px 16px;background:#f9fafb;border-radius:6px;">
            <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;">Pending review</div>
            <div style="font-size:22px;font-weight:700;${s.reconciliation.pending > 0 ? 'color:#d97706;' : ''}">${s.reconciliation.pending}</div>
          </td>
        </tr>
      </table>

      <h2 style="font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:28px 0 12px;padding-bottom:6px;border-bottom:1px solid #e5e7eb;">Invoices</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:50%;padding:14px 16px;background:#f9fafb;border-radius:6px;">
            <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;">Matched</div>
            <div style="font-size:22px;font-weight:700;color:#16a34a;">${s.invoices.matched}</div>
          </td>
          <td style="width:8px;"></td>
          <td style="width:50%;padding:14px 16px;background:#f9fafb;border-radius:6px;">
            <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;">Missing</div>
            <div style="font-size:22px;font-weight:700;${s.invoices.missing > 0 ? 'color:#dc2626;' : ''}">${s.invoices.missing}</div>
          </td>
        </tr>
      </table>

      ${missingRows ? `
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0;">
          <thead>
            <tr>
              <th style="text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;padding:8px 8px 8px 0;border-bottom:2px solid #e5e7eb;">Supplier</th>
              <th style="text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;padding:8px 8px 8px 0;border-bottom:2px solid #e5e7eb;">Date</th>
              <th style="text-align:right;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;padding:8px 0 8px 0;border-bottom:2px solid #e5e7eb;">Amount</th>
            </tr>
          </thead>
          <tbody>${missingRows}</tbody>
        </table>
      ` : ''}

      ${s.precoded && s.precoded.count > 0 ? `
        <h2 style="font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:28px 0 12px;padding-bottom:6px;border-bottom:1px solid #e5e7eb;">Pre-coded Transactions</h2>
        <p style="font-size:14px;color:#6b7280;margin:0 0 12px;">OMI wrote ${s.precoded.written} transaction${s.precoded.written !== 1 ? 's' : ''} to Xero this week (${s.precoded.currency || 'GBP'} ${Number(s.precoded.totalAmount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}).${s.precoded.errors > 0 ? ` ${s.precoded.errors} failed.` : ''} Each will appear in your Xero bank reconciliation for one-click matching.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr>
              <th style="text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;padding:8px 8px 8px 0;border-bottom:2px solid #e5e7eb;">Supplier</th>
              <th style="text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;padding:8px 8px 8px 0;border-bottom:2px solid #e5e7eb;">Code</th>
              <th style="text-align:right;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;padding:8px 0;border-bottom:2px solid #e5e7eb;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${(s.precoded.items || []).map(p => `
              <tr>
                <td style="padding:8px 8px 8px 0;border-bottom:1px solid #e5e7eb;">${p.supplier}${p.invoiceAttached ? ' <span style="color:#16a34a;font-size:11px;">+ invoice</span>' : ''}</td>
                <td style="padding:8px 8px 8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">${p.accountCode} / ${p.vatTreatment}</td>
                <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-variant-numeric:tabular-nums;">${p.currency || 'GBP'} ${Number(p.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}

      ${s.suppliers ? `
        <h2 style="font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:28px 0 12px;padding-bottom:6px;border-bottom:1px solid #e5e7eb;">Supplier Brain</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="width:50%;padding:14px 16px;background:#f9fafb;border-radius:6px;">
              <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;">Total suppliers</div>
              <div style="font-size:22px;font-weight:700;">${s.suppliers.total}</div>
            </td>
            <td style="width:8px;"></td>
            <td style="width:50%;padding:14px 16px;background:#f9fafb;border-radius:6px;">
              <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;">Auto-coding</div>
              <div style="font-size:22px;font-weight:700;color:#16a34a;">${s.suppliers.autoCoding}</div>
            </td>
          </tr>
        </table>
        ${(s.suppliers.autoCodedThisWeek || []).length ? `
          <p style="font-size:13px;color:#6b7280;margin:12px 0 8px;">Auto-coded this week:</p>
          ${(s.suppliers.autoCodedThisWeek || []).map(a =>
            `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px;">
              <span>${a.display_name}</span>
              <span style="font-weight:600;color:#6b7280;font-variant-numeric:tabular-nums;">${a.count} txn${a.count !== 1 ? 's' : ''}</span>
            </div>`
          ).join('')}
        ` : ''}
      ` : ''}

      <div style="text-align:center;padding:24px 0 0;margin-top:28px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
        October Marketing Intelligence<br>
        Accounts Module
      </div>
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

module.exports = { previewDigest, buildWeeklyDigest, markSent, getDigests, sendDigestEmail, buildAndSend, formatDigestHtml };
