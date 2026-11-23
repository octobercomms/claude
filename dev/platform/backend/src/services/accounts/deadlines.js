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

// How urgent a deadline is, as a band rather than a number.
//
// This is what decides whether an alert is news. The 18 November fix stopped
// the alert claiming nine-month-old entries were due within fourteen days, and
// left a true one repeating: the gate asked only "is anything due", so one real
// deadline in the window emailed every weekday until it passed. Ten emails
// about one deadline trains you to ignore the eleventh, which is the same
// failure in a different costume.
//
// Banding means an approaching deadline re-alerts when it crosses a line —
// typically three or four times over a fortnight, each because something
// actually changed — rather than once a day regardless.
const ALERT_BUCKETS = ['overdue', 'today', 'days_3', 'days_7', 'days_14'];

function urgencyBucket(daysUntil) {
  if (daysUntil < 0) return 'overdue';
  if (daysUntil === 0) return 'today';
  if (daysUntil <= 3) return 'days_3';
  if (daysUntil <= 7) return 'days_7';
  return 'days_14';
}

// Has anything changed about this deadline since it was last mentioned?
// A row never alerted (null bucket) is always news.
function isNewsSince(deadline) {
  return urgencyBucket(deadline.days_until) !== (deadline.last_alert_bucket || null);
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

  // Something is due — but has anything about it changed since the last email?
  // Without this the same deadline is reported every weekday until it passes.
  // The weekly overdue nudge is exempt: it is already once a week, and its
  // whole point is to keep asking.
  const news = dueSoon.filter(isNewsSince);
  if (dueSoon.length && !news.length) {
    return {
      sent: false,
      reason: 'already alerted at this urgency',
      dueSoon: dueSoon.length,
      overdue: overdue.length,
    };
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

  // Record what each deadline in this email was reported as, so the next run
  // can tell whether anything moved. Best-effort: the email has gone, and
  // losing the bookkeeping means one extra email rather than a missed
  // deadline.
  const alerted = [...dueSoon, ...overdue];
  if (alerted.length) {
    try {
      await db.query(
        `UPDATE acct_tax_deadlines AS d
            SET last_alert_bucket = v.bucket, last_alerted_at = now()
           FROM (SELECT unnest($1::bigint[]) AS id, unnest($2::text[]) AS bucket) AS v
          WHERE d.id = v.id`,
        [alerted.map(d => d.id), alerted.map(d => urgencyBucket(d.days_until))]
      );
    } catch (err) {
      console.error('[deadlines] recording alert state failed:', err.message);
    }
  }

  return {
    sent: true, to, subject,
    dueSoon: dueSoon.length,
    overdue: overdue.length,
    newsCount: news.length,
  };
}

// Detecting that a deadline was paid.
//
// This read the reconcile queue until 18 November, and could never have
// worked. connectors/xero.js:252 filters that feed with
// `.filter(tx => tx.IsReconciled !== true)`, so the queue holds only bank
// lines nobody has reconciled yet. A PAYE or pension payment that was made
// and then reconciled in Xero never enters it. The one table being asked was
// the one guaranteed not to hold the answer, which is why the button reported
// "checked 58 deadlines, 0 updated" even after its SQL was fixed.
//
// It now asks Xero directly, through getAllBankTransactions, which carries
// reconciled and unreconciled alike along with each line's account code.
//
// The account codes are read from the chart of accounts rather than written
// down here. The old map hardcoded 820 for VAT, 482 for pension and 810/820
// for PAYE; those numbers are a guess about somebody's chart, and 820 served
// both VAT and PAYE, so an HMRC payment could satisfy either. Matching on the
// name Xero gives the account ("VAT", "PAYE Payable", "Pension Payable") uses
// what the file actually says.

const xero = require('../../connectors/xero');

// How a tax type is recognised in an account name. Ordered: pension is tested
// before PAYE because an account named "Pension/PAYE control" should read as
// pension, and NEST is the unambiguous signal in this company's data.
const ACCOUNT_NAME_PATTERNS = [
  ['PENSION', /pension|\bnest\b|national employment savings/i],
  ['VAT', /\bvat\b|value added tax/i],
  ['PAYE', /\bpaye\b|\bnic\b|national insurance|payroll (?:tax|liabilit)/i],
  ['CT600', /corporation tax/i],
];

// Payees that identify a tax type on their own. HMRC is deliberately absent:
// it collects VAT, PAYE and corporation tax alike, so the name alone cannot
// say which deadline a payment settles. A payment to HMRC with no recognised
// account code is reported as ambiguous rather than assigned.
const PAYEE_PATTERNS = [
  ['PENSION', /\bnest\b|national employment savings/i],
];

const HMRC = /hmrc|h\.?m\.? revenue/i;

// How far before and after a due date a payment can sit and still be that
// deadline's. Monthly obligations get a tighter window than quarterly ones:
// at the old ±60/+14 a single window spanned two and a half monthly periods,
// so one payment could be read as settling two different months.
const WINDOWS = {
  PENSION: { before: 31, after: 21 },
  PAYE: { before: 31, after: 21 },
  VAT: { before: 60, after: 21 },
  CT600: { before: 60, after: 30 },
  SA: { before: 60, after: 30 },
  OTHER: { before: 45, after: 21 },
};

// code -> tax type, built from the names in the connected Xero file.
function taxCodeMap(chart) {
  const map = new Map();
  for (const account of chart || []) {
    if (!account?.code || !account?.name) continue;
    for (const [type, re] of ACCOUNT_NAME_PATTERNS) {
      if (re.test(account.name)) { map.set(String(account.code), type); break; }
    }
  }
  return map;
}

// What tax does this payment settle? Returns a type, or null, or the string
// 'ambiguous' for an HMRC payment carrying nothing that says which tax it is.
function classifyPayment(tx, codeMap) {
  // The account it was coded to is the strongest evidence: it is the answer
  // somebody already gave when they reconciled it.
  for (const li of tx.lineItems || []) {
    const type = codeMap.get(String(li.accountCode));
    if (type) return { type, by: `account ${li.accountCode}` };
  }
  const text = `${tx.contactName || ''} ${tx.reference || ''}`;
  for (const [type, re] of PAYEE_PATTERNS) {
    if (re.test(text)) return { type, by: 'payee' };
  }
  if (HMRC.test(text)) return { type: null, by: 'hmrc, tax not identified', ambiguous: true };
  return null;
}

function daysBetween(a, b) {
  return Math.round((a - b) / 86400000);
}

/**
 * Match payments in Xero to deadlines that are not yet marked filed.
 *
 * Assignment is one payment to one deadline. A monthly obligation pays every
 * month, so several payments of the same type fall near each other; pairing
 * them off by closeness stops one payment being read as settling two months,
 * which is the shape of error that would quietly mark a period filed that
 * nobody has paid.
 *
 * `dryRun` reports what it would do and changes nothing.
 */
async function inferFiledFromPayments({ dryRun = false } = {}) {
  const { rows: unfiled } = await db.query(
    `SELECT * FROM acct_tax_deadlines WHERE status NOT IN ('filed', 'paid') ORDER BY due_date`
  );
  if (!unfiled.length) {
    return { checked: 0, inferred: 0, scanned: 0, matches: [], unmatched: [], notes: ['nothing unfiled'] };
  }

  const notes = [];
  const token = await xero.getValidToken();

  const chart = await xero.getChartOfAccounts(token).catch(err => {
    notes.push(`chart of accounts unavailable (${err.message}); matching on payee only`);
    return [];
  });
  const codeMap = taxCodeMap(chart);
  if (!codeMap.size) {
    notes.push('no account in the Xero chart names a tax this tracks, so only NEST payments can be identified');
  }

  // Reach back far enough to cover the earliest deadline's own window.
  const earliestDue = new Date(unfiled[0].due_date);
  const since = new Date(earliestDue);
  since.setDate(since.getDate() - 70);

  const all = await xero.getAllBankTransactions(token, { since });
  const spend = all.filter(tx => tx.type === 'SPEND');

  // Group candidate payments by the tax they settle.
  const byType = new Map();
  let ambiguous = 0;
  for (const tx of spend) {
    const hit = classifyPayment(tx, codeMap);
    if (!hit) continue;
    if (hit.ambiguous) { ambiguous++; continue; }
    if (!byType.has(hit.type)) byType.set(hit.type, []);
    byType.get(hit.type).push({ ...tx, matchedBy: hit.by });
  }
  if (ambiguous) {
    notes.push(`${ambiguous} HMRC payment${ambiguous === 1 ? '' : 's'} carried no account code naming a tax, so could not be told apart from each other`);
  }

  // Pair each payment with the open deadline it sits closest to, one to one.
  const pairs = [];
  for (const d of unfiled) {
    const candidates = byType.get(d.tax_type) || [];
    const win = WINDOWS[d.tax_type] || WINDOWS.OTHER;
    const due = new Date(d.due_date);
    for (const tx of candidates) {
      const gap = daysBetween(new Date(tx.date), due);
      if (gap < -win.before || gap > win.after) continue;
      pairs.push({ deadline: d, tx, distance: Math.abs(gap) });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance);

  const takenDeadline = new Set();
  const takenTx = new Set();
  const matches = [];
  for (const pair of pairs) {
    if (takenDeadline.has(pair.deadline.id) || takenTx.has(pair.tx.transactionId)) continue;
    takenDeadline.add(pair.deadline.id);
    takenTx.add(pair.tx.transactionId);
    matches.push(pair);
  }

  let inferred = 0;
  for (const m of matches) {
    if (dryRun) continue;
    const { rowCount } = await db.query(
      `UPDATE acct_tax_deadlines
       SET status = 'filed', filing_date = $1, payment_amount = $2, updated_at = now()
       WHERE id = $3 AND status NOT IN ('filed', 'paid')`,
      [m.tx.date, Math.abs(Number(m.tx.amount) || 0), m.deadline.id]
    );
    inferred += rowCount;
  }

  return {
    checked: unfiled.length,
    inferred: dryRun ? 0 : inferred,
    wouldInfer: matches.length,
    scanned: spend.length,
    dryRun,
    matches: matches.map(m => ({
      period: m.deadline.period_label,
      tax_type: m.deadline.tax_type,
      due_date: m.deadline.due_date,
      paid_on: m.tx.date,
      amount: m.tx.amount,
      payee: m.tx.contactName,
      reference: m.tx.reference,
      matched_by: m.tx.matchedBy,
      reconciled: m.tx.isReconciled,
    })),
    unmatched: unfiled
      .filter(d => !takenDeadline.has(d.id))
      .map(d => ({
        period: d.period_label,
        tax_type: d.tax_type,
        due_date: d.due_date,
        candidates_of_this_type: (byType.get(d.tax_type) || []).length,
      })),
    notes,
  };
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
  // Exported for the guard: the pure parts, so the matching can be driven
  // without a Xero connection.
  _internals: { taxCodeMap, classifyPayment, ACCOUNT_NAME_PATTERNS, WINDOWS, urgencyBucket, isNewsSince, ALERT_BUCKETS },
};
