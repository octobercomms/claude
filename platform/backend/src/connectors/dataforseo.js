const axios = require('axios');
const { getSetting } = require('../utils/settings');

const authType = 'apikey';

// Credentials live in the platform_settings table (written by the Settings
// page) — read them there at call time so a saved change takes effect
// immediately, with process.env as a fallback.
async function getClient() {
  const login = await getSetting('DATAFORSEO_LOGIN');
  const password = await getSetting('DATAFORSEO_PASSWORD');
  if (!login || !password) throw new Error('DataForSEO credentials not configured');

  const client = axios.create({
    baseURL: 'https://api.dataforseo.com/v3',
    auth: { username: login.trim(), password: password.trim() },
    headers: { 'Content-Type': 'application/json' },
  });
  client.interceptors.response.use(
    res => res,
    err => {
      if (err.response?.status === 401) {
        const detail = err.response.data?.status_message || 'check the login and password on the Settings page';
        throw new Error(`DataForSEO authentication failed — ${detail}`);
      }
      throw err;
    }
  );
  return client;
}

async function checkTokenValidity(credentials) {
  // DataForSEO uses env vars, not per-connector credentials
  const client = await getClient();
  const { data } = await client.get('/appendix/user_data');
  if (data.status_code !== 20000) throw new Error('Invalid DataForSEO credentials');
  return true;
}

async function checkRank(keyword) {
  const client = await getClient();

  const { data } = await client.post('/serp/google/organic/live/advanced', [{
    keyword: keyword.keyword,
    location_code: keyword.location_code || 2826,
    language_code: 'en',
    device: keyword.device || 'desktop',
    depth: 100,
    se_domain: 'google.co.uk',
  }]);

  if (!data.tasks || !data.tasks[0] || data.tasks[0].status_code !== 20000) {
    return { position: null, url: null };
  }

  const results = data.tasks[0].result?.[0]?.items || [];
  const targetUrl = keyword.target_url;

  // Find the target URL in results
  if (targetUrl) {
    const match = results.find(item =>
      item.type === 'organic' && item.url && item.url.includes(
        new URL(targetUrl).hostname.replace('www.', '')
      )
    );
    if (match) {
      return { position: match.rank_absolute, url: match.url };
    }
  }

  // Return first organic result position if no target URL
  const firstOrganic = results.find(r => r.type === 'organic');
  return firstOrganic
    ? { position: firstOrganic.rank_absolute, url: firstOrganic.url }
    : { position: null, url: null };
}

// Monthly Google search volume for a batch of keywords (one location).
async function fetchSearchVolume(keywords, locationCode = 2826) {
  const client = await getClient();
  const { data } = await client.post('/keywords_data/google_ads/search_volume/live', [{
    keywords: keywords.slice(0, 1000),
    location_code: locationCode,
    language_code: 'en',
  }]);
  const result = data.tasks?.[0]?.result;
  if (!Array.isArray(result)) return {};
  const out = {};
  for (const r of result) {
    if (r.keyword) out[r.keyword.toLowerCase()] = r.search_volume ?? null;
  }
  return out;
}

// DataForSEO's backlinks API needs a bare domain (no protocol/www/path) —
// a full URL is treated as a single page and returns almost no data.
function normalizeDomain(input) {
  if (!input) return input;
  return String(input)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

async function fetchBacklinkData(domain) {
  const client = await getClient();
  const { data } = await client.post('/backlinks/summary/live', [{
    target: normalizeDomain(domain),
    limit: 1,
  }]);

  if (!data.tasks?.[0]?.result?.[0]) return null;
  return data.tasks[0].result[0];
}

async function fetchDomainAuthority(domain) {
  const client = await getClient();
  const { data } = await client.post('/domain_analytics/whois/overview/live', [{
    target: domain,
  }]);

  if (!data.tasks?.[0]?.result?.[0]) return null;
  return data.tasks[0].result[0];
}

async function fetchReviews(domain, { limit = 100 } = {}) {
  const client = await getClient();
  const { data } = await client.post('/business_data/google/reviews/live/advanced', [{
    keyword: domain,
    location_code: 2826,
    language_code: 'en',
    limit,
    sort_by: 'newest',
  }]);

  if (!data.tasks?.[0]?.result?.[0]) return null;
  const result = data.tasks[0].result[0];

  const reviews = result.items || [];
  const totalReviews = result.reviews_count || 0;
  const avgRating = result.rating?.value || null;
  const ratingsCount = result.rating?.votes_count || 0;

  // Count reviews in last 30 days
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentReviews = reviews.filter(r => r.timestamp && new Date(r.timestamp).getTime() > thirtyDaysAgo);

  // Simple sentiment counts from star ratings
  const positive = reviews.filter(r => (r.rating?.value || 0) >= 4).length;
  const negative = reviews.filter(r => (r.rating?.value || 0) <= 2).length;

  return {
    total_reviews: totalReviews,
    ratings_count: ratingsCount,
    avg_rating: avgRating,
    recent_count: recentReviews.length,
    positive_count: positive,
    negative_count: negative,
    recent_reviews: recentReviews.slice(0, 5).map(r => ({
      rating: r.rating?.value,
      text: r.review_text?.slice(0, 200),
      date: r.timestamp,
      author: r.author_title,
    })),
  };
}

async function fetchLLMVisibility(domain, keywords = []) {
  const client = await getClient();
  // Use LLM Responses API to test brand presence in AI answers
  const prompts = keywords.length
    ? keywords.slice(0, 5).map(kw => ({ keyword: kw, location_code: 2826, language_code: 'en' }))
    : [{ keyword: domain, location_code: 2826, language_code: 'en' }];

  const { data } = await client.post('/serp/google/ai_overview/live/advanced', prompts);
  if (!data.tasks?.length) return null;

  const results = [];
  for (const task of data.tasks) {
    if (!task.result?.[0]) continue;
    const r = task.result[0];
    const aiOverview = r.items?.find(i => i.type === 'ai_overview');
    if (!aiOverview) continue;
    const mentioned = aiOverview.text?.toLowerCase().includes(domain.toLowerCase()) ||
      aiOverview.items?.some(i => i.url?.includes(domain));
    results.push({
      keyword: task.data?.keyword,
      has_ai_overview: true,
      brand_mentioned: !!mentioned,
      snippet: aiOverview.text?.slice(0, 300),
    });
  }

  return {
    keywords_checked: prompts.length,
    ai_overview_present: results.length,
    brand_visible: results.filter(r => r.brand_mentioned).length,
    details: results,
  };
}

async function fetchData(credentials, params) {
  const { domain, keyword } = params;
  const results = {};

  if (keyword) results.rank = await checkRank(keyword);
  if (domain) {
    const [backlinks, authority] = await Promise.all([
      fetchBacklinkData(domain),
      fetchDomainAuthority(domain),
    ]);
    results.backlinks = backlinks;
    results.domain_authority = authority;
  }

  return results;
}

// Verifies a DataForSEO login/password pair (or, when omitted, the saved
// credentials) by calling the lightweight user_data endpoint.
async function testCredentials({ login, password } = {}) {
  const user = (login || await getSetting('DATAFORSEO_LOGIN') || '').trim();
  const pass = (password || await getSetting('DATAFORSEO_PASSWORD') || '').trim();
  if (!user || !pass) return { ok: false, message: 'No DataForSEO login/password set.' };
  // Echo back exactly what was sent so credential mismatches are visible.
  const sent = {
    login: user,
    passwordLength: pass.length,
    passwordPreview: pass.length > 4 ? `${pass.slice(0, 2)}…${pass.slice(-2)}` : '••',
  };
  try {
    const { data } = await axios.get('https://api.dataforseo.com/v3/appendix/user_data', {
      auth: { username: user, password: pass },
    });
    if (data.status_code === 20000) {
      const balance = data.tasks?.[0]?.result?.[0]?.money?.balance;
      return { ok: true, message: balance != null ? `Connected — account balance $${balance}.` : 'Connected successfully.', sent };
    }
    return { ok: false, message: data.status_message || 'DataForSEO rejected the request.', code: data.status_code, sent };
  } catch (err) {
    const d = err.response?.data;
    return { ok: false, message: d?.status_message || err.message, code: d?.status_code || err.response?.status || null, sent };
  }
}

module.exports = { authType, checkTokenValidity, checkRank, fetchSearchVolume, fetchBacklinkData, fetchDomainAuthority, fetchReviews, fetchLLMVisibility, fetchData, testCredentials };
