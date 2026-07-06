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
  // Gate gated endpoints (Backlinks + LLM Mentions) before they hit the
  // wire. DataForSEO would return a billing error otherwise; this gives
  // a clear "available on 1 July 2026" message instead.
  const { assertUnlocked } = require('../services/dfsAvailability');
  client.interceptors.request.use((cfg) => {
    assertUnlocked(cfg.url || '');
    return cfg;
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

// Top N organic SERP URLs for a keyword — used to ground the cluster
// brief outline in what's actually winning page 1 right now, not what
// Claude guesses people might want. Returns just url + title.
async function fetchTopSerpResults(keyword, { locationCode = 2826, limit = 10 } = {}) {
  const client = await getClient();
  const { data } = await client.post('/serp/google/organic/live/advanced', [{
    keyword,
    location_code: locationCode,
    language_code: 'en',
    device: 'desktop',
    depth: Math.min(limit + 3, 20),
    se_domain: 'google.co.uk',
  }]);
  const items = data.tasks?.[0]?.result?.[0]?.items || [];
  return items
    .filter(i => i.type === 'organic' && i.url)
    .slice(0, limit)
    .map(i => ({ url: i.url, title: i.title || '', description: i.description || '' }));
}

// Bare hostname for rank matching — strips scheme, path and a leading www.
function rankHost(u) {
  if (!u) return null;
  try {
    const h = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.toLowerCase().replace(/^www\./, '');
    return h || null;
  } catch { return null; }
}

// checkRank(keyword, matchDomain) — finds where a SPECIFIC site ranks for the
// keyword. The site is the keyword's own target_url if set, otherwise the
// passed client domain (matchDomain). It ONLY reports that site's position —
// never the top competitor — so `position: null` genuinely means "not in the
// top 50", the same thing SERanking/GSC report. (Previously, with no target
// set, it recorded the #1 organic result regardless of domain, so ranks showed
// Amazon/Prestige/etc. instead of the client.)
async function checkRank(keyword, matchDomain) {
  const client = await getClient();

  const { data } = await client.post('/serp/google/organic/live/advanced', [{
    keyword: keyword.keyword,
    location_code: keyword.location_code || 2826,
    language_code: 'en',
    device: keyword.device || 'desktop',
    // depth 50 covers positions 1–50 (5 SERP pages). We deliberately don't
    // pull the full top 100: Live-Advanced bills $0.0015 per extra page, so
    // depth 100 (~$0.0155/check) costs roughly 2x depth 50 (~$0.008/check)
    // for ranks nobody acts on. 50 still surfaces the "focus on these"
    // keywords sitting in the 40s. Don't bump this back to 100 without
    // weighing the per-keyword/month bill (≈ depth_cost × ~7.6 checks/month).
    depth: 50,
    se_domain: 'google.co.uk',
  }]);

  if (!data.tasks || !data.tasks[0] || data.tasks[0].status_code !== 20000) {
    return { position: null, url: null, serp_features: [] };
  }

  const results = data.tasks[0].result?.[0]?.items || [];

  // Pull every non-organic SERP feature observed for this keyword so the UI
  // can show what surfaces alongside the blue links — image pack, snippet,
  // people also ask, knowledge panel, local pack, video, etc. We dedupe by
  // type because items like sitelinks repeat per result.
  const serp_features = Array.from(new Set(
    results.filter(r => r.type && r.type !== 'organic').map(r => r.type)
  ));

  // The site we're tracking: per-keyword target_url wins, else the client's
  // own domain. Match by hostname (incl. subdomains), never a path substring.
  const host = rankHost(keyword.target_url) || rankHost(matchDomain);
  if (host) {
    const match = results.find(item => {
      if (item.type !== 'organic' || !item.url) return false;
      const ih = rankHost(item.url);
      return ih && (ih === host || ih.endsWith('.' + host));
    });
    if (match) {
      return { position: match.rank_absolute, url: match.url, serp_features };
    }
  }

  // The tracked site isn't in the top 50 (or we have no site to match) — that's
  // "not ranking", not the top competitor's spot.
  return { position: null, url: null, serp_features };
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

// Every organic keyword a SPECIFIC URL ranks for (top 100). Used by the
// Pipeline → Find step: AM pastes a competitor's blog post URL, we
// return that page's keyword footprint so the AM can see what topics +
// sub-intents to cover to outrank it. Different from domain
// intersection — that's domain-wide; this is page-level.
async function fetchKeywordsForUrl(url, locationCode = 2826, limit = 200) {
  const client = await getClient();
  const { data } = await client.post('/dataforseo_labs/google/ranked_keywords/live', [{
    target: url,
    location_code: locationCode,
    language_code: 'en',
    limit,
    order_by: ['ranked_serp_element.serp_item.rank_absolute,asc'],
    filters: [['ranked_serp_element.serp_item.type', '=', 'organic']],
  }]);
  const items = data.tasks?.[0]?.result?.[0]?.items || [];
  return items.map(item => ({
    keyword: item.keyword_data?.keyword || '',
    search_volume: item.keyword_data?.keyword_info?.search_volume || null,
    position: item.ranked_serp_element?.serp_item?.rank_absolute || null,
    url: item.ranked_serp_element?.serp_item?.url || null,
  })).filter(k => k.keyword);
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

// Domain rank (DataForSEO's 0–1000 backlinks rank — the Domain Authority
// equivalent) for several domains in one batched call. Used to benchmark a
// strategy's competitor table with real numbers. Returns { domain: rank|null }.
async function fetchDomainRanks(domains) {
  const list = [...new Set((domains || []).map(normalizeDomain).filter(Boolean))].slice(0, 12);
  if (!list.length) return {};
  const client = await getClient();
  const { data } = await client.post('/backlinks/summary/live', list.map(target => ({ target, limit: 1 })));
  const out = {};
  for (const task of data.tasks || []) {
    const r = task.result?.[0];
    if (r?.target) out[r.target] = (typeof r.rank === 'number') ? r.rank : null;
  }
  return out;
}

// Anchor text distribution — what words are linking TO the client's
// domain. DFS returns each unique anchor + the backlink count using it
// + the count of referring domains. Gated like the rest of the
// Backlinks API; reads zero post-cutover when DFS is locked.
async function fetchAnchorTextDistribution(domain, { limit = 100 } = {}) {
  const client = await getClient();
  const { data } = await client.post('/backlinks/anchors/live', [{
    target: normalizeDomain(domain),
    limit,
    order_by: ['backlinks,desc'],
    mode: 'as_is',
  }]);
  const items = data.tasks?.[0]?.result?.[0]?.items || [];
  return items.map(i => ({
    anchor: i.anchor || '',
    backlinks: i.backlinks || 0,
    referring_domains: i.referring_domains || 0,
    first_seen: i.first_seen || null,
    lost_date: i.lost_date || null,
  })).filter(a => a.anchor);
}

// Referring domains — the top domains linking to the client (ordered by
// their DFS rank). This is the backbone of the Backlinks tab and the
// new/lost-links diff: each cycle we snapshot the top ~1000 so E3 can
// diff consecutive captures. DFS caps a single call at 1000 rows.
async function fetchReferringDomains(domain, { limit = 1000 } = {}) {
  const client = await getClient();
  const { data } = await client.post('/backlinks/referring_domains/live', [{
    target: normalizeDomain(domain),
    limit: Math.min(limit, 1000),
    order_by: ['rank,desc'],
    // Exclude the client's own subdomains from its referring-domain count.
    backlinks_filters: ['dofollow', '=', true],
    internal_list_limit: 1,
  }]);
  const items = data.tasks?.[0]?.result?.[0]?.items || [];
  return items.map(i => ({
    domain: i.domain || null,
    rank: typeof i.rank === 'number' ? i.rank : null,
    first_seen: i.first_seen || null,
    // referring_domains/live exposes last activity as last_seen (falls back
    // to lost_date when the domain has dropped all its links to us).
    last_seen: i.last_seen || i.lost_date || null,
    backlinks_count: i.backlinks || 0,
    // A referring domain can carry both dofollow and nofollow links; treat
    // it as dofollow if it sends us at least one followed link.
    dofollow: (i.backlinks || 0) > (i.backlinks_nofollow || 0),
    raw: i,
  })).filter(d => d.domain);
}

// Dofollow / nofollow split — sample the backlinks index, separating by
// the dofollow flag. We use a sample (200) rather than full pull because
// the absolute counts are already in the summary; we just want the
// proportion. Cheap.
async function fetchDofollowSplit(domain) {
  const client = await getClient();
  const cleanDomain = normalizeDomain(domain);
  // DFS doesn't expose a direct "count dofollow vs nofollow" endpoint;
  // closest is filtering /backlinks/backlinks/live by dofollow=true vs
  // dofollow=false, with a 1-row limit, and reading the totals from
  // the response's `items_count` metadata.
  const [dofollowRes, nofollowRes] = await Promise.all([
    client.post('/backlinks/backlinks/live', [{
      target: cleanDomain, mode: 'as_is', limit: 1,
      filters: [['dofollow', '=', true]],
    }]),
    client.post('/backlinks/backlinks/live', [{
      target: cleanDomain, mode: 'as_is', limit: 1,
      filters: [['dofollow', '=', false]],
    }]),
  ]);
  const dofollow = dofollowRes.data.tasks?.[0]?.result?.[0]?.total_count || 0;
  const nofollow = nofollowRes.data.tasks?.[0]?.result?.[0]?.total_count || 0;
  return { dofollow, nofollow, total: dofollow + nofollow };
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

// ─── AI Optimization: LLM Responses ────────────────────────────────────────
// DataForSEO's AI Optimization API (pay-as-you-go from 1 July 2026) asks a
// specific engine a prompt and returns its structured answer + citations —
// one engine per call. Powers the AI Visibility tab's ChatGPT / Gemini /
// Perplexity engines without needing separate OpenAI / Google / Perplexity
// keys. engine ∈ { chat_gpt, gemini, perplexity, claude }.

// Cache the model list per engine — model names drift, so we ask DFS which
// ones it accepts rather than hardcoding version strings that go stale.
const _llmModelCache = {};
async function fetchLlmModels(engine) {
  if (_llmModelCache[engine] && Date.now() - _llmModelCache[engine].at < 6 * 60 * 60 * 1000) {
    return _llmModelCache[engine].models;
  }
  const client = await getClient();
  const models = [];
  try {
    const { data } = await client.get(`/ai_optimization/${engine}/llm_responses/models`);
    const walk = (v) => {
      if (!v) return;
      if (typeof v === 'string') { models.push(v); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v === 'object') {
        if (typeof v.model_name === 'string') models.push(v.model_name);
        else if (typeof v.name === 'string') models.push(v.name);
        else Object.values(v).forEach(walk);
      }
    };
    walk(data.tasks?.[0]?.result);
  } catch (err) {
    console.warn(`[DataForSEO] llm models ${engine}:`, err.message);
  }
  _llmModelCache[engine] = { models, at: Date.now() };
  return models;
}

// Pull one text/url payload out of a DFS llm_responses result, defensively —
// the exact nesting varies by engine, so we collect answer-bearing string
// fields and http(s) links and keep the full raw result for later re-parse.
function extractLlmAnswer(result) {
  const parts = [];
  const urls = new Set();
  const walk = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 7) return;
    for (const [k, v] of Object.entries(obj)) {
      const kl = k.toLowerCase();
      if (typeof v === 'string') {
        if (/^(text|content|message|answer|markdown|body)$/.test(kl) && v.trim().length > 1) parts.push(v.trim());
        else if (/(^|_)(url|link|href)$/.test(kl) && /^https?:\/\//i.test(v)) urls.add(v);
      } else if (Array.isArray(v)) v.forEach(x => walk(x, depth + 1));
      else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(result, 0);
  return { text: [...new Set(parts)].join('\n\n').trim(), urls: [...urls] };
}

async function fetchLlmResponse(engine, userPrompt, { model = null, webSearch = true } = {}) {
  const client = await getClient();
  // Pick an accepted model if the caller didn't name one (model_name is
  // required by some engines); fall back to omitting it if the list is empty.
  let useModel = model;
  if (!useModel) {
    const models = await fetchLlmModels(engine);
    useModel = models[0] || null;
  }
  const task = { user_prompt: String(userPrompt || '').slice(0, 8000), web_search: !!webSearch };
  if (useModel) task.model_name = useModel;
  const { data } = await client.post(`/ai_optimization/${engine}/llm_responses/live`, [task]);
  const result = data.tasks?.[0]?.result?.[0] || null;
  const { text, urls } = extractLlmAnswer(result);
  return { answer_text: text, cited_urls: urls, model: useModel, raw: result };
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

module.exports = { authType, checkTokenValidity, checkRank, checkAIOverview, fetchKeywordsForUrl, fetchTopSerpResults, fetchSearchVolume, fetchBacklinkData, fetchDomainRanks, fetchReferringDomains, fetchAnchorTextDistribution, fetchDofollowSplit, fetchDomainAuthority, fetchReviews, fetchLLMVisibility, fetchDomainIntersection, fetchGoogleTrends, fetchLlmResponse, fetchLlmModels, fetchData, testCredentials, resolveCreds };
