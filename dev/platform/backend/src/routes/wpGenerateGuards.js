// Pure guard logic for the WordPress-plugin managed-key proxy
// (POST /api/wp-connect/generate). Split out from wpConnect.js so the
// security-critical checks — connector status gate, model allow-list, and the
// per-client burst limiter — can be unit-tested without a DB or HTTP.
// See wpGenerateGuards.test.js.

// Only these models may be proxied — never pass a client-supplied model
// straight through to Anthropic. Overridable via WP_PLUGIN_MODELS
// (comma-separated) so a new model can be allowed without a code change.
const ALLOWED_MODELS = (process.env.WP_PLUGIN_MODELS ||
  'claude-haiku-4-5-20251001,claude-sonnet-5,claude-opus-5')
  .split(',').map(s => s.trim()).filter(Boolean);

// Non-DB request checks, in the order the plugin's error contract expects.
// Returns { code, message }; code 200 means "proceed to the cost-cap check".
//   403 — connector revoked/inactive, or a model that isn't allow-listed
//   400 — malformed request (no messages)
function assessGenerate({ connectorStatus, model, messages }) {
  if (connectorStatus && connectorStatus !== 'active') {
    return { code: 403, message: 'Connection revoked.' };
  }
  if (!ALLOWED_MODELS.includes(String(model || ''))) {
    return { code: 403, message: 'Model not permitted.' };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { code: 400, message: 'Missing messages.' };
  }
  return { code: 200, message: 'ok' };
}

// Fixed-window in-memory burst limiter, keyed per client. A safety net on top
// of the router-wide rate limit. `now` is injectable for deterministic tests.
function makeBurstLimiter({ max = 20, windowMs = 60_000 } = {}) {
  const hits = new Map();
  return function allow(key, now = Date.now()) {
    const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

module.exports = { ALLOWED_MODELS, assessGenerate, makeBurstLimiter };
