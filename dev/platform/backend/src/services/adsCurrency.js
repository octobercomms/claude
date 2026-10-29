// What currency the Paid page's numbers are in.
//
// `/connectors/client/:id/ads-data` returns one entry per ad account, and the
// page adds them up at three levels: each account on its own, a per-platform
// "All Countries — Combined" total, and a blended Google + Meta figure. Every
// one of those was printed with a hardcoded pound sign.
//
// That is the same bug the ecommerce revenue had, with one difference that
// makes it more likely: a Google Ads setup with a UK and a US account is
// normal, so the blended total is routinely a sum across currencies. Both
// connectors already report the account currency (`customer.currency_code` on
// Google, the ad account's `currency` field on Meta), so this is only a matter
// of carrying it through and deciding what each sum is denominated in.
//
// The decision is `resolveCurrency`'s, so the Paid page and the Dashboard
// cannot drift apart on it: the client's own reporting currency wins, the
// accounts are the default, and a sum across disagreeing accounts is flagged
// rather than quietly stamped with one symbol.

const { resolveCurrency, AD_ACCOUNTS } = require('./ecomCurrency');

// An entry is `{ data, error }` as the route builds it. A failed account
// contributes nothing: it has no currency, and its spend is not in the sum
// either.
function currenciesOf(entries) {
  return (entries || [])
    .filter(e => e && !e.error)
    .map(e => ({ currency: e.data && e.data.currency }));
}

// Returns { google, meta, blended }, each { currency, note }.
//
// `blended` is resolved over both platforms together rather than inherited
// from either, because Google in GBP and Meta in USD is a disagreement that
// only shows up once they are added.
function summariseAdsCurrency(clientCurrency, googleEntries, metaEntries) {
  const google = currenciesOf(googleEntries);
  const meta = currenciesOf(metaEntries);
  return {
    google: resolveCurrency(clientCurrency, google, AD_ACCOUNTS),
    meta: resolveCurrency(clientCurrency, meta, AD_ACCOUNTS),
    blended: resolveCurrency(clientCurrency, [...google, ...meta], AD_ACCOUNTS),
  };
}

module.exports = { summariseAdsCurrency, currenciesOf };
