const axios = require('axios');
const { getPlatformGoogleAccessToken, getPlatformAdsAccessToken } = require('../services/googleAuth');

const authType = 'oauth';

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const MERCHANT_SCOPE = 'https://www.googleapis.com/auth/content';

// Modes that authenticate with the platform service account rather than a
// per-user OAuth token. See migration 065 and services/googleAuth.js.
function isServiceAccountMode(authMode) {
  return authMode === 'service_account' || authMode === 'mcc_link';
}

// Resolve a Google bearer token for either auth path. In service-account
// mode the connector has no per-user credentials — the token comes from the
// platform service account, which the client has granted access on the
// resource (a GA4 property, a Search Console site, …). In OAuth mode it's
// the existing refresh-and-return flow.
async function resolveAccessToken(credentials, authMode, scopes) {
  if (isServiceAccountMode(authMode)) {
    return getPlatformGoogleAccessToken(scopes);
  }
  const creds = await getValidToken(credentials);
  return creds.access_token;
}

// GA4 reads use the analytics scope.
async function ga4AccessToken(credentials, authMode) {
  return resolveAccessToken(credentials, authMode, [GA4_SCOPE]);
}

// Search Console reads use the webmasters scope.
async function gscAccessToken(credentials, authMode) {
  return resolveAccessToken(credentials, authMode, [GSC_SCOPE]);
}

// Merchant Center reads use the Content API scope. In service-account mode
// the platform service account must be added as a user on the client's
// Merchant Center account (Settings → Users); in OAuth mode it's the
// existing per-user token.
async function merchantAccessToken(credentials, authMode) {
  return resolveAccessToken(credentials, authMode, [MERCHANT_SCOPE]);
}

const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/content',
  'https://www.googleapis.com/auth/userinfo.email',
  // Social autopilot — read media files from the user's nominated
  // Drive folder once they've finished shooting. drive.readonly is
  // the right level: we never write to Drive.
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCode(code) {
  const { data } = await axios.post('https://oauth2.googleapis.com/token', {
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
}

async function refreshToken(credentials) {
  if (!credentials.refresh_token) throw new Error('No refresh token available');
  const { data } = await axios.post('https://oauth2.googleapis.com/token', {
    refresh_token: credentials.refresh_token,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  return {
    ...credentials,
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

async function checkTokenValidity(credentials, authMode, connectorType) {
  if (isServiceAccountMode(authMode)) {
    // No per-user token to validate — confirm the relevant platform-level
    // credential is configured and can mint a token. Google Ads uses the
    // manager (MCC) refresh token; the others use the service account.
    // Access to the specific resource is checked separately when data is
    // fetched (and by the diagnose route's live test).
    if (connectorType === 'google_ads') {
      await getPlatformAdsAccessToken();
    } else {
      await getPlatformGoogleAccessToken([GA4_SCOPE]);
    }
    return true;
  }
  if (!credentials || !credentials.access_token) throw new Error('No credentials');
  // Refresh if expired
  if (credentials.expires_at && Date.now() > credentials.expires_at - 60000) {
    return refreshToken(credentials);
  }
  const { data } = await axios.get(
    `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${credentials.access_token}`
  );
  if (data.error) throw new Error(data.error);
  return true;
}

async function getValidToken(credentials) {
  if (!credentials) throw new Error('No credentials configured');
  if (!credentials.expires_at || Date.now() > credentials.expires_at - 60000) {
    return refreshToken(credentials);
  }
  return credentials;
}

// Flatten a GA4 runReport response into plain objects keyed by dimension/metric name.
function ga4Rows(report) {
  if (!report) return [];
  const dims = (report.dimensionHeaders || []).map(h => h.name);
  const mets = (report.metricHeaders || []).map(h => h.name);
  return (report.rows || []).map(row => {
    const o = {};
    dims.forEach((d, i) => { o[d] = row.dimensionValues?.[i]?.value; });
    mets.forEach((m, i) => { o[m] = parseFloat(row.metricValues?.[i]?.value || 0); });
    return o;
  });
}

// GA4 data fetch
async function fetchGA4Data(credentials, params) {
  const { propertyId, startDate, endDate, authMode } = params;
  if (!propertyId) throw new Error('GA4 property not selected — open the client connectors tab and choose a property.');
  const accessToken = await ga4AccessToken(credentials, authMode);

  const runReport = (body) => axios.post(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    body,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  try {
    // Main report — current vs previous period; the summariser depends on this shape.
    const { data } = await runReport({
      dateRanges: [
        { startDate, endDate },
        { startDate: getPreviousPeriodStart(startDate, endDate), endDate: getPreviousPeriodEnd(startDate, endDate) },
      ],
      metrics: [
        { name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' },
        { name: 'bounceRate' }, { name: 'averageSessionDuration' }, { name: 'conversions' },
        { name: 'totalRevenue' },
      ],
      dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
    });

    // Supplementary breakdowns — best-effort, must never block the main report.
    const [sourceMedium, landingPages, events] = await Promise.allSettled([
      runReport({
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'conversions' }, { name: 'totalRevenue' }],
        dimensions: [{ name: 'sessionSourceMedium' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 15,
      }),
      runReport({
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: 'sessions' }, { name: 'conversions' }, { name: 'totalRevenue' }],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 15,
      }),
      runReport({
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: 'eventCount' }, { name: 'eventValue' }],
        dimensions: [{ name: 'eventName' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 20,
      }),
    ]);

    return {
      ...data,
      source_medium: sourceMedium.status === 'fulfilled' ? ga4Rows(sourceMedium.value.data) : [],
      landing_pages: landingPages.status === 'fulfilled' ? ga4Rows(landingPages.value.data) : [],
      events: events.status === 'fulfilled' ? ga4Rows(events.value.data) : [],
    };
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.response?.data?.error || err.message;
    const status = err.response?.status;
    throw new Error(`GA4 API error (${status}): ${JSON.stringify(detail)}`);
  }
}

// Single-range GA4 report for the Sales & Traffic dashboard — daily rows
// split by channel, so trends and source breakdowns can be derived.
//
// keepEmptyRows: true makes GA4 return rows for date×channel combinations
// even when every metric is zero. Without this, days with zero traffic on
// every channel are silently dropped — which on a sparse / new property
// looks identical to a truncated date range. We'd rather plot zeros than
// have the chart silently compress to the last month with traffic.
async function fetchGA4Daily(credentials, { propertyId, startDate, endDate, authMode }) {
  if (!propertyId) throw new Error('GA4 property not selected — choose one on the Connectors tab.');
  const accessToken = await ga4AccessToken(credentials, authMode);
  try {
    const { data } = await axios.post(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'transactions' }, { name: 'totalRevenue' }],
        dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
        keepEmptyRows: true,
        limit: 100000,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return data;
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.response?.data?.error || err.message;
    throw new Error(`GA4 API error (${err.response?.status}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
}

// Search Console data fetch
async function fetchSearchConsoleData(credentials, params) {
  const { siteUrl, startDate, endDate, authMode } = params;
  if (!siteUrl) throw new Error('Search Console site not selected — open the client connectors tab and choose a site.');
  const accessToken = await gscAccessToken(credentials, authMode);

  // Three queries in parallel:
  //   1. UNDIMENSIONED → period's true total clicks/impressions/ctr/position.
  //   2. dimensions=['query'] → one row per query, with that query's TRUE
  //      totals (summed across all its pages/devices/countries by GSC).
  //   3. dimensions=['page'] → one row per page, ditto.
  //
  // Previously the connector used a single multi-dimension query
  // (query, page, device, country) with rowLimit=100, then aggregated
  // by first dimension in the renderer. That's broken twice over:
  // - Top-100 multi-dim combinations cover only a fraction of the long
  //   tail, so the per-query totals were missing most of the data.
  // - Aggregating by averaging CTR/position across sub-combinations
  //   misweights vs the per-query values GSC returns natively.
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const auth = { headers: { Authorization: `Bearer ${accessToken}` } };
  const [totalsRes, queriesRes, pagesRes] = await Promise.all([
    axios.post(url, { startDate, endDate }, auth),
    axios.post(url, { startDate, endDate, dimensions: ['query'], rowLimit: 25 }, auth),
    axios.post(url, { startDate, endDate, dimensions: ['page'], rowLimit: 25 }, auth),
  ]);
  const totalsRow = (totalsRes.data.rows || [])[0] || {};
  return {
    totals: {
      clicks: totalsRow.clicks || 0,
      impressions: totalsRow.impressions || 0,
      ctr: totalsRow.ctr || 0,
      position: totalsRow.position || 0,
    },
    topQueries: queriesRes.data.rows || [],
    topPages: pagesRes.data.rows || [],
  };
}

// Single-dimension Search Analytics query — used by the SEO page tabs so we
// can show top queries and top pages independently, with their own row
// limits and sort orders rather than slicing one mixed-dimension response.
async function fetchSearchAnalytics(credentials, { siteUrl, startDate, endDate, dimensions = ['query'], rowLimit = 50, authMode }) {
  if (!siteUrl) throw new Error('Search Console site not selected.');
  const accessToken = await gscAccessToken(credentials, authMode);
  const { data } = await axios.post(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    { startDate, endDate, dimensions, rowLimit },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return (data.rows || []).map(r => {
    const out = { clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || 0 };
    dimensions.forEach((d, i) => { out[d] = r.keys?.[i]; });
    return out;
  });
}

// Sitemap inventory from GSC — surfaces last-submitted, last-downloaded,
// errors and warnings counts so we can flag indexing issues without having
// to call the heavier URL Inspection API.
async function fetchSearchConsoleSitemaps(credentials, { siteUrl, authMode }) {
  if (!siteUrl) throw new Error('Search Console site not selected.');
  const accessToken = await gscAccessToken(credentials, authMode);
  const { data } = await axios.get(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return (data.sitemap || []).map(s => ({
    path: s.path,
    last_submitted: s.lastSubmitted,
    last_downloaded: s.lastDownloaded,
    is_pending: s.isPending,
    is_sitemaps_index: s.isSitemapsIndex,
    type: s.type,
    errors: parseInt(s.errors || 0),
    warnings: parseInt(s.warnings || 0),
    contents: (s.contents || []).map(c => ({
      type: c.type,
      submitted: parseInt(c.submitted || 0),
      indexed: parseInt(c.indexed || 0),
    })),
  }));
}

// Google Ads data fetch
// Cache: customerId -> loginCustomerId that worked, to avoid re-discovery on every call
const adsLoginCache = new Map();

async function fetchGoogleAdsData(credentials, params) {
  const { customerId, startDate, endDate, authMode } = params;
  // API requires customer ID without dashes (e.g. 9543280011 not 954-328-0011)
  const cleanCustomerId = (customerId || '').replace(/-/g, '');
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';

  // Google Ads can't use the platform service account. In mcc_link mode the
  // platform authenticates with the manager-account (MCC) refresh token and
  // reaches the client account through login-customer-id = GOOGLE_ADS_MCC_ID,
  // which the explicit-MCC branch below already handles. OAuth mode keeps the
  // existing per-client refresh flow + login-customer-id auto-discovery.
  const useManager = isServiceAccountMode(authMode);
  if (useManager && !(process.env.GOOGLE_ADS_MCC_ID || '').replace(/-/g, '')) {
    throw new Error('Google Ads MCC link mode requires GOOGLE_ADS_MCC_ID to be set in Settings.');
  }
  const accessToken = useManager
    ? await getPlatformAdsAccessToken()
    : (await getValidToken(credentials)).access_token;

  // Use /search (not /searchStream) — simpler JSON response, easier error messages
  // metrics.conversion_value is not a valid GAQL field; use metrics.conversions_value
  //
  // Status filter removed: an earlier version filtered "AND campaign.status =
  // ENABLED" on both queries, which made historical date ranges look empty
  // when the campaigns from that period had since been paused or removed —
  // breaking the Data Analyst's "show me July–Nov 2025" workflow. The Google
  // Ads API still returns historical metrics for non-ENABLED campaigns, so
  // selecting campaign.status keeps the row identifiable without hiding it.
  const campaignQuery = `
    SELECT campaign.id, campaign.name, campaign.status,
           metrics.clicks, metrics.impressions, metrics.ctr,
           metrics.average_cpc, metrics.conversions, metrics.conversions_value,
           metrics.cost_micros
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.cost_micros DESC
  `;
  const keywordQuery = `
    SELECT campaign.name, ad_group.name,
           ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
           metrics.clicks, metrics.impressions, metrics.cost_micros,
           metrics.conversions, metrics.conversions_value
    FROM keyword_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.cost_micros DESC
    LIMIT 50
  `;

  const search = (loginCustomerId, query) => {
    const headers = { Authorization: `Bearer ${accessToken}`, 'developer-token': devToken };
    if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
    return axios.post(
      `https://googleads.googleapis.com/v21/customers/${cleanCustomerId}/googleAds:search`,
      { query },
      { headers }
    );
  };

  // Run the campaign query (required) plus the keyword query (best-effort) on a
  // login-customer-id already proven to work for this account.
  //
  // Two-step campaign fetch — the metrics query (FROM campaign WHERE
  // segments.date BETWEEN x AND y) only returns rows for campaigns that have
  // finalised metrics in the window. New campaigns that are live in the UI
  // but whose data hasn't finalised yet (Google Ads Reporting API has a
  // 3-24h finalisation delay vs. the live UI) return zero rows and look
  // invisible to the analyst. We list every NON-REMOVED campaign first via
  // a metrics-free query, then overlay metrics by id so newly-created
  // campaigns appear immediately with zeros where data isn't ready.
  const campaignListQuery = `
    SELECT campaign.id, campaign.name, campaign.status,
           campaign.start_date, campaign.advertising_channel_type
    FROM campaign
    WHERE campaign.status != 'REMOVED'
    ORDER BY campaign.start_date DESC
  `;
  // Customer hierarchy probe — `customer_client` enumerates every account
  // accessible from the current customer-id, including sub-accounts of an
  // MCC. Surfaced in the response so the analyst can confirm which account
  // is being queried and spot the case where new campaigns live in a sibling
  // sub-account the connector wasn't pointing at.
  const customerHierarchyQuery = `
    SELECT customer_client.id, customer_client.descriptive_name,
           customer_client.manager, customer_client.level
    FROM customer_client
  `;
  const fetchBoth = async (loginCustomerId) => {
    // allSettled rather than all — if either query fails on its own (auth
    // quirk, transient, permission), the other still runs and we still
    // return what we can. The previous Promise.all would reject the whole
    // call and the route would fall through to MCC auto-discovery, which
    // ran the same broken pair against every accessible login id —
    // expensive and equally unhelpful.
    const [metricsSettled, listSettled, hierSettled] = await Promise.allSettled([
      search(loginCustomerId, campaignQuery),
      search(loginCustomerId, campaignListQuery),
      search(loginCustomerId, customerHierarchyQuery),
    ]);
    const metricsRes = metricsSettled.status === 'fulfilled' ? metricsSettled.value : null;
    const listRes = listSettled.status === 'fulfilled' ? listSettled.value : null;
    const hierRes = hierSettled.status === 'fulfilled' ? hierSettled.value : null;
    if (metricsSettled.status === 'rejected') console.warn('[Google Ads] metrics query failed:', metricsSettled.reason?.response?.data?.error?.message || metricsSettled.reason?.message);
    if (listSettled.status === 'rejected') console.warn('[Google Ads] campaign list query failed:', listSettled.reason?.response?.data?.error?.message || listSettled.reason?.message);
    if (hierSettled.status === 'rejected') console.warn('[Google Ads] customer hierarchy query failed:', hierSettled.reason?.response?.data?.error?.message || hierSettled.reason?.message);
    // Promote a hard error from the metrics query because everything
    // downstream assumes at least metrics came back. List + hierarchy are
    // best-effort.
    if (!metricsRes) throw metricsSettled.reason;

    const listRows = (listRes?.data?.results || []);
    const hierRows = (hierRes?.data?.results || []).map((r) => ({
      id: r.customerClient?.id || null,
      name: r.customerClient?.descriptiveName || '',
      manager: r.customerClient?.manager || false,
      level: r.customerClient?.level || null,
    }));
    console.log(`[Google Ads] account ${cleanCustomerId} (login=${loginCustomerId || 'none'}): metrics=${(metricsRes.data.results || []).length}, list=${listRows.length}, hierarchy=${hierRows.length}`);

    // Merge: every campaign from the list appears, with metrics overlaid
    // when we have them. Match by id first, then by resourceName as a
    // fallback — Google occasionally elides id for very freshly created
    // campaigns while resourceName is always present.
    const merged = [];
    const seen = new Set();
    const idKey = (row) => String(row.campaign?.id || row.campaign?.resourceName || '');
    for (const row of (metricsRes.data.results || [])) {
      const id = idKey(row);
      if (id) seen.add(id);
      merged.push(row);
    }
    for (const row of listRows) {
      const id = idKey(row);
      if (!id || seen.has(id)) continue;
      merged.push({
        campaign: row.campaign,
        // Zero metrics — these campaigns exist but had no finalised data in
        // the window. The analyst can tell from the zeros that data is still
        // pending rather than the campaign being absent.
        metrics: { clicks: '0', impressions: '0', ctr: 0, averageCpc: '0', conversions: 0, conversionsValue: 0, costMicros: '0' },
      });
    }

    let keywords = [];
    try {
      const kwRes = await search(loginCustomerId, keywordQuery);
      keywords = kwRes.data.results || [];
    } catch (kwErr) {
      console.warn('[Google Ads] keyword_view fetch failed:', kwErr.response?.data?.error?.message || kwErr.message);
    }
    // Pull the customer's currency code so the report renderer can
    // convert cross-currency Google Ads sections (US/USD vs UK/GBP) to
    // GBP via fxRates instead of summing raw numbers as if they were
    // the same unit. Best-effort — if the query fails we fall back to
    // GBP and the renderer treats the data as already-in-GBP.
    let currency = null;
    try {
      const cuRes = await search(loginCustomerId, `SELECT customer.currency_code FROM customer LIMIT 1`);
      currency = cuRes.data.results?.[0]?.customer?.currencyCode || null;
    } catch (cuErr) {
      console.warn('[Google Ads] currency_code fetch failed:', cuErr.response?.data?.error?.message || cuErr.message);
    }
    // fetched_at lets the analyst (and Data Analyst tool prompt) tell
    // freshness at a glance — if data looks suspicious, this is the wall
    // clock for when we actually hit the API. account_hierarchy + list
    // diagnostics expose the sub-account picture so the analyst can spot
    // the "new campaign lives in a sibling account" case.
    return {
      ...metricsRes.data,
      results: merged,
      keyword_view: keywords,
      currency,
      fetched_at: new Date().toISOString(),
      account: { queried_id: cleanCustomerId, login_id: loginCustomerId || null },
      account_hierarchy: hierRows,
      diagnostics: {
        metrics_rows: (metricsRes.data.results || []).length,
        list_rows: listRows.length,
        list_query_ok: !!listRes,
        list_query_error: listSettled.status === 'rejected' ? (listSettled.reason?.response?.data?.error?.message || listSettled.reason?.message) : null,
      },
    };
  };

  // Explicit MCC override takes priority — set GOOGLE_ADS_MCC_ID in Settings to skip auto-discovery
  const explicitMcc = (process.env.GOOGLE_ADS_MCC_ID || '').replace(/-/g, '');
  if (explicitMcc) {
    try {
      return await fetchBoth(explicitMcc);
    } catch (err) {
      const detail = err.response?.data?.error?.details?.[0]?.errors?.[0]?.message
        || err.response?.data?.error?.message
        || err.message;
      throw new Error(`Google Ads API error (MCC ${explicitMcc}): ${detail}`);
    }
  }

  // Try cached login-customer-id first
  const cached = adsLoginCache.get(cleanCustomerId);
  if (cached) {
    try {
      return await fetchBoth(cached);
    } catch { adsLoginCache.delete(cleanCustomerId); }
  }

  // Try direct access (no login-customer-id)
  try {
    return await fetchBoth(null);
  } catch (directErr) {
    // Auto-discover MCC: try each accessible customer as login-customer-id
    let candidates = [];
    try {
      const { data: accountsData } = await axios.get(
        'https://googleads.googleapis.com/v21/customers:listAccessibleCustomers',
        { headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': devToken } }
      );
      candidates = (accountsData.resourceNames || [])
        .map(r => r.replace('customers/', ''))
        .filter(id => id !== cleanCustomerId);
      console.log(`[Google Ads] Auto-discovery candidates for ${cleanCustomerId}:`, candidates);
    } catch (listErr) {
      console.warn('[Google Ads] listAccessibleCustomers failed:', listErr.response?.data || listErr.message);
    }

    for (const loginId of candidates) {
      try {
        const result = await fetchBoth(loginId);
        adsLoginCache.set(cleanCustomerId, loginId);
        console.log(`[Google Ads] Found working login-customer-id ${loginId} for customer ${cleanCustomerId}`);
        return result;
      } catch { continue; }
    }

    const detail = directErr.response?.data?.error?.details?.[0]?.errors?.[0]?.message
      || directErr.response?.data?.error?.message
      || directErr.message;
    const status = directErr.response?.status;
    throw new Error(`Google Ads API error (${status}): ${detail}. Set GOOGLE_ADS_MCC_ID in Settings to specify the manager account ID directly.`);
  }
}

// Report which Google API scopes the OAuth token actually holds.
async function getAccessReport(credentials) {
  const creds = await getValidToken(credentials);
  const { data } = await axios.get(
    `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${creds.access_token}`
  );
  const granted = (data.scope || '').split(/\s+/).filter(Boolean);
  const SCOPE_LABELS = {
    'https://www.googleapis.com/auth/analytics.readonly': 'GA4 Analytics',
    'https://www.googleapis.com/auth/webmasters.readonly': 'Search Console',
    'https://www.googleapis.com/auth/adwords': 'Google Ads',
    'https://www.googleapis.com/auth/content': 'Merchant Center',
  };
  const checks = Object.entries(SCOPE_LABELS).map(([scope, label]) => ({ label, has: granted.includes(scope) }));
  return {
    account: data.email || null,
    granted: checks.filter(c => c.has).map(c => c.label),
    missing: checks.filter(c => !c.has).map(c => c.label),
    limitations: checks
      .filter(c => !c.has)
      .map(c => `${c.label} data is unavailable — its scope was not granted. Re-authorise Google to add it.`),
  };
}

async function listGA4Properties(credentials, authMode) {
  const accessToken = await ga4AccessToken(credentials, authMode);
  const { data } = await axios.get(
    'https://analyticsadmin.googleapis.com/v1beta/accountSummaries',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const options = [];
  for (const account of (data.accountSummaries || [])) {
    for (const property of (account.propertySummaries || [])) {
      options.push({
        value: property.property.replace('properties/', ''),
        label: `${property.displayName} — ${account.displayName}`,
      });
    }
  }
  return options;
}

async function listSearchConsoleSites(credentials, authMode) {
  const accessToken = await gscAccessToken(credentials, authMode);
  const { data } = await axios.get(
    'https://www.googleapis.com/webmasters/v3/sites',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return (data.siteEntry || []).map(site => ({
    value: site.siteUrl,
    label: site.siteUrl,
  }));
}

async function listGoogleAdsAccounts(credentials, authMode) {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) return [];
  const accessToken = isServiceAccountMode(authMode)
    ? await getPlatformAdsAccessToken()
    : (await getValidToken(credentials)).access_token;
  try {
    const { data } = await axios.get(
      'https://googleads.googleapis.com/v21/customers:listAccessibleCustomers',
      { headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': devToken } }
    );
    return (data.resourceNames || []).map(name => ({
      value: name.replace('customers/', ''),
      label: name.replace('customers/', ''),
    }));
  } catch {
    return [];
  }
}

async function listMerchantAccounts(credentials, authMode) {
  try {
    const accessToken = await merchantAccessToken(credentials, authMode);
    const { data } = await axios.get(
      'https://shoppingcontent.googleapis.com/content/v2.1/accounts/authinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return (data.accountIdentifiers || []).map(acc => ({
      value: String(acc.merchantId || acc.aggregatorId),
      label: `Merchant ${acc.merchantId || acc.aggregatorId}`,
    }));
  } catch {
    return [];
  }
}

async function listAccounts(credentials, connectorType, authMode) {
  switch (connectorType) {
    case 'ga4': return listGA4Properties(credentials, authMode);
    case 'google_search_console': return listSearchConsoleSites(credentials, authMode);
    case 'google_ads': return listGoogleAdsAccounts(credentials, authMode);
    case 'google_merchant_center': return listMerchantAccounts(credentials, authMode);
    default: return [];
  }
}

async function fetchMerchantCenterData(credentials, params) {
  const { merchantId, startDate, endDate, authMode } = params;
  if (!merchantId) throw new Error('Merchant Center account not selected — open the client connectors tab and choose an account.');
  const accessToken = await merchantAccessToken(credentials, authMode);

  const search = (query) => axios.post(
    `https://merchantapi.googleapis.com/reports/v1beta/accounts/${merchantId}:search`,
    { query },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  try {
    const [perfRes, productRes] = await Promise.allSettled([
      search(`SELECT metrics.clicks, metrics.impressions, metrics.ctr FROM MerchantPerformanceView WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`),
      search(`SELECT segments.offer_id, segments.title, metrics.clicks, metrics.impressions FROM ProductPerformanceView WHERE segments.date BETWEEN '${startDate}' AND '${endDate}' ORDER BY metrics.clicks DESC LIMIT 20`),
    ]);

    return {
      performance: perfRes.status === 'fulfilled' ? (perfRes.value.data.results || []) : [],
      top_products: productRes.status === 'fulfilled' ? (productRes.value.data.results || []) : [],
    };
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    const status = err.response?.status;
    throw new Error(`Merchant Center API error (${status}): ${detail}`);
  }
}

async function fetchData(credentials, params) {
  const { connectorType, ...rest } = params;
  switch (connectorType) {
    case 'ga4': return fetchGA4Data(credentials, rest);
    case 'google_search_console': return fetchSearchConsoleData(credentials, rest);
    case 'google_ads': return fetchGoogleAdsData(credentials, rest);
    case 'google_merchant_center': return fetchMerchantCenterData(credentials, rest);
    default: throw new Error(`Unknown Google connector type: ${connectorType}`);
  }
}

function getPreviousPeriodStart(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const duration = e - s;
  const prevEnd = new Date(s - 1);
  const prevStart = new Date(prevEnd - duration);
  return prevStart.toISOString().split('T')[0];
}

function getPreviousPeriodEnd(start, end) {
  const s = new Date(start);
  const prevEnd = new Date(s - 1);
  return prevEnd.toISOString().split('T')[0];
}

module.exports = { authType, getAuthUrl, exchangeCode, refreshToken, checkTokenValidity, fetchData, listAccounts, fetchGA4Daily, fetchSearchAnalytics, fetchSearchConsoleSitemaps, getAccessReport };
