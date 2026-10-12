/**
 * Pangram AI detection, called on demand and never on its own.
 *
 * Why this exists at all, written down because it is easy to forget: October's
 * own checker reads the visible tells and the specificity. Pangram maps text
 * into a style space learned from paired human and AI writing. The two measure
 * different things, and a real release scored 94 here and 82% AI there. Until
 * the bench says whether the two numbers move together, this is the ground
 * truth and ours is the guess.
 *
 * Three rules, each from a standing instruction:
 *
 *   1. Never automatic. One call per button press. Nothing fires on save, on
 *      typing, or from a scheduler.
 *   2. Capped. It bills per 100 words, so it goes through the same per-task
 *      budget as the Claude features and refuses once the month's allowance is
 *      spent.
 *   3. Never re-bills for text it has already seen. The caller compares a hash
 *      of the body and serves the stored result when it matches.
 */
const crypto = require('crypto');
const budget = require('./budget');
const { recordApiCost } = require('./costLog');
const { getSetting } = require('../utils/settings');

const TASK = 'detector_check';
const FEATURE = 'pangram_detect';

// $0.05 per 100 words, from Pangram's own developer API pricing. Used to show
// the operator the price BEFORE the call, and to log what was spent after it.
const USD_PER_100_WORDS = 0.05;

function wordCount(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

/** What a check would cost, so the button says the price before it is pressed. */
function estimateUsd(text) {
  return +((wordCount(text) / 100) * USD_PER_100_WORDS).toFixed(4);
}

/** A stable fingerprint of the text, so unchanged text is never re-billed. */
function fingerprint(text) {
  return crypto.createHash('sha256').update(String(text || '').trim()).digest('hex');
}

async function apiKey() {
  return process.env.PANGRAM_API_KEY || (await getSetting('pangram_api_key')) || '';
}

async function configured() {
  return !!(await apiKey());
}

/**
 * Run one check. Throws when unconfigured, capped, or the API refuses, because
 * a detector that silently returns nothing is worse than one that is plainly
 * switched off: a silent skip reads as "nothing to report".
 */
async function detect(text) {
  const key = await apiKey();
  if (!key) {
    const err = new Error(
      'No Pangram API key. Add PANGRAM_API_KEY to the server environment, or set it in Settings → Integrations.'
    );
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

  const endpoint = process.env.PANGRAM_API_URL || 'https://text.api.pangramlabs.com/';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ text: String(text) }),
  });
  const raw = await res.text();
  if (!res.ok) {
    const err = new Error(`Pangram returned ${res.status}: ${raw.slice(0, 300)}`);
    err.status = res.status === 401 || res.status === 403 ? 400 : 502;
    throw err;
  }
  let body;
  try { body = JSON.parse(raw); } catch {
    const err = new Error(`Pangram returned something that is not JSON: ${raw.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }

  const costUsd = estimateUsd(text);
  // Logged against the same cost table as everything else, so the monthly
  // figure in Settings stays the whole truth rather than the Claude part of it.
  try {
    await recordApiCost({ provider: 'pangram', feature: FEATURE, costUsd, meta: { words } });
  } catch (err) {
    console.error('[pangram] cost log failed:', err.message);
  }

  return { pct: readPercentage(body), words, cost_usd: costUsd, raw: body };
}

/**
 * Pull the AI percentage out of whatever shape the response has.
 *
 * Written defensively on purpose: this environment cannot reach pangram.com, so
 * the field names below are the documented ones and have NOT been seen against
 * a live response. Every candidate is tried and the raw body is stored whole,
 * so a wrong guess here costs a display value and never the data.
 */
function readPercentage(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [
    body.ai_likelihood, body.aiLikelihood, body.likelihood,
    body.ai_probability, body.prediction_score, body.score,
    body.fraction_ai_content, body.ai_fraction,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n <= 1 ? +(n * 100).toFixed(2) : +n.toFixed(2);
  }
  return null;
}

module.exports = { detect, estimateUsd, fingerprint, configured, wordCount, USD_PER_100_WORDS };
