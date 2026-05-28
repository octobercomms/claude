const axios = require('axios');
const { getSetting } = require('../utils/settings');

const authType = 'apikey';

// DataForSEO's api-access page shows the API login, the API password, AND a
// ready-made base64 "Authorization" token (base64 of "login:password").
// Users often paste that token into the password field — detect it and
// recover the real login/password pair so either form works.
function resolveCreds(login, password) {
  login = (login || '').trim();
  password = (password || '').trim();
  for (const value of [password, login]) {
    if (value.length >= 24 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      try {
        const decoded = Buffer.from(value, 'base64').toString('utf8');
        const colon = decoded.indexOf(':');
        if (colon > 0) {
          const user = decoded.slice(0, colon);
          const pass = decoded.slice(colon + 1);
          if (/^[^\s:]+@[^\s:]+\.[^\s:]+$/.test(user) && pass && !pass.includes(':')) {
            return { username: user, password: pass };
          }
        }
      } catch { /* not base64 — fall through */ }
    }
  }
  return { username: login, password };
}

// Credentials live in the platform_settings table (written by the Settings
// page) — read them there at call time so a saved change takes effect
// immediately, with process.env as a fallback.
async function getClient() {
  const login = await getSetting('DATAFORSEO_LOGIN');
  const password = await getSetting('DATAFORSEO_PASSWORD');
  if (!login || !password) throw new Error('DataForSEO credentials not configured');

  const creds = resolveCreds(login, password);
  const client = axios.create({
    baseURL: 'https://api.dataforseo.com/v3',
    auth: { username: creds.username, password: creds.password },
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
    return { position: null, url: null, serp_features: [] };
  }

  const results = data.tasks[0].result?.[0]?.items || [];
  const targetUrl = keyword.target_url;

  // Pull every non-organic SERP feature observed for this keyword so the UI
  // can show what surfaces alongside the blue links — image pack, snippet,
  // people also ask, knowledge panel, local pack, video, etc. We dedupe by
  // type because items like sitelinks repeat per result.
  const serp_features = Array.from(new Set(
    results.filter(r => r.type && r.type !== 'organic').map(r => r.type)
  ));

  // Find the target URL in results
  if (targetUrl) {
    const match = results.find(item =>
      item.type === 'organic' && item.url && item.url.includes(
        new URL(targetUrl).hostname.replace('www.', '')
      )
    );
    if (match) {
      return { position: match.rank_absolute, url: match.url, serp_features };
    }
  }

  // Return first organic result position if no target URL
  const firstOrganic = results.find(r => r.type === 'organic');
  return firstOrganic
    ? { position: firstOrganic.rank_absolute, url: firstOrganic.url, serp_features }
    : { position: null, url: null, serp_features };
}

// One-shot AI Overview lookup for a single keyword. Returns whether AIO
// appeared, whether the target domain was cited, and a short snippet. Used
// by the AIO scheduler and the manual "check now" button.
async function checkAIOverview(keyword, targetDomain) {
  const client = await getClient();
  const { data } = await client.post('/serp/google/ai_overview/live/advanced', [{
    keyword: keyword.keyword,
    location_code: keyword.location_code || 2826,
    language_code: 'en',
  }]);
  if (!data.tasks?.[0]?.result?.[0]) return { present: false, brand_cited: false, snippet: null };
  const r = data.tasks[0].result[0];
  const ai = r.items?.find(i => i.type === 'ai_overview');
  if (!ai) return { present: false, brand_cited: false, snippet: null };
  const dom = (targetDomain || '').replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase();
  const cited = !!dom && (
    ai.text?.toLowerCase().includes(dom) ||
    (ai.items || []).some(i => i.url?.toLowerCase().includes(dom))
  );
  return { present: true, brand_cited: cited, snippet: ai.text?.slice(0, 400) || null };
}

// Domain Intersection — keywords competitors rank for that the target
// doesn't. Used by the content-gap section of the SEO/Organic page.
async function fetchDomainIntersection(targetDomain, competitorDomains, locationCode = 2826) {
  const client = await getClient();
  const target = normalizeDomain(targetDomain);
  const competitors = (competitorDomains || []).map(normalizeDomain).filter(Boolean).slice(0, 5);
  if (!target || !competitors.length) return [];
  // The endpoint compares one target vs one competitor at a time; we union
  // the results from each comparison and dedupe.
  const gapMap = new Map();
  for (const competitor of competitors) {
    try {
      const { data } = await client.post('/dataforseo_labs/google/domain_intersection/live', [{
        target1: competitor,
        target2: target,
        location_code: locationCode,
        language_code: 'en',
        intersections: false,    // only the keywords target2 (our client) does NOT rank for
        limit: 50,
        order_by: ['avg_monthly_searches,desc'],
      }]);
      const items = data.tasks?.[0]?.result?.[0]?.items || [];
      for (const item of items) {
        const kw = item.keyword_data?.keyword;
        if (!kw) continue;
        if (!gapMap.has(kw)) {
          gapMap.set(kw, {
            keyword: kw,
            search_volume: item.keyword_data?.keyword_info?.search_volume || null,
            competition: item.keyword_data?.keyword_info?.competition || null,
            competitors: [],
            competitor_positions: {},
          });
        }
        const entry = gapMap.get(kw);
        if (!entry.competitors.includes(competitor)) entry.competitors.push(competitor);
        const pos = item.first_domain_serp_element?.rank_absolute;
        if (pos) entry.competitor_positions[competitor] = pos;
      }
    } catch (err) {
      console.error(`[DataForSEO] Domain intersection ${target} vs ${competitor} failed:`, err.message);
    }
  }
  return Array.from(gapMap.values()).sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0));
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
  const rawUser = (login || await getSetting('DATAFORSEO_LOGIN') || '').trim();
  const rawPass = (password || await getSetting('DATAFORSEO_PASSWORD') || '').trim();
  if (!rawUser || !rawPass) return { ok: false, message: 'No DataForSEO login/password set.' };
  const { username: user, password: pass } = resolveCreds(rawUser, rawPass);
  // Echo back exactly what was sent so credential mismatches are visible.
  const sent = {
    login: user,
    passwordLength: pass.length,
    passwordPreview: pass.length > 4 ? `${pass.slice(0, 2)}…${pass.slice(-2)}` : '••',
    recoveredFromToken: pass !== rawPass || user !== rawUser,
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

// Google Trends — pay-per-call, ~$0.005. Used by the Social ideation flow
// to ground Claude's post suggestions in topics that are currently moving
// rather than evergreen brand-speak.
async function fetchGoogleTrends(keywords, { locationCode = 2826, timeRange = 'past_30_days' } = {}) {
  const client = await getClient();
  const kw = (keywords || []).filter(Boolean).slice(0, 5);
  if (!kw.length) return null;
  const { data } = await client.post('/keywords_data/google_trends/explore/live', [{
    keywords: kw,
    location_code: locationCode,
    language_code: 'en',
    time_range: timeRange,
    item_types: ['google_trends_graph', 'google_trends_topics_list', 'google_trends_queries_list'],
  }]);
  const items = data.tasks?.[0]?.result?.[0]?.items || [];
  // Compress to just the moving signals — top 8 rising queries / topics
  // is plenty for the Claude prompt.
  const rising = [];
  for (const it of items) {
    for (const e of (it.data || [])) {
      if (e.topic_type === 'RISING' || e.entity_type === 'RISING') {
        rising.push({ kind: it.type, label: e.query || e.title?.text, value: e.value });
      }
    }
  }
  return {
    keywords: kw,
    rising: rising.slice(0, 8),
  };
}

module.exports = { authType, checkTokenValidity, checkRank, checkAIOverview, fetchSearchVolume, fetchBacklinkData, fetchDomainAuthority, fetchReviews, fetchLLMVisibility, fetchDomainIntersection, fetchGoogleTrends, fetchData, testCredentials };
