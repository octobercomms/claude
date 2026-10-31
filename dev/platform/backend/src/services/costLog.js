/**
 * Per-call API cost logger. Any code path that hits a paid API can call
 * recordApiCost(...) to drop a row into api_cost_events so we can later
 * answer "which feature is the bill coming from" without reading invoices.
 *
 * Fire-and-forget: writes are best-effort and never block the calling code
 * path. A missing migration or a transient DB hiccup must not break a
 * Claude call.
 */
const pool = require('../db');

// Claude model pricing in USD per million tokens.
//
// Checked against platform.claude.com/docs/en/about-claude/pricing on
// 31 Oct 2026. Three rows were wrong before that check, all of them on
// models OMI calls today:
//
//   claude-opus-4-8   listed 15/75, actually 5/25  → over-reported 3x
//   claude-opus-5     listed 15/75, actually 5/25  → over-reported 3x
//   claude-fable-5    listed  3/15, actually 10/50 → under-reported 3.3x
//
// Opus 4.8 is the model behind ten call sites, so the Costs panel has been
// charging OMI three times what its heaviest model actually costs. Anything
// absent from this table used to be priced silently at Sonnet rates; it is
// now counted and named instead (see UNPRICED below), because a wrong number
// nobody can see is worse than a gap.
//
// `cacheRead` is the multiplier on base input for a cache hit. It is 0.1 for
// most models, 0.05 for Opus 5.5 and Sonnet 5.5, and 0.025 for Fable 5.1 and
// Mythos 5.1. Caching is where a heavy agent's bill actually lives, so the
// multiplier is per model rather than one constant.
const CLAUDE_PRICES = {
  // Sonnet 4.6 is the platform default.
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-5':         { input: 3.00,  output: 15.00 },
  'claude-sonnet-5':           { input: 2.00,  output: 10.00 },
  'claude-sonnet-5-5':         { input: 2.00,  output: 10.00, cacheRead: 0.05 },
  // Haiku 4.5 was listed here at 0.80/4.00, which under-reported every Haiku
  // call by 25%. Corrected to the current list price.
  'claude-haiku-4-5-20251001': { input: 1.00,  output: 5.00 },
  'claude-haiku-4-5':          { input: 1.00,  output: 5.00 },
  // Haiku 5.5 is priced in two tiers by prompt size: 0.10/0.50 up to 100k
  // tokens and 0.50/2.50 above it. The usage report does not say which side
  // of that line a bucket fell on, so the higher tier is used — a bill read
  // as larger than it was is the safer error of the two.
  'claude-haiku-5-5':          { input: 0.50,  output: 2.50 },
  'claude-opus-5-5':           { input: 4.00,  output: 20.00, cacheRead: 0.05 },
  'claude-opus-5':             { input: 5.00,  output: 25.00 },
  'claude-opus-4-8':           { input: 5.00,  output: 25.00 },
  'claude-opus-4-7':           { input: 5.00,  output: 25.00 },
  'claude-opus-4-6':           { input: 5.00,  output: 25.00 },
  'claude-opus-4-5':           { input: 5.00,  output: 25.00 },
  'claude-fable-5-1':          { input: 10.00, output: 50.00, cacheRead: 0.025 },
  'claude-fable-5':            { input: 10.00, output: 50.00 },
};

// Models seen in a usage report or a call that this table does not price.
// Exposed so the Costs panel can say "these rows were priced at the default
// rate" rather than presenting a guess as a measurement.
const UNPRICED = new Set();

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_CACHE_READ = 0.10;
// A 5-minute cache write costs 1.25x base input across every model on the
// table above, and an hour's write 2x. OMI's own calls use the 5-minute
// cache, but the usage report also covers anything else on the key, so both
// are priced.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_1H_WRITE_MULTIPLIER = 2.00;

// The price row for a model, and whether it is a real one. A prefix match
// catches the dated ids Anthropic also accepts (claude-opus-5-20260514),
// which would otherwise all fall through to the default.
function priceForModel(model) {
  const id = String(model || '');
  if (CLAUDE_PRICES[id]) return { price: CLAUDE_PRICES[id], known: true };
  const prefix = Object.keys(CLAUDE_PRICES)
    .filter(k => id.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return { price: CLAUDE_PRICES[prefix], known: true };
  if (id) UNPRICED.add(id);
  return { price: CLAUDE_PRICES[DEFAULT_MODEL], known: false };
}

// Anthropic's server-side web_search tool is billed per search, on top of the
// tokens the results occupy. The researchers are search-heavy, so leaving this
// out of the cost log under-reports them badly — for a contact lookup the
// search fee is larger than the tokens.
const WEB_SEARCH_USD_PER_SEARCH = 0.01;

/**
 * Cost of the server-side searches a response performed, read off
 * usage.server_tool_use.web_search_requests. Zero when the response used no
 * search, so this is safe to add to every Claude cost.
 */
function webSearchCostFromUsage(usage) {
  const n = Number(usage?.server_tool_use?.web_search_requests || 0);
  return n > 0 ? n * WEB_SEARCH_USD_PER_SEARCH : 0;
}

/** Best-effort cost estimate from a Claude SDK response.usage payload. */
function claudeCostFromUsage(model, usage) {
  if (!usage) return 0;
  const { price } = priceForModel(model);
  const inTok = Number(usage.input_tokens || 0);
  const outTok = Number(usage.output_tokens || 0);
  const cacheRead = Number(usage.cache_read_input_tokens || 0);

  // Cache writes arrive in two shapes. A Messages response carries a flat
  // `cache_creation_input_tokens`; the admin usage report, and newer SDK
  // responses, carry `cache_creation: { ephemeral_5m_input_tokens,
  // ephemeral_1h_input_tokens }` and no flat field at all. Reading only the
  // flat one counted every cached write in the usage report as zero, which
  // is the whole cost of a long agent prompt.
  //
  // The two tiers are priced differently: a 5-minute write is 1.25x base
  // input, an hour's is 2x.
  const split = usage.cache_creation || null;
  const write5m = split
    ? Number(split.ephemeral_5m_input_tokens || 0)
    : Number(usage.cache_creation_input_tokens || 0);
  const write1h = split ? Number(split.ephemeral_1h_input_tokens || 0) : 0;

  // Cache reads are 0.1x base input on most models and cheaper on the newest
  // ones, so the multiplier comes off the price row. Regular input excludes
  // any already-counted cache pieces — Anthropic's input_tokens field
  // already nets these out per their docs.
  const inCost = (inTok / 1e6) * price.input;
  const writeCost = ((write5m / 1e6) * CACHE_WRITE_MULTIPLIER + (write1h / 1e6) * CACHE_1H_WRITE_MULTIPLIER) * price.input;
  const readCost = (cacheRead / 1e6) * price.input * (price.cacheRead ?? DEFAULT_CACHE_READ);
  const outCost = (outTok / 1e6) * price.output;
  return inCost + writeCost + readCost + outCost + webSearchCostFromUsage(usage);
}

/** Fire-and-forget insert. Never throws. */
function recordApiCost({ provider, feature, costUsd, clientId = null, meta = {} }) {
  if (!provider || !feature) return;
  const cost = Number(costUsd) || 0;
  pool.query(
    `INSERT INTO api_cost_events (provider, feature, cost_usd, client_id, meta)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [provider, feature, cost, clientId, JSON.stringify(meta || {})]
  ).catch((err) => {
    // Don't let a bad insert kill a real request. One-line log so a
    // misconfigured deployment is visible without flooding stderr.
    if (!recordApiCost._warned) {
      recordApiCost._warned = true;
      console.warn('[costLog] insert failed (will continue silently):', err.message);
    }
  });
}

/** Convenience helper for Claude SDK callers: pull usage off the response and log. */
function recordClaudeCost({ model, response, feature, clientId, meta }) {
  if (!feature) return;
  const usage = response?.usage || response?.message?.usage || null;
  const cost = claudeCostFromUsage(model, usage);
  recordApiCost({
    provider: 'anthropic',
    feature,
    costUsd: cost,
    clientId: clientId || null,
    meta: { model, ...usage, ...(meta || {}) },
  });
}

module.exports = {
  recordApiCost, recordClaudeCost, claudeCostFromUsage,
  webSearchCostFromUsage, CLAUDE_PRICES, WEB_SEARCH_USD_PER_SEARCH,
  priceForModel, UNPRICED,
};
