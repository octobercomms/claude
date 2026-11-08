// VAT quarter-end pack preparation.
// Queries confirmed transactions for a quarter, flags exceptions,
// generates a summary broken down by VAT rate, and stores exceptions
// in acct_vat_exceptions for review before filing.

const db = require('../../db');
const xero = require('../../connectors/xero');

const VAT_QUARTERS = [
  { q: 1, start: '01-01', end: '03-31', label: 'Q1 Jan-Mar' },
  { q: 2, start: '04-01', end: '06-30', label: 'Q2 Apr-Jun' },
  { q: 3, start: '07-01', end: '09-30', label: 'Q3 Jul-Sep' },
  { q: 4, start: '10-01', end: '12-31', label: 'Q4 Oct-Dec' },
];

function getCurrentQuarter() {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const q = Math.floor(month / 3);
  return { year, ...VAT_QUARTERS[q] };
}

function getPreviousQuarter() {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const q = Math.floor(month / 3);
  if (q === 0) return { year: year - 1, ...VAT_QUARTERS[3] };
  return { year, ...VAT_QUARTERS[q - 1] };
}

function quarterDates(year, quarter) {
  const qDef = VAT_QUARTERS.find(v => v.q === quarter) || VAT_QUARTERS[0];
  return {
    periodStart: `${year}-${qDef.start}`,
    periodEnd: `${year}-${qDef.end}`,
    periodLabel: `${qDef.label} ${year}`,
  };
}

async function buildVatPack(year, quarter) {
  const { periodStart, periodEnd, periodLabel } = quarterDates(year, quarter);

  // Fetch all confirmed/written queue items in the period.
  const { rows: items } = await db.query(
    `SELECT * FROM acct_reconcile_queue
     WHERE line_date BETWEEN $1 AND $2
       AND status IN ('confirmed', 'written')
     ORDER BY line_date`,
    [periodStart, periodEnd]
  );

  // Group by VAT rate.
  const byRate = {};
  for (const item of items) {
    const rate = item.suggested_rate || 'NONE';
    if (!byRate[rate]) byRate[rate] = { count: 0, net: 0, items: [] };
    byRate[rate].count++;
    byRate[rate].net += parseFloat(item.amount) || 0;
    byRate[rate].items.push(item);
  }

  // Flag exceptions.
  const exceptions = [];

  for (const item of items) {
    const flags = detectExceptions(item);
    for (const flag of flags) {
      exceptions.push({
        period: periodLabel,
        lineRef: item.line_ref,
        amount: item.amount,
        currency: item.currency,
        payee: item.payee,
        reason: flag,
      });
    }
  }

  // Store exceptions.
  let newExceptions = 0;
  for (const ex of exceptions) {
    const { rowCount } = await db.query(
      `INSERT INTO acct_vat_exceptions (period, line_ref, amount, currency, payee, flag_reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [ex.period, ex.lineRef, ex.amount, ex.currency, ex.payee, ex.reason]
    );
    if (rowCount) newExceptions++;
  }

  // Check for missing invoices in this period.
  const { rows: missingInvoices } = await db.query(
    `SELECT q.* FROM acct_reconcile_queue q
     LEFT JOIN acct_invoice_matches im ON im.line_ref = q.line_ref AND im.status IN ('matched', 'attached')
     WHERE q.line_date BETWEEN $1 AND $2
       AND q.status IN ('confirmed', 'written')
       AND im.id IS NULL
       AND ABS(q.amount) > 50`,
    [periodStart, periodEnd]
  );

  // Summary totals.
  const outputVat = (byRate['OUTPUT2']?.net || 0) * 0.2;
  const inputVat = (byRate['INPUT2']?.net || 0) * 0.2;
  const reverseCharge = (byRate['RRINPUT']?.net || 0) + (byRate['REVERSECHARGES']?.net || 0);

  const summary = {
    period: periodLabel,
    periodStart,
    periodEnd,
    totalTransactions: items.length,
    byRate: Object.entries(byRate).map(([rate, data]) => ({
      rate,
      count: data.count,
      net: Math.round(data.net * 100) / 100,
    })),
    outputVat: Math.round(outputVat * 100) / 100,
    inputVat: Math.round(inputVat * 100) / 100,
    reverseCharge: Math.round(reverseCharge * 100) / 100,
    netPayable: Math.round((outputVat - inputVat) * 100) / 100,
    exceptions: exceptions.length,
    unresolvedExceptions: 0,
    missingInvoices: missingInvoices.length,
  };

  // Count unresolved exceptions for this period.
  const { rows: [{ count: unresolved }] } = await db.query(
    `SELECT count(*)::int as count FROM acct_vat_exceptions
     WHERE period = $1 AND resolved_at IS NULL`,
    [periodLabel]
  );
  summary.unresolvedExceptions = unresolved;

  return { summary, newExceptions, missingInvoiceCount: missingInvoices.length };
}

function detectExceptions(item) {
  const flags = [];
  const rate = (item.suggested_rate || '').toUpperCase();
  const payee = (item.payee || '').toLowerCase();
  const amount = Math.abs(parseFloat(item.amount) || 0);

  // Entertainment is non-deductible for VAT.
  if (/restaurant|dinner|lunch|entertain|hospitality|bar|pub|cafe/i.test(payee)) {
    if (rate === 'INPUT2') {
      flags.push('Possible entertainment expense claimed with INPUT2; entertainment VAT is non-reclaimable');
    }
  }

  // Reverse charge: services from overseas suppliers should use a reverse charge rate.
  if (/stripe|google|meta|facebook|adobe|slack|notion|figma|canva|mailchimp|hubspot/i.test(payee)) {
    if (rate === 'INPUT2') {
      flags.push('Overseas SaaS supplier coded as INPUT2; likely reverse charge');
    }
  }

  // Large transactions without matched invoices flag for review.
  if (amount > 1000 && !item.invoice_status?.includes('matched')) {
    flags.push('Transaction over 1,000 without a matched invoice');
  }

  // FX transactions: non-GBP items may need FX gain/loss treatment.
  if (item.currency && item.currency !== 'GBP' && amount > 100) {
    flags.push(`Foreign currency transaction (${item.currency}); check FX gain/loss treatment`);
  }

  // Zero-rated vs exempt: common confusion.
  if (rate === 'ZERORATEDINPUT' && amount > 500) {
    flags.push('Large zero-rated input; verify this is genuinely zero-rated and not exempt');
  }

  return flags;
}

async function getExceptions(period) {
  const where = period ? 'WHERE period = $1' : '';
  const params = period ? [period] : [];
  const { rows } = await db.query(
    `SELECT * FROM acct_vat_exceptions ${where} ORDER BY resolved_at NULLS FIRST, created_at DESC`,
    params
  );
  return rows;
}

async function resolveException(id, resolution) {
  const { rows } = await db.query(
    `UPDATE acct_vat_exceptions SET resolution = $1, resolved_at = now() WHERE id = $2 RETURNING *`,
    [resolution, id]
  );
  return rows[0] || null;
}

async function getVatReport(year, quarter) {
  const { periodStart, periodEnd, periodLabel } = quarterDates(year, quarter);

  // Pull Xero trial balance for the period if connected.
  let trialBalance = null;
  try {
    const token = await xero.getValidToken();
    trialBalance = await xero.getTrialBalance(token, periodEnd);
  } catch {
    // Xero not connected or error; continue without.
  }

  const pack = await buildVatPack(year, quarter);

  return {
    ...pack,
    trialBalance,
  };
}

module.exports = {
  getCurrentQuarter,
  getPreviousQuarter,
  quarterDates,
  buildVatPack,
  detectExceptions,
  getExceptions,
  resolveException,
  getVatReport,
};
