const axios = require('axios');
const { getSetting } = require('../utils/settings');

// Aggregators, social and directories — excluded from business results.
const SKIP_DOMAINS = [
  'google.', 'google.com', 'facebook.com', 'linkedin.com', 'instagram.com',
  'twitter.com', 'x.com', 'youtube.com', 'tiktok.com',
  'yelp.com', 'yellowpages.com', 'houzz.com', 'trulia.com', 'zillow.com',
  'archdaily.com', 'dezeen.com', 'architecturaldigest.com', 'dwell.com',
  'wikipedia.org', 'wikimedia.org',
  'indeed.com', 'seek.com.au', 'glassdoor.com',
  'amazon.com', 'amazon.com.au', 'ebay.com',
  'truelocal.com.au', 'localsearch.com.au',
  'architectureau.com', 'architectureandesign.com.au',
  'archello.com', 'architizer.com', 'arch2o.com',
  'homestars.com', 'angi.com', 'thumbtack.com',
  'homeadvisor.com', 'builderscrack.co.nz',
];

function extractDomain(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isSkippable(domain) {
  return SKIP_DOMAINS.some(skip =>
    domain === skip || domain.endsWith('.' + skip) || domain.includes(skip)
  );
}

// Per-search pricing on Serper's standard plan is $0.001 — small enough that
// individual calls don't matter but a scheduled feature firing hundreds a day
// can stack up quickly. recordApiCost lands a row per call so the Cost log
// surfaces who's burning Serper credits.
const SERPER_COST_PER_CALL = 0.001;
async function search(apiKey, query, num = 10) {
  const { data } = await axios.post(
    'https://google.serper.dev/search',
    { q: query, num },
    { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }, timeout: 15000 }
  );
  require('./costLog').recordApiCost({ provider: 'serper', feature: 'serper_search', costUsd: SERPER_COST_PER_CALL, meta: { query, num } });
  return data.organic || [];
}

// Find candidate business domains from an audience description.
// Ported from the October Outreach plugin's OO_Serper::find_business_domains.
async function findBusinessDomains({ industry, location, specialisation }, exclude = []) {
  const apiKey = await getSetting('SERPER_API_KEY');
  if (!apiKey) throw new Error('Serper API key not configured — add it in Settings → October Outreach.');

  const subject = (specialisation || industry || '').trim();
  if (!subject) throw new Error('Enter an industry or specialisation to search.');

  const queries = [];
  if (location) {
    queries.push(`"${subject}" ${location}`);
    queries.push(`${subject} firm ${location}`);
    if (specialisation && industry) queries.push(`${industry} ${location}`);
  } else {
    queries.push(`${subject} firm`);
    queries.push(`"${subject}"`);
  }

  const found = {};
  let lastError = null;
  for (const q of queries) {
    try {
      const results = await search(apiKey.trim(), q, 10);
      for (const r of results) {
        const domain = extractDomain(r.link || '');
        if (!domain || isSkippable(domain) || exclude.includes(domain)) continue;
        if (!found[domain]) found[domain] = r.title || domain;
      }
    } catch (err) {
      lastError = err.response?.data?.message || err.message;
    }
  }

  const domains = Object.keys(found).map(d => ({ domain: d, title: found[d] }));
  if (!domains.length && lastError) throw new Error(`Serper: ${lastError}`);
  return domains;
}

// Find public Instagram profiles matching an ICP, via web search (no IG
// scraping — Google's public index through Serper). Returns deduped handles
// for the manual-outreach queue. The AM does the actual DMing by hand.
const IG_RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'about', 'directory', 'accounts', 'direct', 'legal', 'privacy', 'terms', 'developer', 'web']);
function handleFromIgUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)instagram\.com$/.test(u.hostname)) return null;
    const seg = u.pathname.split('/').filter(Boolean)[0];
    if (!seg) return null;
    const h = seg.toLowerCase().replace(/[^a-z0-9._]/g, '');
    if (!h || IG_RESERVED.has(h) || h.length > 30) return null;
    return h;
  } catch { return null; }
}
async function searchInstagramProfiles({ icp, location, hashtags } = {}, exclude = []) {
  const apiKey = await getSetting('SERPER_API_KEY');
  if (!apiKey) throw new Error('Serper API key not configured — add it in Settings.');
  // The ICP can list several roles at once ("architects, interior designers,
  // landscape architects") — run a query per role so one discovery covers them.
  const roles = String(icp || '').split(/,|\band\b|\/|&/i).map(s => s.trim()).filter(Boolean).slice(0, 6);
  const queries = [];
  // NB: no `site:` operator — Serper's free tier rejects it ("query pattern not
  // allowed"). We use plain queries biased toward Instagram and filter results
  // to instagram.com profile URLs in code (handleFromIgUrl) instead.
  for (const role of roles) {
    const loc = location ? ' ' + location : '';
    queries.push(`${role}${loc} instagram`);
    queries.push(`"${role}"${loc} instagram profile`);
    queries.push(`${role}${loc} instagram account`);
  }
  (Array.isArray(hashtags) ? hashtags : []).slice(0, 3).forEach(h => queries.push(`${String(h).replace(/^#/, '')} instagram`));
  if (!queries.length) throw new Error('Enter an ICP or some hashtags to search.');

  const ex = new Set((exclude || []).map(s => String(s).toLowerCase()));
  const found = {};
  let lastError = null;
  for (const q of queries) {
    try {
      const results = await search(apiKey.trim(), q, 20);
      for (const r of results) {
        const h = handleFromIgUrl(r.link || '');
        if (!h || ex.has(h) || found[h]) continue;
        found[h] = {
          username: h,
          profile_url: `https://www.instagram.com/${h}/`,
          display_name: String(r.title || '').replace(/\s*[(•|].*$/, '').trim() || h,
          bio: String(r.snippet || '').slice(0, 400),
        };
      }
    } catch (err) { lastError = err.response?.data?.message || err.message; }
  }
  const list = Object.values(found);
  if (!list.length && lastError) throw new Error(`Serper: ${lastError}`);
  return list;
}

// Google News search (PR coverage monitor). Returns normalised hits.
async function searchNews(apiKey, query, num = 20) {
  const { data } = await axios.post(
    'https://google.serper.dev/news',
    { q: query, num },
    { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }, timeout: 15000 }
  );
  require('./costLog').recordApiCost({ provider: 'serper', feature: 'serper_news', costUsd: SERPER_COST_PER_CALL, meta: { query, num } });
  return (data.news || []).filter(n => n.link).map(n => ({
    title: n.title || '', link: n.link, source: n.source || '', date: n.date || '', snippet: n.snippet || '',
  }));
}

module.exports = { findBusinessDomains, searchInstagramProfiles, searchNews };
