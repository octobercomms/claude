const axios = require('axios');

// October Forms — multi-step lead-generation form plugin exposed via a
// read-only JSON API. Each client connector points at one WordPress
// instance (site_url) and one API key, then picks ONE form_id via
// config.value (set via the standard /accounts → /config dance).
//
// API reference: {site_url}/wp-json/ocf/v1/api/ (also /oc-forms/API.md)
// All endpoints are GET. Auth: X-OCF-Api-Key header OR ?api_key= query
// string — some WP security plugins strip custom request headers, so we
// always retry with the query-string variant on 401/403.

const authType = 'apikey';

function trimKey(k) { return (k || '').trim(); }

function apiBase(credentials) {
  if (!credentials.site_url) throw new Error('site_url required');
  return credentials.site_url.trim().replace(/\/$/, '') + '/wp-json/ocf/v1/api';
}

// Authoritative request helper. Tries the X-OCF-Api-Key header first and,
// if it comes back 401/403, retries with ?api_key= in the query string.
// Either method is documented as valid by the plugin.
async function request(credentials, pathname, { params = {}, timeout = 20000 } = {}) {
  const key = trimKey(credentials.api_key);
  if (!key) throw new Error('api_key required');
  const url = `${apiBase(credentials)}${pathname}`;
  const baseConfig = {
    timeout,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'OctoberMI/1.0 (+platform.octobercomms.com)',
    },
    validateStatus: () => true, // we inspect status ourselves
  };

  // 1. Header auth
  let response = await axios.get(url, {
    ...baseConfig,
    headers: { ...baseConfig.headers, 'X-OCF-Api-Key': key },
    params,
  });

  // 2. Query-string fallback on auth errors
  if (response.status === 401 || response.status === 403) {
    response = await axios.get(url, {
      ...baseConfig,
      params: { ...params, api_key: key },
    });
  }

  if (response.status >= 200 && response.status < 300) return response.data;

  const detail = response.data?.message || response.data?.error?.message || response.data?.error || response.statusText;
  const msgDetail = typeof detail === 'string' ? detail : JSON.stringify(detail);
  const err = new Error(`October Forms ${response.status} on ${pathname}: ${msgDetail}`);
  err.status = response.status;
  err.upstreamData = response.data;
  throw err;
}

async function checkTokenValidity(credentials) {
  // The server IP is blocked by the WordPress host so live requests return 401.
  // The Forms tab and form picker call the API directly from the browser, so
  // we only need to confirm the credential fields are present here.
  if (!credentials.site_url) throw new Error('site_url required');
  if (!trimKey(credentials.api_key)) throw new Error('api_key required');
  return true;
}

// Standard pattern — surfaces forms as "accounts" for the config picker.
async function listAccounts(credentials) {
  const data = await request(credentials, '/forms', { timeout: 15000 });
  const forms = Array.isArray(data) ? data : (data?.forms || data?.data || []);
  return forms.map(f => ({
    value: String(f.id),
    label: f.title || `Form ${f.id}`,
    status: f.status,
  }));
}

async function getStats(credentials, formId, from, to) {
  return request(credentials, `/forms/${encodeURIComponent(formId)}/stats`, { params: { from, to } });
}

async function getFunnel(credentials, formId, from, to) {
  return request(credentials, `/forms/${encodeURIComponent(formId)}/funnel`, { params: { from, to } });
}

async function getTimeseries(credentials, formId, from, to) {
  return request(credentials, `/forms/${encodeURIComponent(formId)}/timeseries`, { params: { from, to } });
}

async function getSubmissions(credentials, formId, params = {}) {
  const { from, to, status, limit, offset } = params;
  const query = {};
  if (from) query.from = from;
  if (to) query.to = to;
  if (status) query.status = status;
  if (limit != null) query.limit = Math.min(Number(limit) || 50, 500);
  if (offset != null) query.offset = Number(offset) || 0;
  return request(credentials, `/forms/${encodeURIComponent(formId)}/submissions`, { params: query, timeout: 30000 });
}

async function getSubmission(credentials, submissionId) {
  return request(credentials, `/submissions/${encodeURIComponent(submissionId)}`);
}

// fetchData is called by the report data collector. Uses the configured
// form_id (config.value) to pull /stats, /funnel and /timeseries — those
// three give us all the metrics report templates need, and far less
// payload than enumerating every submission.
async function fetchData(credentials, params) {
  const { startDate, endDate, formId } = params;
  const result = {
    period: { start: startDate, end: endDate },
    form_id: formId || null,
    stats: null,
    funnel: null,
    timeseries: null,
    summary: { total_submissions: 0, completes: 0, starts: 0, views: 0, overall_conversion: 0 },
    fetch_errors: [],
  };

  if (!formId) {
    try {
      const data = await request(credentials, '/forms');
      const forms = Array.isArray(data) ? data : (data?.forms || data?.data || []);
      result.forms_available = forms.map(f => ({ id: f.id, title: f.title }));
      result.fetch_errors.push('No form selected — pick a form in the connector config.');
    } catch (err) {
      result.fetch_errors.push(`forms list: ${err.message}`);
    }
    return result;
  }

  try {
    result.stats = await getStats(credentials, formId, startDate, endDate);
    const s = result.stats || {};
    result.summary = {
      total_submissions: parseInt(s.completes || 0) + parseInt(s.partials || 0),
      completes: parseInt(s.completes || 0),
      partials: parseInt(s.partials || 0),
      starts: parseInt(s.starts || 0),
      views: parseInt(s.views || 0),
      view_to_start_rate: parseFloat(s.view_to_start_rate || 0),
      start_to_complete: parseFloat(s.start_to_complete || 0),
      overall_conversion: parseFloat(s.overall_conversion || 0),
      median_seconds: parseInt(s.median_seconds || 0),
      mean_seconds: parseInt(s.mean_seconds || 0),
    };
  } catch (err) {
    result.fetch_errors.push(`stats: ${err.message}`);
  }

  try { result.funnel = await getFunnel(credentials, formId, startDate, endDate); }
  catch (err) { result.fetch_errors.push(`funnel: ${err.message}`); }

  try { result.timeseries = await getTimeseries(credentials, formId, startDate, endDate); }
  catch (err) { result.fetch_errors.push(`timeseries: ${err.message}`); }

  if (result.fetch_errors.length === 0) delete result.fetch_errors;
  return result;
}

module.exports = {
  authType,
  checkTokenValidity,
  listAccounts,
  fetchData,
  getStats,
  getFunnel,
  getTimeseries,
  getSubmissions,
  getSubmission,
};
