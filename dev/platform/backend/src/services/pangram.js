/**
 * Pangram AI detection, against the documented REST API.
 *
 * Rewritten after the first live calls went to text.api.pangramlabs.com, a
 * legacy host that answers with a different and much weaker shape: it returned
 * ai_likelihood 0.0015 and "Unlikely AI" for a press release written entirely
 * by a model, while pangram.com's own dashboard scored the same text 87% AI.
 * That was never a parsing bug and never an inverted field. It was the wrong
 * API.
 *
 * The real one (docs.pangram.com):
 *
 *   GET  /models            the selectors this key may use. Free, and the only
 *                           honest way to prove the base URL and key are right
 *                           before spending anything.
 *   POST /task              submit text, get a task id back
 *   GET  /task/{id}         poll until stage is STAGE_SUCCESS or STAGE_FAILED
 *
 * The completed task carries fraction_ai / fraction_ai_assisted /
 * fraction_human, a headline ("AI Detected" / "Human Written"), and `windows`:
 * per-segment labels with character offsets, confidence, and the humanizer
 * score. fraction_ai is the figure the dashboard shows as "% of this text is
 * AI", and the windows are what it highlights.
 *
 * Three rules carried over unchanged, each from a standing instruction:
 * never automatic, always capped, and never re-billed for unchanged text.
 */
const crypto = require('crypto');
const budget = require('./budget');
const { recordApiCost } = require('./costLog');
const { getSetting } = require('../utils/settings');

const TASK = 'detector_check';
const FEATURE = 'pangram_detect';

// $0.05 per 100 words, from the developer pricing page.
const USD_PER_100_WORDS = 0.05;

// The docs give the file-upload host as file-external.api.pangram.com and the
// detection host in a code block that did not survive the PDF. This is the
// parallel name, and GET /models proves or disproves it for nothing — which is
// why that probe exists rather than another guess.
const DEFAULT_BASE = 'https://text-external.api.pangram.com';

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;

function wordCount(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

/** What a check would cost, so the button can say the price before it is pressed. */
function estimateUsd(text) {
  return +((wordCount(text) / 100) * USD_PER_100_WORDS).toFixed(4);
}

/** A stable fingerprint of the text, so unchanged text is never re-billed. */
function fingerprint(text) {
  return crypto.createHash('sha256').update(String(text || '').trim()).digest('hex');
}

async function apiKey() {
  return (await getSetting('PANGRAM_API_KEY')) || '';
}

async function baseUrl() {
  return ((await getSetting('PANGRAM_API_URL')) || DEFAULT_BASE).replace(/\/+$/, '');
}

async function configured() {
  return !!(await apiKey());
}

/** The documented status codes, turned into something an operator can act on. */
function describeStatus(status, body) {
  switch (status) {
    case 400: return 'Pangram rejected the request body.';
    case 401: return 'Pangram rejected the API key. Check it in Settings → Keys.';
    case 402: return 'The Pangram account is out of credits. Top it up at pangram.com.';
    case 403: return 'That Pangram model is not enabled for this key, or the key does not own this task.';
    case 404: return 'Pangram has no such task. The endpoint may be wrong — run the connection test.';
    case 413: return 'The request is over Pangram’s size limit.';
    case 422: return 'Pangram could not process that text or model selector.';
    case 429: return 'Pangram rate limit reached. Wait a moment and try again.';
    case 503: return 'That Pangram model is temporarily unavailable.';
    default: return `Pangram returned ${status}: ${String(body).slice(0, 200)}`;
  }
}

async function call(path, { method = 'GET', body, key, base } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'x-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text();
  if (!res.ok) {
    const err = new Error(describeStatus(res.status, raw));
    err.status = res.status >= 500 ? 502 : 400;
    err.upstream = res.status;
    throw err;
  }
  try { return JSON.parse(raw); } catch {
    const err = new Error(`Pangram sent something that is not JSON: ${raw.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }
}

/**
 * The selectors this key may use.
 *
 * Free, so it doubles as the connection test: a 200 here proves the base URL,
 * the key and the account are all good before a single billable word is sent.
 * The docs are explicit that the catalog varies by account and must not be
 * hard-coded.
 */
async function models() {
  const key = await apiKey();
  if (!key) {
    const err = new Error('No Pangram API key. Add it in Settings → Keys → Outreach finders.');
    err.code = 'PANGRAM_NOT_CONFIGURED';
    err.status = 400;
    throw err;
  }
  const base = await baseUrl();
  const body = await call('/models', { key, base });
  const list = Array.isArray(body) ? body
    : Array.isArray(body?.models) ? body.models
      : Array.isArray(body?.data) ? body.data : [];
  return {
    base,
    models: list.map((m) => (typeof m === 'string' ? m : m?.selector || m?.id || m?.name)).filter(Boolean),
    raw: body,
  };
}

/** The authorship breakdown, read from the documented fields. */
function readResult(body) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const fracAi = num(body?.fraction_ai);
  const fracAssisted = num(body?.fraction_ai_assisted);
  const fracHuman = num(body?.fraction_human);
  return {
    // The figure the dashboard shows as "% of this text is AI".
    pct: fracAi == null ? null : +(fracAi * 100).toFixed(2),
    pct_assisted: fracAssisted == null ? null : +(fracAssisted * 100).toFixed(2),
    pct_human: fracHuman == null ? null : +(fracHuman * 100).toFixed(2),
    headline: body?.headline || null,
    verdict: body?.prediction || null,
    verdict_short: body?.prediction_short || null,
    version: body?.version || null,
    segments_ai: num(body?.num_ai_segments),
    segments_assisted: num(body?.num_ai_assisted_segments),
    segments_human: num(body?.num_human_segments),
    // Character offsets, so these can be painted straight onto the document.
    windows: Array.isArray(body?.windows) ? body.windows.map((w) => ({
      text: w?.text ?? '',
      label: w?.label ?? null,
      confidence: w?.confidence ?? null,
      ai_assistance_score: num(w?.ai_assistance_score),
      start_index: num(w?.start_index),
      end_index: num(w?.end_index),
      word_count: num(w?.word_count),
      is_humanized: !!w?.is_humanized,
      humanizer_score: num(w?.humanizer_score),
    })) : [],
    dashboard_url: body?.public_dashboard_link || body?.dashboard_link || null,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run one detection: submit, then poll to the terminal stage.
 *
 * Throws when unconfigured, capped, or refused, because a detector that
 * silently returns nothing is worse than one that is plainly switched off.
 */
async function detect(text, opts = {}) {
  const key = await apiKey();
  if (!key) {
    const err = new Error('No Pangram API key. Add it in Settings → Keys → Outreach finders.');
    err.code = 'PANGRAM_NOT_CONFIGURED';
    err.status = 400;
    throw err;
  }
  const words = wordCount(text);
  if (!words) {
    const err = new Error('Nothing to check.');
    err.status = 400;
    throw err;
  }
  // Gate BEFORE billing, per the budget service's contract.
  await budget.assertUnderTaskCap(TASK);

  const base = await baseUrl();
  // The docs ask new integrations to send a selector explicitly, so the first
  // one the account is entitled to is used unless the caller names another.
  let model = opts.model || null;
  if (!model) {
    try { model = (await models()).models[0] || null; } catch { model = null; }
  }

  const submitted = await call('/task', {
    method: 'POST', key, base,
    body: { text: String(text), ...(model ? { model } : {}), public_dashboard_link: true },
  });
  const taskId = submitted?.task_id || submitted?.id || submitted?.taskId;
  if (!taskId) {
    const err = new Error(`Pangram accepted the text but returned no task id: ${JSON.stringify(submitted).slice(0, 200)}`);
    err.status = 502;
    throw err;
  }

  const until = Date.now() + POLL_TIMEOUT_MS;
  let body;
  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    body = await call(`/task/${encodeURIComponent(taskId)}`, { key, base });
    const stage = body?.stage;
    if (stage === 'STAGE_SUCCESS') break;
    if (stage === 'STAGE_FAILED') {
      const err = new Error('Pangram could not analyse that text.');
      err.status = 502;
      throw err;
    }
    if (Date.now() > until) {
      const err = new Error(`Pangram is still working after ${POLL_TIMEOUT_MS / 1000}s. Nothing is lost; try again shortly.`);
      err.status = 504;
      throw err;
    }
  }

  const costUsd = estimateUsd(text);
  try {
    await recordApiCost({ provider: 'pangram', feature: FEATURE, costUsd, meta: { words, model, task_id: taskId } });
  } catch (err) {
    console.error('[pangram] cost log failed:', err.message);
  }

  return { ...readResult(body), words, cost_usd: costUsd, task_id: taskId, model, raw: body };
}

module.exports = {
  detect, models, estimateUsd, fingerprint, configured, wordCount,
  readResult, describeStatus, USD_PER_100_WORDS, DEFAULT_BASE,
};
