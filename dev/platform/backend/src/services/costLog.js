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

// Claude model pricing in USD per million tokens. Cache discount applied
// when the response.usage includes cache_read_input_tokens.
// Source: https://www.anthropic.com/pricing (public list prices).
const CLAUDE_PRICES = {
  // Sonnet 4.6 is the platform default.
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00 },
  'claude-sonnet-4-5':         { input: 3.00, output: 15.00 },
  'claude-sonnet-5':           { input: 2.00, output: 10.00 },
  // Haiku 4.5 was listed here at 0.80/4.00, which under-reported every Haiku
  // call by 25%. Corrected to the current list price.
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
  'claude-haiku-4-5':          { input: 1.00, output: 5.00 },
  'claude-opus-5':             { input: 15.00, output: 75.00 },
  'claude-opus-4-8':           { input: 15.00, output: 75.00 },
  'claude-opus-4-7':           { input: 15.00, output: 75.00 },
  'claude-fable-5':            { input: 3.00, output: 15.00 },
};

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
  const price = CLAUDE_PRICES[model] || CLAUDE_PRICES['claude-sonnet-4-6'];
  const inTok = Number(usage.input_tokens || 0);
  const outTok = Number(usage.output_tokens || 0);
  const cacheWrite = Number(usage.cache_creation_input_tokens || 0);
  const cacheRead = Number(usage.cache_read_input_tokens || 0);
  // Cache writes cost 1.25x normal input; cache reads cost 0.1x (10%).
  // Regular input excludes any already-counted cache pieces — Anthropic's
  // input_tokens field already nets these out per their docs.
  const inCost = (inTok / 1e6) * price.input;
  const writeCost = (cacheWrite / 1e6) * price.input * 1.25;
  const readCost = (cacheRead / 1e6) * price.input * 0.10;
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
};
