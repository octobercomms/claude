// AI/API spend guardrails on top of api_cost_events (see costLog.js).
//
// Two jobs:
//   1. Alerting — a daily scheduler job emails ALERT_EMAIL when yesterday's
//      spend or month-to-date spend crosses a threshold, so a runaway feature
//      (e.g. press follow-ups on Opus) is caught in a day, not at month end.
//   2. An OPT-IN hard cap — when AI_MONTHLY_HARD_CAP_USD is set, callClaude
//      refuses once month-to-date spend reaches it. Default off, so nothing
//      changes unless the operator opts in. A safety net, not the primary
//      control (the primary control is Settings → AI models per-feature).
//
// The month-to-date total is cached for 60s so the cap check can gate every
// callClaude cheaply; the cap may therefore overshoot by up to ~a minute of
// spend, which is fine for a backstop.

const pool = require('../db');

let _mtdCache = { at: 0, total: 0 };
const MTD_TTL_MS = 60 * 1000;

async function monthlySpendUsd({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && now - _mtdCache.at < MTD_TTL_MS) return _mtdCache.total;
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(cost_usd), 0)::float AS total
       FROM api_cost_events WHERE ts >= date_trunc('month', now())`
  );
  _mtdCache = { at: now, total: rows[0]?.total || 0 };
  return _mtdCache.total;
}

// Total spend for a single calendar day, dayOffset days ago (0 = today so far,
// 1 = all of yesterday).
async function dailySpendUsd(dayOffset = 0) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(cost_usd), 0)::float AS total
       FROM api_cost_events
      WHERE ts >= date_trunc('day', now()) - ($1::int || ' days')::interval
        AND ts <  date_trunc('day', now()) - (($1::int - 1) || ' days')::interval`,
    [dayOffset]
  );
  return rows[0]?.total || 0;
}

// Top features by spend over the last `days`, for the alert email body.
async function topFeatures({ days = 1, limit = 6 } = {}) {
  const { rows } = await pool.query(
    `SELECT provider, feature, SUM(cost_usd)::float AS cost_usd, COUNT(*)::int AS calls
       FROM api_cost_events
      WHERE ts >= NOW() - ($1::int || ' days')::interval
      GROUP BY provider, feature ORDER BY cost_usd DESC LIMIT $2`,
    [days, limit]
  );
  return rows;
}

// The monthly hard cap, from the Settings 'AI_MONTHLY_HARD_CAP_USD' value
// (getSetting falls back to the env var of the same name). null = no cap.
// Cached 30s so the per-call gate stays cheap.
let _capCache = { at: 0, cap: undefined };
const CAP_TTL_MS = 30 * 1000;
async function hardCapUsd() {
  const now = Date.now();
  if (_capCache.cap !== undefined && now - _capCache.at < CAP_TTL_MS) return _capCache.cap;
  let raw = null;
  try { raw = await require('../utils/settings').getSetting('AI_MONTHLY_HARD_CAP_USD'); }
  catch { /* fall back to env below */ }
  const v = parseFloat(raw != null ? raw : (process.env.AI_MONTHLY_HARD_CAP_USD || ''));
  const cap = Number.isFinite(v) && v > 0 ? v : null;
  _capCache = { at: now, cap };
  return cap;
}
function clearCapCache() { _capCache = { at: 0, cap: undefined }; }

// Recent average actual cost per call for a feature — the basis for a pre-spend
// estimate. null when there's no billing history yet.
async function avgFeatureCostUsd(feature, { days = 30 } = {}) {
  const { rows } = await pool.query(
    `SELECT AVG(cost_usd)::float AS avg
       FROM api_cost_events
      WHERE feature = $1 AND cost_usd > 0
        AND ts >= NOW() - ($2::int || ' days')::interval`,
    [feature, days]
  );
  return rows[0]?.avg || null;
}

// Estimate the AI cost of sending a press release to `newRecipients` NEW people:
// one personalised pitch each (the dominant cost — follow-ups are now generated
// lazily, only for opens, and run on the cheaper model). Uses the recent average
// actual pitch cost, falling back to an Opus-price estimate with no history.
const FALLBACK_PITCH_USD = 0.033;
async function estimatePressSendUsd(newRecipients) {
  const n = Math.max(0, Number(newRecipients) || 0);
  const avg = await avgFeatureCostUsd('press_pitch');
  const perPitch = (avg && avg > 0) ? avg : FALLBACK_PITCH_USD;
  return {
    new_recipients: n,
    per_pitch_usd: perPitch,
    est_usd: n * perPitch,
    basis: avg ? 'recent-average' : 'estimate',
  };
}

// Throw if the opt-in monthly hard cap is set and month-to-date spend has
// reached it. Cheap (cached) so callClaude can call it on every request.
async function assertUnderHardCap() {
  const cap = await hardCapUsd();
  if (!cap) return;
  const spent = await monthlySpendUsd();
  if (spent >= cap) {
    const err = new Error(
      `AI monthly budget reached: $${spent.toFixed(2)} of the $${cap.toFixed(2)} cap ` +
      `(AI_MONTHLY_HARD_CAP_USD). AI features are paused until the cap is raised or the month rolls over.`
    );
    err.code = 'AI_BUDGET_CAP';
    err.status = 429;
    throw err;
  }
}

module.exports = {
  monthlySpendUsd, dailySpendUsd, topFeatures, hardCapUsd, clearCapCache,
  avgFeatureCostUsd, estimatePressSendUsd, assertUnderHardCap,
};
