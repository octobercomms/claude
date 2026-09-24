// AI/API spend guardrails on top of api_cost_events (see costLog.js).
//
// Two jobs:
//   1. Alerting — a daily scheduler job emails ALERT_EMAIL when yesterday's
//      spend or month-to-date spend crosses a threshold, so a runaway feature
//      (e.g. press follow-ups on Opus) is caught in a day, not at month end.
//   2. An OPT-IN global hard cap — when AI_MONTHLY_HARD_CAP_USD is set,
//      callClaude refuses once month-to-date spend reaches it. Default off,
//      so nothing changes unless the operator opts in. A safety net, not the
//      primary control (the primary control is Settings → AI models
//      per-feature).
//   3. OPT-IN per-task caps (ai_task_budgets, migration 185). A task is a
//      named group of cost-log features with its own monthly allowance. A
//      task that reaches its cap stops; everything else keeps running, and
//      the task resumes by itself next month because spend is always
//      measured from date_trunc('month', now()). This is what stops one
//      background job from taking down every AI feature in OMI.
//
// Callers that spend on a background task must call assertUnderTaskCap()
// themselves, once per unit of work, BEFORE they bill anything. callClaude
// enforces the global cap for everything routed through it, but the media
// researchers call the Anthropic SDK directly (they need the web_search
// tool) and so are only covered where they ask to be.
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

// ---------------------------------------------------------------------------
// Per-task budgets (ai_task_budgets)
// ---------------------------------------------------------------------------

// The task rows, cached 30s so a per-item gate in a long research loop stays
// cheap. Cleared whenever Settings writes a budget.
let _tasksCache = { at: 0, rows: null };
const TASKS_TTL_MS = 30 * 1000;

async function listTaskBudgets({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && _tasksCache.rows && now - _tasksCache.at < TASKS_TTL_MS) return _tasksCache.rows;
  let rows = [];
  try {
    ({ rows } = await pool.query(
      `SELECT task, label, features, monthly_cap_usd::float AS monthly_cap_usd,
              enabled, note
         FROM ai_task_budgets ORDER BY label`
    ));
  } catch (err) {
    // Migration not run yet, or the DB is unreachable. No task budgets means
    // no task caps, which is the same as the pre-185 behaviour — never block
    // work over a missing table. Warn once, because a silent empty list makes
    // every cap in OMI a no-op and looks identical to "nothing configured".
    if (!listTaskBudgets._warned) {
      listTaskBudgets._warned = true;
      console.warn('[budget] task budgets unreadable, task caps are OFF:', err.message);
    }
    rows = [];
  }
  _tasksCache = { at: now, rows };
  return rows;
}
function clearTaskCache() { _tasksCache = { at: 0, rows: null }; }

async function getTaskBudget(task) {
  const rows = await listTaskBudgets();
  return rows.find(r => r.task === task) || null;
}

// Month-to-date spend across one task's features. Costs a query per call, so
// callers gate on assertUnderTaskCap (which caches) rather than this.
async function taskSpendUsd(task, { features = null } = {}) {
  const feats = features || (await getTaskBudget(task))?.features;
  if (!feats || !feats.length) return 0;
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(cost_usd), 0)::float AS total
       FROM api_cost_events
      WHERE feature = ANY($1::text[]) AND ts >= date_trunc('month', now())`,
    [feats]
  );
  return rows[0]?.total || 0;
}

// Month-to-date spend for every task in one query, for the Settings screen.
async function taskSpendSummary() {
  const tasks = await listTaskBudgets({ fresh: true });
  if (!tasks.length) return [];
  const { rows } = await pool.query(
    `SELECT feature, SUM(cost_usd)::float AS total
       FROM api_cost_events WHERE ts >= date_trunc('month', now())
      GROUP BY feature`
  );
  const byFeature = new Map(rows.map(r => [r.feature, r.total]));
  return tasks.map(t => {
    const spent = (t.features || []).reduce((sum, f) => sum + (byFeature.get(f) || 0), 0);
    return {
      ...t,
      spent_usd: spent,
      remaining_usd: t.monthly_cap_usd == null ? null : Math.max(0, t.monthly_cap_usd - spent),
      blocked: !t.enabled || (t.monthly_cap_usd != null && spent >= t.monthly_cap_usd),
    };
  });
}

// Per-task spend cache. Keyed by task, 30s, same reasoning as the global MTD
// cache: a cap is a backstop, so overshooting by a minute of spend is fine
// and re-querying per contact in a 5,000-contact sweep is not.
const _taskSpendCache = new Map();
const TASK_SPEND_TTL_MS = 30 * 1000;

/**
 * Throw if `task` is paused, or its monthly cap is set and month-to-date
 * spend across its features has reached it. No-op when the task has no row,
 * no cap, or the table is missing — an unconfigured task runs as it did
 * before, so adding a call site never changes behaviour on its own.
 *
 * Call this once per unit of work (per outlet, per contact), before billing.
 */
async function assertUnderTaskCap(task) {
  const budget = await getTaskBudget(task);
  if (!budget) return;
  if (!budget.enabled) {
    const err = new Error(
      `"${budget.label}" is paused in Settings → AI models → Task budgets. ` +
      `Re-enable it there to resume.`
    );
    err.code = 'AI_TASK_PAUSED';
    err.status = 429;
    err.task = task;
    throw err;
  }
  if (budget.monthly_cap_usd == null) return;
  const now = Date.now();
  const hit = _taskSpendCache.get(task);
  let spent;
  if (hit && now - hit.at < TASK_SPEND_TTL_MS) spent = hit.total;
  else {
    spent = await taskSpendUsd(task, { features: budget.features });
    _taskSpendCache.set(task, { at: now, total: spent });
  }
  if (spent >= budget.monthly_cap_usd) {
    const err = new Error(
      `"${budget.label}" has used its monthly budget: $${spent.toFixed(2)} of ` +
      `$${budget.monthly_cap_usd.toFixed(2)}. It resumes automatically when the ` +
      `month rolls over, or sooner if you raise the budget in Settings → AI models.`
    );
    err.code = 'AI_TASK_BUDGET_CAP';
    err.status = 429;
    err.task = task;
    err.spent_usd = spent;
    err.cap_usd = budget.monthly_cap_usd;
    throw err;
  }
}

/** True when the caller should stop looping, without throwing. */
async function taskCapReached(task) {
  try { await assertUnderTaskCap(task); return false; }
  catch (err) {
    if (err.code === 'AI_TASK_BUDGET_CAP' || err.code === 'AI_TASK_PAUSED') return true;
    throw err;
  }
}

/**
 * Note that a task just spent money, so the next gate inside the cache window
 * sees it. Without this a tight loop bills 30 seconds of work past the cap
 * before the cached total catches up — fine for a handful of calls, not for a
 * sweep that does one contact a second.
 */
function noteTaskSpend(task, costUsd) {
  const hit = _taskSpendCache.get(task);
  if (hit) hit.total += Number(costUsd) || 0;
}
function clearTaskSpendCache() { _taskSpendCache.clear(); }

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
  listTaskBudgets, getTaskBudget, taskSpendUsd, taskSpendSummary,
  assertUnderTaskCap, taskCapReached, noteTaskSpend,
  clearTaskCache, clearTaskSpendCache,
};
