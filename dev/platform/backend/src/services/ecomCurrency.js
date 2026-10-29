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

// The same question comes up wherever OMI sums money across connectors, and
// the sources need naming in the note: a Paid page saying "Stores report
// different currencies" about two Google Ads accounts would read as a bug.
// So the rule lives here once and the caller supplies the noun.
const STORES = { one: 'store', many: 'stores' };
const AD_ACCOUNTS = { one: 'ad account', many: 'ad accounts' };

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// `summaries` is each store's `summary` object from its connector.
// Returns { currency, note }: `currency` an ISO code or null, `note` a line
// for the response's notes array, or null when there is nothing to say.
function agreeCurrency(summaries, source = STORES) {
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
    note: `${cap(source.many)} report different currencies (${[...codes].sort().join(', ')}) — `
      + 'the figure is a plain sum across them, so it is shown without a currency. '
      + 'Converting would need an FX rate per day.',
  };
}

// What the figures are actually denominated in, given both sources.
//
// The client's own setting wins. It is the account lead saying "this client
// reports in GBP", which is a fact about the client rather than about whichever
// connector happened to answer. The connectors are the default when nobody has
// said.
//
// This matters because `kpis.revenue` comes from GA4 whether or not an
// ecommerce connector reported, so relying on the connectors alone left a
// client with GA4 revenue and no working store connector showing a figure with
// no currency at all.
function resolveCurrency(clientCurrency, summaries, source = STORES) {
  const stated = clientCurrency && /^[A-Za-z]{3}$/.test(String(clientCurrency).trim())
    ? String(clientCurrency).trim().toUpperCase()
    : null;
  const agreed = agreeCurrency(summaries, source);
  if (!stated) return agreed;

  // Everything the stores actually said, which `agreed` collapses to one or
  // none. Needed here because a stated currency changes what each case means.
  const reported = [...new Set((summaries || [])
    .map(x => x && x.currency)
    .filter(c => c && /^[A-Za-z]{3}$/.test(String(c).trim()))
    .map(c => String(c).trim().toUpperCase()))].sort();

  // Stores disagree. This is the dangerous one: revenue is a plain sum across
  // currencies, so labelling it with the stated currency is arithmetic that is
  // simply wrong. Say so rather than letting the label imply a conversion
  // nobody performed.
  if (reported.length > 1) {
    return {
      currency: stated,
      note: `${cap(source.many)} report different currencies (${reported.join(', ')}) and the figures are summed across them without conversion, `
        + `so the ${stated} total is not a true ${stated} figure. Converting would need an FX rate per day.`,
    };
  }

  // One store currency, and it is not the one the client is set to. One of the
  // two is wrong and only the account lead can say which.
  if (reported.length === 1 && reported[0] !== stated) {
    return {
      currency: stated,
      note: `This client is set to report in ${stated}, but its `
        + `${(summaries || []).length > 1 ? `${source.many} report` : `${source.one} reports`} ${reported[0]}. `
        + `Figures are shown in ${stated}; change the reporting currency in Setup if that is wrong.`,
    };
  }

  // Agreement, or nothing reported at all. Nothing to say.
  return { currency: stated, note: null };
}

module.exports = { agreeCurrency, resolveCurrency, STORES, AD_ACCOUNTS };
