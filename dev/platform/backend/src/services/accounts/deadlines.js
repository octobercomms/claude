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

  // Workplace pension (NEST): monthly contributions due by 22nd of
  // the following month for electronic payment (same schedule as PAYE).
  for (let m = 0; m < 12; m++) {
    const monthStart = new Date(year, m, 1);
    const due = new Date(year, m + 1, 22);
    deadlines.push({
      taxType: 'PENSION',
      periodLabel: `Pension ${monthStart.toLocaleString('en-GB', { month: 'short', year: 'numeric' })}`,
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
  let updated = 0;
  for (const d of deadlines) {
    const { rows } = await db.query(
      `INSERT INTO acct_tax_deadlines (tax_type, period_label, due_date)
       VALUES ($1, $2, $3)
       ON CONFLICT (tax_type, period_label) DO UPDATE
         SET due_date = EXCLUDED.due_date, updated_at = now()
       RETURNING (xmax = 0) AS is_insert`,
      [d.taxType, d.periodLabel, d.dueDate]
    );
    if (rows[0]?.is_insert) inserted++;
    else updated++;
  }
  return { inserted, updated, total: deadlines.length };
}

async function seedForYear(calendarYear) {
  const ye = new Date(calendarYear, 2, 31);
  return seedDeadlines(ye);
}

// `now` is injectable so a guard can drive the calendar rather than wait for
// a date to pass. It only affects the labelling here, never the SQL.
function addEffectiveStatus(rows, now = new Date()) {
  return rows.map(r => {
    const due = new Date(r.due_date);
    const daysUntil = Math.ceil((due - now) / 86400000);
    let effectiveStatus = r.status;
    if (r.status === 'upcoming' && due < now) {
      effectiveStatus = 'overdue';
    }
    return { ...r, effective_status: effectiveStatus, days_until: daysUntil };
  });
}

// Everything still open with a due date no later than `days` from now.
//
// Note the deliberate absence of a lower bound: the dashboard and the weekly
// digest both want to see what is late as well as what is coming, and a
// deadline that slipped does not stop mattering. `addEffectiveStatus` marks
// those `overdue` and gives every row a negative `days_until`, which is how
// callers tell the two apart.
//
// `sendAlerts` is the one caller that must NOT treat them as the same thing;
// see `partitionByDue` below.
async function getUpcoming(days = 90, { now = new Date() } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM acct_tax_deadlines
     WHERE due_date <= now() + ($1 || ' days')::interval
       AND status NOT IN ('filed', 'paid')
     ORDER BY due_date`,
    [String(days)]
  );
  return addEffectiveStatus(rows, now);
}

// Split what getUpcoming returned into the two things a reader needs to tell
// apart: deadlines still ahead, and deadlines already missed.
//
// Without this the alert said "23 due within 14 days" over a list whose
// soonest item was 58 days past and whose oldest was 269, every one of them
// labelled "upcoming". Daniel, 18 November: "i keep getting these every day."
// An alert somebody has learned to ignore is worse than no alert, because the
// real VAT deadline arrives in the same email.
function partitionByDue(rows) {
  const overdue = [];
  const dueSoon = [];
  for (const r of rows) {
    (r.days_until < 0 ? overdue : dueSoon).push(r);
  }
  // Most overdue first: the oldest is the one most likely to be a record that
  // was never closed rather than a payment genuinely outstanding.
  overdue.sort((a, b) => a.days_until - b.days_until);
  dueSoon.sort((a, b) => a.days_until - b.days_until);
  return { overdue, dueSoon };
}

async function ensureSeeded() {
  const now = new Date();
  const thisYear = now.getFullYear();
  const nextYear = thisYear + 1;
  for (const y of [thisYear, nextYear]) {
    const label = `VAT Q1 ${y}`;
    const { rows } = await db.query(
      'SELECT 1 FROM acct_tax_deadlines WHERE period_label = $1 LIMIT 1',
      [label]
    );
    if (!rows.length) {
      await seedForYear(y);
    }
  }
}

async function getAll() {
  await ensureSeeded();
  const { rows } = await db.query(
    'SELECT * FROM acct_tax_deadlines ORDER BY due_date ASC'
  );
  return addEffectiveStatus(rows);
}

async function bulkMarkFiled(beforeDate) {
  const { rows } = await db.query(
    `UPDATE acct_tax_deadlines
     SET status = 'filed', filing_date = COALESCE(filing_date, due_date), updated_at = now()
     WHERE due_date < $1 AND status NOT IN ('filed', 'paid')
     RETURNING *`,
    [beforeDate]
  );
  return { updated: rows.length, rows: addEffectiveStatus(rows) };
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

// The daily alert.
//
// Three rules, each one a bug this had:
//
//   1. It only fires for something genuinely due. A deadline already past is
//      not news every morning for nine months.
//   2. Overdue items ride along as a second section when the email fires
//      anyway, so they are visible without being the reason for sending.
//   3. If nothing is due but something is overdue, it fires once a week
//      rather than daily. Still a nudge, no longer a drumbeat.
//
// `now` and `today` are injectable so the guard can drive the calendar
// without waiting for a Monday.
async function sendAlerts(daysAhead = 14, { now = new Date(), weeklyDay = 1 } = {}) {
  const rows = await getUpcoming(daysAhead, { now });
  const { overdue, dueSoon } = partitionByDue(rows);

  if (!dueSoon.length && !overdue.length) return { sent: false, reason: 'nothing due' };

  // Nothing imminent: the overdue list alone is worth one reminder a week.
  if (!dueSoon.length && now.getDay() !== weeklyDay) {
    return { sent: false, reason: 'only overdue, and not the weekly day', overdue: overdue.length };
  }

  const to = process.env.ACCOUNTS_DIGEST_EMAIL || process.env.ALERT_EMAIL;
  if (!to) return { sent: false, reason: 'no recipient configured' };

  const row = (d) => {
    const days = d.days_until;
    const when = days < 0
      ? `${Math.abs(days)} days late`
      : days === 0 ? 'today' : `${days} days`;
    const urgency = days < 0 ? '!!' : days <= 3 ? '!!' : days <= 7 ? '!' : '';
    return `<tr><td>${urgency} ${d.tax_type}</td><td>${d.period_label}</td>`
      + `<td>${d.due_date.toISOString().split('T')[0]}</td><td>${when}</td>`
      // effective_status, not status. The raw column still reads "upcoming"
      // on a deadline nine months past; addEffectiveStatus is what knows.
      + `<td>${d.effective_status}</td></tr>`;
  };

  const table = (rowsIn) => `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
<tr><th>Type</th><th>Period</th><th>Due</th><th>When</th><th>Status</th></tr>
${rowsIn.map(row).join('\n')}
</table>`;

  const parts = ['<h2>Tax deadline alert</h2>'];

  if (dueSoon.length) {
    parts.push(`<p><strong>${dueSoon.length} deadline${dueSoon.length > 1 ? 's' : ''} due within ${daysAhead} days:</strong></p>`);
    parts.push(table(dueSoon));
  }

  if (overdue.length) {
    parts.push(`<p style="margin-top:24px"><strong>${overdue.length} already overdue.</strong>`
      + ` If these are paid and simply not recorded, close them in one step at`
      + ` /accounts/deadlines rather than seeing them here again.</p>`);
    parts.push(table(overdue));
  }

  parts.push('<p style="color:#666;font-size:12px">Sent by OMI Accounts. Update status at /accounts/deadlines.</p>');

  // The subject says what is actually due. "23 due within 14 days" over a
  // list of nine-month-old entries is how this stopped being read.
  const subject = dueSoon.length
    ? `Tax deadlines: ${dueSoon.length} due within ${daysAhead} days`
      + (overdue.length ? `, ${overdue.length} overdue` : '')
    : `Tax deadlines: ${overdue.length} overdue`;

  const { buildTransporter } = require('../../routes/settings');
  const sender = process.env.EMAIL_PROVIDER === 'ses'
    ? (process.env.SES_FROM_EMAIL || process.env.GMAIL_USER)
    : `"October Communications" <${process.env.GMAIL_USER}>`;

  await buildTransporter().sendMail({ from: sender, to, subject, html: parts.join('\n') });
  return { sent: true, to, dueSoon: dueSoon.length, overdue: overdue.length, subject };
}

// Infer filed status from confirmed payments in the reconcile queue.
// Matches deadline types to supplier patterns and account codes already
// in the brain: HMRC (820/VAT), NEST (482/Pension), PAYE (Daniel Nelson).
const DEADLINE_PAYMENT_MAP = {
  VAT: { payeePatterns: ['hmrc', 'hm revenue'], accountCodes: ['820'] },
  PENSION: { payeePatterns: ['nest'], accountCodes: ['482'] },
  PAYE: { payeePatterns: ['hmrc', 'hm revenue', 'paye'], accountCodes: ['810', '820'] },
  CT600: { payeePatterns: ['hmrc', 'hm revenue'], accountCodes: ['820'] },
};

async function inferFiledFromPayments() {
  const { rows: unfiled } = await db.query(
    `SELECT * FROM acct_tax_deadlines WHERE status NOT IN ('filed', 'paid') ORDER BY due_date`
  );
  if (!unfiled.length) return { checked: 0, inferred: 0 };

  let inferred = 0;
  for (const d of unfiled) {
    const mapping = DEADLINE_PAYMENT_MAP[d.tax_type];
    if (!mapping) continue;

    const dueDate = new Date(d.due_date);
    // Window: 60 days before due date to 14 days after (covers early and late payments).
    const windowStart = new Date(dueDate);
    windowStart.setDate(windowStart.getDate() - 60);
    const windowEnd = new Date(dueDate);
    windowEnd.setDate(windowEnd.getDate() + 14);

    const payeeLike = mapping.payeePatterns.map((_, i) => `lower(q.payee) LIKE $${i + 4}`).join(' OR ');
    const params = [
      windowStart.toISOString(),
      windowEnd.toISOString(),
      mapping.accountCodes,
      ...mapping.payeePatterns.map(p => `%${p}%`),
    ];

    const { rows: payments } = await db.query(
      `SELECT q.line_date, q.amount, q.payee
       FROM acct_reconcile_queue q
       WHERE q.status IN ('confirmed', 'written')
         AND q.line_date >= $1 AND q.line_date <= $2
         AND (q.account_code = ANY($3) OR (${payeeLike}))
       ORDER BY q.line_date DESC
       LIMIT 1`,
      params
    );

    if (payments.length) {
      await db.query(
        `UPDATE acct_tax_deadlines
         SET status = 'filed', filing_date = $1, payment_amount = $2, updated_at = now()
         WHERE id = $3 AND status NOT IN ('filed', 'paid')`,
        [payments[0].line_date, Math.abs(payments[0].amount), d.id]
      );
      inferred++;
    }
  }

  return { checked: unfiled.length, inferred };
}

module.exports = {
  generateDeadlines,
  seedDeadlines,
  seedForYear,
  getUpcoming,
  partitionByDue,
  getAll,
  updateDeadline,
  bulkMarkFiled,
  inferFiledFromPayments,
  sendAlerts,
};
