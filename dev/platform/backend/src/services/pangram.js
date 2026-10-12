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

/**
 * The key, from Settings → Keys first and the environment second.
 *
 * getSetting() reads the encrypted platform_settings row and falls back to
 * process.env for the SAME name, so the setting has to be spelled exactly as
 * the Settings page writes it. An earlier version asked for 'pangram_api_key'
 * in lower case, which meant a key typed into Settings was stored, encrypted,
 * and then never read by anything.
 *
 * Read per call rather than cached, so saving the key in Settings takes effect
 * on the next press instead of on the next deploy.
 */
async function apiKey() {
  return (await getSetting('PANGRAM_API_KEY')) || '';
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
      'No Pangram API key. Add it in Settings → Keys → Outreach finders → AI detection (Pangram).'
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

  return { pct: readPercentage(body), segments: readSegments(body), words, cost_usd: costUsd, raw: body };
}

/**
 * Pull the AI percentage out of whatever shape the response has.
 *
 * Written defensively on purpose: this was built in an environment that cannot
 * reach pangram.com, so the field names below come from the published pricing
 * and product pages and have NOT been seen against a live response. Every
 * candidate is tried, nested containers are searched, and the raw body is
 * stored whole, so a wrong guess costs a display value and never the data.
 *
 * A value at or below 1 is read as a fraction and scaled; above 1 it is already
 * a percentage. That rule breaks for a genuine 1% reading, which would show as
 * 100%. The ambiguity is unavoidable without the documentation, and it fails in
 * the direction that gets noticed rather than the one that quietly reassures.
 */
const PCT_FIELDS = [
  'ai_likelihood', 'aiLikelihood', 'fraction_ai_content', 'fractionAiContent',
  'ai_fraction', 'max_ai_likelihood', 'avg_ai_likelihood', 'ai_probability',
  'prediction_score', 'likelihood', 'score', 'ai_percentage', 'percent_ai',
];

/** The containers a provider might nest its payload inside. */
function unwrap(body) {
  const out = [body];
  for (const k of ['result', 'results', 'data', 'prediction', 'response', 'document']) {
    const v = body?.[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v);
  }
  return out;
}

function readPercentage(body) {
  if (!body || typeof body !== 'object') return null;
  for (const scope of unwrap(body)) {
    for (const field of PCT_FIELDS) {
      const n = Number(scope?.[field]);
      if (Number.isFinite(n)) return n <= 1 ? +(n * 100).toFixed(2) : +n.toFixed(2);
    }
  }
  return null;
}

/**
 * Any per-sentence or per-window scores the response carries.
 *
 * Pangram's own interface highlights sentence by sentence. Whether that reaches
 * the API is unknown from here, so this looks for it and stores whatever it
 * finds rather than making the operator pay for a second call later. If the
 * array is there, the editor gets a fourth highlight layer and the writer sees
 * which sentences to rewrite instead of inferring it from one number.
 */
function readSegments(body) {
  if (!body || typeof body !== 'object') return null;
  for (const scope of unwrap(body)) {
    for (const key of ['windows', 'sentences', 'fragments', 'segments', 'spans', 'chunks']) {
      const arr = scope?.[key];
      if (!Array.isArray(arr) || !arr.length) continue;
      const mapped = arr
        .map((seg) => {
          if (!seg || typeof seg !== 'object') return null;
          const text = seg.text || seg.sentence || seg.content || seg.window || null;
          let score = null;
          for (const f of PCT_FIELDS) {
            const n = Number(seg[f]);
            if (Number.isFinite(n)) { score = n <= 1 ? +(n * 100).toFixed(2) : +n.toFixed(2); break; }
          }
          return text ? { text: String(text), score } : null;
        })
        .filter(Boolean);
      if (mapped.length) return { key, items: mapped };
    }
  }
  return null;
}

module.exports = {
  detect, estimateUsd, fingerprint, configured, wordCount,
  readPercentage, readSegments, USD_PER_100_WORDS,
};
