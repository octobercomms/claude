// Competitor Google Ads intelligence. Pulls a competitor's live ads from the
// Google Ads Transparency Center via SerpApi (the only reliable, maintainable
// route — Google has no official API), then has Claude read what angles/offers
// they're testing, what's been running longest (= working), and how to counter.
// Inert until SERPAPI_API_KEY is set. See migration 103.

const axios = require('axios');
const pool = require('../db');
const { getSetting } = require('../utils/settings');
const claudeService = require('./claude');

// SerpApi's Ads Transparency engine takes a numeric Google region code. Map the
// common ones; fall back to whatever was passed (lets power users give a code).
const REGION_CODES = {
  GB: '2826', UK: '2826', US: '2840', IE: '2372', AU: '2036', CA: '2124',
  NZ: '2554', FR: '2250', DE: '2276', ES: '2724', IT: '2380', NL: '2528',
};

function badReq(msg) { const e = new Error(msg); e.status = 400; return e; }

async function isConfigured() {
  return !!(await getSetting('SERPAPI_API_KEY'));
}

function normalizeCreative(c) {
  return {
    advertiser: c.advertiser || c.advertiser_name || null,
    format: c.format || null,                        // text | image | video
    target_domain: c.target_domain || c.link || null,
    first_shown: c.first_shown || null,
    last_shown: c.last_shown || null,
    image: c.image || c.thumbnail || null,
    details_link: c.details_link || c.link || null,
    // text ads / headlines where SerpApi provides them
    text: c.text || c.title || c.body || null,
  };
}

// Pull a competitor's live ads. `query` is an advertiser name or domain.
async function fetchAds({ query, region = 'GB' }) {
  const q = String(query || '').trim();
  if (!q) throw badReq('Enter a competitor advertiser name or domain.');
  const key = await getSetting('SERPAPI_API_KEY');
  if (!key) throw badReq('Add a SerpApi key in Settings → Integrations to pull competitor ads.');

  const regionCode = REGION_CODES[String(region).toUpperCase()] || region;
  const { data } = await axios.get('https://serpapi.com/search.json', {
    params: { engine: 'google_ads_transparency_center', text: q, region: regionCode, api_key: key },
    timeout: 30000,
    validateStatus: () => true,
  });
  if (data?.error) throw new Error(`SerpApi: ${data.error}`);
  const creatives = data?.ad_creatives || data?.ads || [];
  return creatives.slice(0, 40).map(normalizeCreative).filter(c => c.advertiser || c.target_domain || c.text);
}

const SYSTEM =
  'You are a paid-media strategist analysing a competitor\'s live Google ads (from the Ads Transparency Center). ' +
  'Infer the angles, offers and formats they\'re testing; ads that have run longest are likely their winners. ' +
  'Be specific and commercial. British English. JSON only — no prose, no fences.';

function parseJson(raw) {
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error('Ad analysis returned malformed JSON.'); }
}

async function analyse(clientId, query, ads) {
  if (!ads.length) return { overview: 'No ads found for that advertiser/region.', longest_running: [], angles: [], counter_ideas: [] };
  const raw = await claudeService.callClaude({
    max_tokens: 2200,
    system: SYSTEM,
    user: `Competitor: ${query}
Their live Google ads (most-recent first; first_shown/last_shown show run length):
"""
${JSON.stringify(ads).slice(0, 13000)}
"""

Analyse them. Return ONLY:
{"overview":"2–3 sentences on what they're doing in paid",
 "longest_running":["the ads/angles that have run longest (their likely winners), with why"],
 "angles":["the distinct angles/offers/hooks they're testing"],
 "counter_ideas":["3–5 specific ad ideas we could run to compete / differentiate"]}`,
    feature: 'competitor_ads',
    clientId,
  });
  const out = parseJson(raw);
  return {
    overview: out.overview || null,
    longest_running: Array.isArray(out.longest_running) ? out.longest_running.slice(0, 8) : [],
    angles: Array.isArray(out.angles) ? out.angles.slice(0, 10) : [],
    counter_ideas: Array.isArray(out.counter_ideas) ? out.counter_ideas.slice(0, 8) : [],
  };
}

async function run(clientId, { query, region = 'GB' }) {
  const ads = await fetchAds({ query, region });
  const analysis = await analyse(clientId, query, ads);
  const { rows } = await pool.query(
    `INSERT INTO competitor_ad_runs (client_id, query, region, ads, analysis, ad_count)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [clientId, String(query).trim(), region, JSON.stringify(ads), JSON.stringify(analysis), ads.length]
  );
  return rows[0];
}

async function listRuns(clientId, limit = 20) {
  const { rows } = await pool.query(
    'SELECT * FROM competitor_ad_runs WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2',
    [clientId, limit]
  );
  return rows;
}

async function deleteRun(clientId, id) {
  await pool.query('DELETE FROM competitor_ad_runs WHERE id = $1 AND client_id = $2', [id, clientId]);
}

module.exports = { isConfigured, run, listRuns, deleteRun };
