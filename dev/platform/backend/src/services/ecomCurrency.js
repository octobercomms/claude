// Which currency a client's revenue is actually in.
//
// /sales-traffic sums total_revenue across every connected Shopify and Woo
// store. The frontend used to print that sum with a hardcoded pound sign,
// which was right for a UK client and silently wrong for Architecture Tours,
// whose dollars were labelled as sterling. A wrong symbol is worse than none:
// the number reads as a fact.
//
// Each connector now reports its store's own currency, and this decides what
// to do with them. One currency only when every store agrees — because the
// revenue is a plain sum, stores on different currencies make that total
// meaningless, and the honest answer is to show it unlabelled and say why
// rather than stamping one store's symbol on a mixed figure.

// `summaries` is each store's `summary` object from its connector.
// Returns { currency, note }: `currency` an ISO code or null, `note` a line
// for the response's notes array, or null when there is nothing to say.
function agreeCurrency(summaries) {
  const codes = new Set();
  for (const s of summaries || []) {
    const raw = s && s.currency;
    if (raw == null) continue;
    const code = String(raw).trim().toUpperCase();
    // A blank or junk value is no information, not a currency. Three letters
    // is the ISO 4217 shape; anything else came from somewhere we do not
    // understand and must not be shown as money.
    if (/^[A-Z]{3}$/.test(code)) codes.add(code);
  }

  if (codes.size === 0) return { currency: null, note: null };
  if (codes.size === 1) return { currency: [...codes][0], note: null };

  return {
    currency: null,
    note: `Stores report different currencies (${[...codes].sort().join(', ')}) — `
      + 'revenue is a plain sum across them, so it is shown without a currency. '
      + 'Converting would need an FX rate per day.',
  };
}

module.exports = { agreeCurrency };
