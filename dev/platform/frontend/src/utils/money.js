// Money formatting, where the currency comes from the data rather than from
// where we happen to sit.
//
// Measure, the client's own dashboard and the ad pages each carried their own
// `'£' + n.toLocaleString('en-GB')`. That is right for a UK store and silently
// wrong for every other one: Architecture Tours bills in USD and its revenue
// was labelled in pounds, which is worse than an unlabelled number because it
// reads as a fact. `/sales-traffic/:id` now reports the store's own currency,
// and this is the one place that turns an amount plus a currency into text.

// Enough to cover the currencies OMI's connectors actually report. Anything
// else falls through to Intl, which gives a code rather than a symbol — a
// correct "CHF 1,200" beats a wrong "£1,200".
const SYMBOLS = {
  GBP: '£', USD: '$', EUR: '€', CAD: 'C$', AUD: 'A$', NZD: 'NZ$', JPY: '¥',
};

// `currency` is an ISO 4217 code (GBP, USD) or null when nothing reported one.
// Null gives a bare number: we do not know the unit, so we do not claim one.
// `dp` is for the places that need pence (ad spend); the default rounds,
// because a revenue KPI reading £48,210.37 is noise in a tile.
export function formatMoney(amount, currency, { dp = 0 } = {}) {
  if (amount == null || amount === '' || Number.isNaN(Number(amount))) return '—';
  const n = Number(amount);
  const code = currency ? String(currency).toUpperCase() : null;
  const opts = { minimumFractionDigits: dp, maximumFractionDigits: dp };

  if (!code) return n.toLocaleString('en-GB', opts);

  // Sign outside the symbol: -$250, not $-250.
  const symbol = SYMBOLS[code];
  if (symbol) return (n < 0 ? '-' : '') + symbol + Math.abs(n).toLocaleString('en-GB', opts);

  // No symbol known — let Intl decide, and fall back to "CODE amount" if it
  // rejects the code (it throws on anything non-ISO).
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: code, ...opts }).format(n);
  } catch {
    return `${code} ${n.toLocaleString('en-GB', opts)}`;
  }
}

// The symbol on its own, for an axis tick or a field label. Falls back to the
// code, never to a pound sign.
export function currencySymbol(currency) {
  if (!currency) return '';
  const code = String(currency).toUpperCase();
  return SYMBOLS[code] || code;
}
