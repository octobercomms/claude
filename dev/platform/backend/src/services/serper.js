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

async function search(apiKey, query, num = 10) {
  const { data } = await axios.post(
    'https://google.serper.dev/search',
    { q: query, num },
    { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }, timeout: 15000 }
  );
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

// Google News search (PR coverage monitor). Returns normalised hits.
async function searchNews(apiKey, query, num = 20) {
  const { data } = await axios.post(
    'https://google.serper.dev/news',
    { q: query, num },
    { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }, timeout: 15000 }
  );
  return (data.news || []).filter(n => n.link).map(n => ({
    title: n.title || '', link: n.link, source: n.source || '', date: n.date || '', snippet: n.snippet || '',
  }));
}

module.exports = { findBusinessDomains, searchNews };
