// Tax deadline awareness for UK limited company.
// Populates the acct_tax_deadlines table with known UK deadlines
// and tracks their status.

const db = require('../../db');

// UK tax calendar for a standard accounting year ending 31 March.
// These are the deadlines Daniel needs to hit; the accountant (Beany)
// handles the actual filing.
function generateDeadlines(yearEnd) {
  const ye = yearEnd || getDefaultYearEnd();
  const year = ye.getFullYear();
  const deadlines = [];

  // VAT quarters (standard stagger group: quarters ending Mar/Jun/Sep/Dec,
  // filed + paid one month and seven days after quarter end).
  const vatQuarters = [
    { end: new Date(year, 2, 31), label: `VAT Q1 ${year}` },
    { end: new Date(year, 5, 30), label: `VAT Q2 ${year}` },
    { end: new Date(year, 8, 30), label: `VAT Q3 ${year}` },
    { end: new Date(year, 11, 31), label: `VAT Q4 ${year}` },
  ];
  for (const q of vatQuarters) {
    const due = new Date(q.end);
    due.setDate(due.getDate() + 37);
    deadlines.push({
      taxType: 'VAT',
      periodLabel: q.label,
      dueDate: due.toISOString().split('T')[0],
    });
  }

  // Corporation Tax: due 9 months + 1 day after year-end.
  const ctDue = new Date(ye);
  ctDue.setMonth(ctDue.getMonth() + 9);
  ctDue.setDate(ctDue.getDate() + 1);
  deadlines.push({
    taxType: 'CT600',
    periodLabel: `CT600 year ending ${ye.toISOString().split('T')[0]}`,
    dueDate: ctDue.toISOString().split('T')[0],
  });

  // PAYE: monthly, due 22nd of following month (or 19th if posting cheque).
  for (let m = 0; m < 12; m++) {
    const monthStart = new Date(year, m, 1);
    const due = new Date(year, m + 1, 22);
    deadlines.push({
      taxType: 'PAYE',
      periodLabel: `PAYE ${monthStart.toLocaleString('en-GB', { month: 'short', year: 'numeric' })}`,
      dueDate: due.toISOString().split('T')[0],
    });
  }

  return deadlines;
}

function getDefaultYearEnd() {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(year, 2, 31);
}

async function seedDeadlines(yearEnd) {
  const deadlines = generateDeadlines(yearEnd);
  let inserted = 0;
  for (const d of deadlines) {
    const { rowCount } = await db.query(
      `INSERT INTO acct_tax_deadlines (tax_type, period_label, due_date)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [d.taxType, d.periodLabel, d.dueDate]
    );
    if (rowCount) inserted++;
  }
  return inserted;
}

async function getUpcoming(days = 90) {
  const { rows } = await db.query(
    `SELECT * FROM acct_tax_deadlines
     WHERE due_date <= now() + ($1 || ' days')::interval
       AND status NOT IN ('filed', 'paid')
     ORDER BY due_date`,
    [String(days)]
  );
  return rows;
}

async function getAll() {
  const { rows } = await db.query(
    'SELECT * FROM acct_tax_deadlines ORDER BY due_date DESC'
  );
  return rows;
}

async function updateDeadline(id, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, col] of [
    ['status', 'status'],
    ['filingDate', 'filing_date'],
    ['paymentDate', 'payment_date'],
    ['notes', 'notes'],
  ]) {
    if (data[key] !== undefined) {
      fields.push(`${col} = $${idx}`);
      values.push(data[key]);
      idx++;
    }
  }
  if (!fields.length) return null;
  fields.push('updated_at = now()');
  values.push(id);

  const { rows } = await db.query(
    `UPDATE acct_tax_deadlines SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function sendAlerts(daysAhead = 14) {
  const upcoming = await getUpcoming(daysAhead);
  if (!upcoming.length) return { sent: false, reason: 'nothing due' };

  const to = process.env.ACCOUNTS_DIGEST_EMAIL || process.env.ALERT_EMAIL;
  if (!to) return { sent: false, reason: 'no recipient configured' };

  const lines = upcoming.map((d) => {
    const days = Math.ceil((new Date(d.due_date) - new Date()) / 86400000);
    const urgency = days <= 3 ? '!!' : days <= 7 ? '!' : '';
    return `<tr><td>${urgency} ${d.tax_type}</td><td>${d.period_label}</td>`
      + `<td>${d.due_date.toISOString().split('T')[0]}</td><td>${days} days</td>`
      + `<td>${d.status}</td></tr>`;
  });

  const html = `<h2>Tax deadline alert</h2>
<p>${upcoming.length} deadline${upcoming.length > 1 ? 's' : ''} due within ${daysAhead} days:</p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
<tr><th>Type</th><th>Period</th><th>Due</th><th>Remaining</th><th>Status</th></tr>
${lines.join('\n')}
</table>
<p style="color:#666;font-size:12px">Sent by OMI Accounts. Update status at /accounts/deadlines.</p>`;

  const { buildTransporter } = require('../../routes/settings');
  const sender = process.env.EMAIL_PROVIDER === 'ses'
    ? (process.env.SES_FROM_EMAIL || process.env.GMAIL_USER)
    : `"October Communications" <${process.env.GMAIL_USER}>`;

  await buildTransporter().sendMail({ from: sender, to, subject: `Tax deadlines: ${upcoming.length} due within ${daysAhead} days`, html });
  return { sent: true, to, count: upcoming.length };
}

module.exports = {
  generateDeadlines,
  seedDeadlines,
  getUpcoming,
  getAll,
  updateDeadline,
  sendAlerts,
};
