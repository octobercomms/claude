// Text embeddings for semantic journalist matching. Reuses the platform's
// existing OpenAI key (already configured for Whisper) — text-embedding-3-small
// at 512 dims: cheap, and small enough to score in-process without pgvector.
//
// Vectors are unit-normalised at write time, so cosine similarity is just a dot
// product. Everything degrades gracefully: if no key is configured, available()
// is false and the matcher falls back to keyword ranking — nothing breaks.

const axios = require('axios');
const { getSetting } = require('../utils/settings');
let costLog; try { costLog = require('./costLog'); } catch { costLog = null; }

const MODEL = 'text-embedding-3-small';
const DIMS = 512;
const PRICE_PER_1K = 0.00002; // $/1K tokens (text-embedding-3-small), approx

async function getKey() {
  return process.env.OPENAI_API_KEY || await getSetting('OPENAI_API_KEY') || null;
}
async function available() { return !!(await getKey()); }

function normalise(vec) {
  let n = 0;
  for (const x of vec) n += x * x;
  n = Math.sqrt(n) || 1;
  return vec.map((x) => x / n);
}

// Embed up to ~2048 short texts in one call. Returns array of unit vectors
// aligned to the input order. Throws a clear error if unconfigured.
async function embed(texts) {
  const list = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t || '').slice(0, 8000));
  if (!list.length) return [];
  const key = await getKey();
  if (!key) throw new Error('Embeddings not configured — add an OpenAI API key in Settings.');
  const { data } = await axios.post(
    'https://api.openai.com/v1/embeddings',
    { model: MODEL, input: list, dimensions: DIMS },
    { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 60000 }
  );
  if (costLog?.recordApiCost) {
    try { costLog.recordApiCost({ provider: 'openai', feature: 'press_match_embed', costUsd: ((data.usage?.total_tokens || 0) / 1000) * PRICE_PER_1K, meta: { model: MODEL } }); } catch { /* best effort */ }
  }
  return (data.data || []).sort((a, b) => a.index - b.index).map((d) => normalise(d.embedding));
}

// One journalist's profile string — what they write about, from every lane.
function profileText(c) {
  const parts = [];
  const push = (v) => { if (Array.isArray(v)) parts.push(...v); else if (v) parts.push(v); };
  push(c.beats); push(c.topics); push(c.auto_topics);
  if (c.enrichment_note) parts.push(c.enrichment_note);
  if (c.recent_titles) parts.push(c.recent_titles);
  return [...new Set(parts.map((s) => String(s).trim()).filter(Boolean))].join('. ').slice(0, 4000);
}

module.exports = { MODEL, DIMS, available, embed, profileText, normalise };
