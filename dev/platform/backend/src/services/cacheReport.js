// What prompt caching is actually doing, per feature.
//
// Anthropic's console says caching could save October up to 52% of direct API
// spend. Before changing forty call sites on the strength of that, it is
// worth knowing which of them are already cached, which are caching and never
// reading it back, and which are not caching at all. Every one of those is a
// different fix, and two of them are the opposite of each other.
//
// The data is already here. Every Claude call writes its usage payload into
// api_cost_events.meta, cache fields included, so this is a read.
//
// The three numbers that matter per feature:
//
//   read    — input tokens served from cache, at ~0.1x. The saving.
//   write   — input tokens written to cache, at 1.25x. An investment, and a
//             loss if nothing reads it.
//   plain   — input tokens with no caching at all. The opportunity.
//
// A feature with writes and no reads is worse off than one with no caching:
// it pays a 25% premium on every call and never collects. That is the case
// this report exists to find, and it is invisible in a total spend figure.

const pool = require('../db');
const { priceForModel, CACHE_WRITE_MULTIPLIER, CACHE_1H_WRITE_MULTIPLIER, DEFAULT_CACHE_READ } = require('./costLog');

// The write tiers arrive in two shapes, exactly as claudeCostFromUsage reads
// them: a flat field on a Messages response, a split object on newer ones.
function writesFrom(meta) {
  const split = meta?.cache_creation || null;
  return {
    w5m: split ? Number(split.ephemeral_5m_input_tokens || 0) : Number(meta?.cache_creation_input_tokens || 0),
    w1h: split ? Number(split.ephemeral_1h_input_tokens || 0) : 0,
  };
}

/**
 * Per-feature cache effectiveness over a window.
 *
 * `savedUsd` is measured, not modelled: what the cached reads cost against
 * what those same tokens would have cost at full input price, minus what the
 * writes cost above full price. It can be negative, and a negative number is
 * the useful output.
 */
async function cacheReport({ days = 30 } = {}) {
  const window = Math.min(365, Math.max(1, Number(days) || 30));
  const { rows } = await pool.query(
    `SELECT feature, meta, cost_usd
       FROM api_cost_events
      WHERE provider = 'anthropic'
        AND ts > NOW() - ($1 || ' days')::interval`,
    [String(window)]
  );

  const byFeature = new Map();
  for (const r of rows) {
    const meta = r.meta || {};
    const model = meta.model || null;
    const { price } = priceForModel(model);
    const readMult = price.cacheRead ?? DEFAULT_CACHE_READ;
    const { w5m, w1h } = writesFrom(meta);
    const read = Number(meta.cache_read_input_tokens || 0);
    const plain = Number(meta.input_tokens || 0);

    const f = byFeature.get(r.feature) || {
      feature: r.feature, calls: 0, read: 0, write: 0, plain: 0,
      savedUsd: 0, spentUsd: 0, models: new Set(),
    };
    f.calls += 1;
    f.read += read;
    f.write += w5m + w1h;
    f.plain += plain;
    f.spentUsd += Number(r.cost_usd) || 0;
    if (model) f.models.add(model);

    // What the reads saved: full price minus what they actually cost.
    f.savedUsd += (read / 1e6) * price.input * (1 - readMult);
    // What the writes cost over the plain price. Subtracted, because it is
    // the premium paid for the reads above.
    f.savedUsd -= (w5m / 1e6) * price.input * (CACHE_WRITE_MULTIPLIER - 1);
    f.savedUsd -= (w1h / 1e6) * price.input * (CACHE_1H_WRITE_MULTIPLIER - 1);
    byFeature.set(r.feature, f);
  }

  const features = [...byFeature.values()].map((f) => {
    const cacheable = f.read + f.write + f.plain;
    return {
      feature: f.feature,
      calls: f.calls,
      models: [...f.models],
      read_tokens: f.read,
      write_tokens: f.write,
      plain_tokens: f.plain,
      // Of the input tokens this feature sent, how many came from cache.
      hit_rate: cacheable ? Math.round((f.read / cacheable) * 1000) / 10 : 0,
      saved_usd: Math.round(f.savedUsd * 10000) / 10000,
      spent_usd: Math.round(f.spentUsd * 10000) / 10000,
      // The three states, named, because each needs a different fix.
      state: verdict(f),
    };
  }).sort((a, b) => b.spent_usd - a.spent_usd);

  const totals = features.reduce((t, f) => ({
    calls: t.calls + f.calls,
    read_tokens: t.read_tokens + f.read_tokens,
    write_tokens: t.write_tokens + f.write_tokens,
    plain_tokens: t.plain_tokens + f.plain_tokens,
    saved_usd: Math.round((t.saved_usd + f.saved_usd) * 10000) / 10000,
    spent_usd: Math.round((t.spent_usd + f.spent_usd) * 10000) / 10000,
  }), { calls: 0, read_tokens: 0, write_tokens: 0, plain_tokens: 0, saved_usd: 0, spent_usd: 0 });
  const totalIn = totals.read_tokens + totals.write_tokens + totals.plain_tokens;
  totals.hit_rate = totalIn ? Math.round((totals.read_tokens / totalIn) * 1000) / 10 : 0;

  return { window_days: window, totals, features };
}

/**
 * Which of the three problems this feature has.
 *
 *   working   — writing and reading. Leave it alone.
 *   wasting   — writing and nothing reads it back. Worse than not caching:
 *               a 25% premium collected by nobody. Usually a prompt that
 *               varies per call, or calls spaced further apart than the
 *               5-minute window.
 *   uncached  — no caching at all. The opportunity, if the prefix is stable
 *               and over the minimum cacheable length.
 *   quiet     — too little traffic to say anything about.
 */
function verdict(f) {
  const total = f.read + f.write + f.plain;
  if (f.calls < 3 || total < 10000) return 'quiet';
  if (f.write === 0 && f.read === 0) return 'uncached';
  // One rule, not two. "Writes and never reads" and "reads back less than it
  // writes" are the same disease at different strengths, and writing them
  // separately meant either line could be deleted with no change in
  // behaviour — which a mutation run duly proved.
  if (f.write > f.read) return 'wasting';
  return 'working';
}

module.exports = { cacheReport, verdict, writesFrom };
