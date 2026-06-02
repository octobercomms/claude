// FX rates helper — fetches GBP rates from Frankfurter (ECB-backed, free,
// no auth) and caches per (base, target, date) tuple. Historical rates
// don't change, so once cached we never refetch.
//
// Used by the report renderer to convert per-connector currency totals
// (e.g. Google Ads spend in USD) into a single GBP value when a
// metrics_grid sums across markets that don't share a currency. Without
// this, summing USD onto GBP just produced a meaningless number labelled
// as £ — the user spotted this when their Paid Traffic Performance
// section combined a US and UK Google Ads account.
const axios = require('axios');

const cache = new Map();

async function getRate(base, target, date) {
  if (!base || !target) return null;
  if (base === target) return 1;
  const key = `${base}-${target}-${date || 'latest'}`;
  if (cache.has(key)) return cache.get(key);
  // Frankfurter expects YYYY-MM-DD in the path. Latest endpoint is
  // /latest. Both return { rates: { [target]: number } } when 200.
  const endpoint = date
    ? `https://api.frankfurter.app/${date}?from=${base}&to=${target}`
    : `https://api.frankfurter.app/latest?from=${base}&to=${target}`;
  try {
    const { data } = await axios.get(endpoint, { timeout: 5000 });
    const rate = parseFloat(data?.rates?.[target]);
    if (!isFinite(rate) || rate <= 0) throw new Error(`No rate returned for ${base}→${target}`);
    cache.set(key, rate);
    return rate;
  } catch (err) {
    console.warn(`[fxRates] ${base}→${target} on ${date || 'latest'} failed: ${err.message}`);
    return null;
  }
}

// Build a `{ CURRENCY: rateToGbp }` map by looking at every connector's
// data slice and fetching a GBP rate for each non-GBP currency found.
// Single round-trip per currency thanks to the per-key cache; missing
// rates just skip that currency (the sum will fall back to raw addition).
async function ratesToGbp(rawData, date) {
  const map = { GBP: 1 };
  const seen = new Set();
  for (const data of Object.values(rawData || {})) {
    const cur = data?.currency || data?.summary?.currency;
    if (cur && !seen.has(cur)) seen.add(cur);
  }
  await Promise.all(
    [...seen].filter(c => c !== 'GBP').map(async c => {
      const r = await getRate(c, 'GBP', date);
      if (r) map[c] = r;
    })
  );
  return map;
}

module.exports = { getRate, ratesToGbp };
