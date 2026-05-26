const axios = require('axios');

// October Forms — multi-step lead-generation form plugin exposed via a
// read-only JSON API. Each client connector points at one WordPress
// instance (site_url) and one API key, then picks ONE form_id via
// config.value (set via the standard /accounts → /config dance).
//
// API reference: {site_url}/wp-content/plugins/oc-forms/API.md
// All endpoints are GET. Auth header: X-OCF-Api-Key.

const authType = 'apikey';

function getHeaders(credentials) {
  if (!credentials.api_key) throw new Error('api_key required');
  if (!credentials.site_url) throw new Error('site_url required');
  return { 'X-OCF-Api-Key': credentials.api_key.trim(), Accept: 'application/json' };
}

function apiBase(credentials) {
  return credentials.site_url.replace(/\/$/, '') + '/wp-json/ocf/v1/api';
}

function wrapError(err, context) {
  const status = err.response?.status;
  const detail = err.response?.data?.message || err.response?.data?.error || err.message;
  if (status === 401) return new Error(`October Forms API key invalid (401)${context ? ` — ${context}` : ''}`);
  if (status === 403) return new Error(`October Forms API key missing or forbidden (403)${context ? ` — ${context}` : ''}`);
  if (status === 404) return new Error(`October Forms resource not found (404)${context ? ` — ${context}` : ''}`);
  const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
  return new Error(`October Forms error (${status || 'network'})${context ? ` — ${context}` : ''}: ${msg}`);
}

async function checkTokenValidity(credentials) {
  const headers = getHeaders(credentials);
  try {
    await axios.get(`${apiBase(credentials)}/health`, { headers, timeout: 15000 });
    return true;
  } catch (healthErr) {
    // /health may not exist on older versions — fall through to /forms
    try {
      const { data } = await axios.get(`${apiBase(credentials)}/forms`, { headers, timeout: 15000 });
      const forms = Array.isArray(data) ? data : (data?.forms || data?.data || []);
      if (!Array.isArray(forms)) throw new Error('Unexpected response shape from October Forms /forms');
      return true;
    } catch (err) {
      throw wrapError(err, 'check failed');
    }
  }
}

// Standard pattern — surfaces forms as "accounts" for the config picker.
async function listAccounts(credentials) {
  const headers = getHeaders(credentials);
  const { data } = await axios.get(`${apiBase(credentials)}/forms`, { headers, timeout: 15000 });
  const forms = Array.isArray(data) ? data : (data?.forms || data?.data || []);
  return forms.map(f => ({
    value: String(f.id),
    label: f.title || `Form ${f.id}`,
    status: f.status,
  }));
}

async function getStats(credentials, formId, from, to) {
  const headers = getHeaders(credentials);
  const { data } = await axios.get(`${apiBase(credentials)}/forms/${encodeURIComponent(formId)}/stats`, {
    headers, params: { from, to }, timeout: 20000,
  });
  return data;
}

async function getFunnel(credentials, formId, from, to) {
  const headers = getHeaders(credentials);
  const { data } = await axios.get(`${apiBase(credentials)}/forms/${encodeURIComponent(formId)}/funnel`, {
    headers, params: { from, to }, timeout: 20000,
  });
  return data;
}

async function getTimeseries(credentials, formId, from, to) {
  const headers = getHeaders(credentials);
  const { data } = await axios.get(`${apiBase(credentials)}/forms/${encodeURIComponent(formId)}/timeseries`, {
    headers, params: { from, to }, timeout: 20000,
  });
  return data;
}

async function getSubmissions(credentials, formId, params = {}) {
  const headers = getHeaders(credentials);
  const { from, to, status, limit, offset } = params;
  const query = {};
  if (from) query.from = from;
  if (to) query.to = to;
  if (status) query.status = status;
  if (limit != null) query.limit = Math.min(Number(limit) || 50, 500);
  if (offset != null) query.offset = Number(offset) || 0;
  const { data } = await axios.get(`${apiBase(credentials)}/forms/${encodeURIComponent(formId)}/submissions`, {
    headers, params: query, timeout: 30000,
  });
  return data;
}

async function getSubmission(credentials, submissionId) {
  const headers = getHeaders(credentials);
  const { data } = await axios.get(`${apiBase(credentials)}/submissions/${encodeURIComponent(submissionId)}`, {
    headers, timeout: 20000,
  });
  return data;
}

// fetchData is called by the report data collector. Uses the configured
// form_id (config.value) to pull /stats, /funnel and /timeseries — those
// three give us all the metrics report templates need, and far less
// payload than enumerating every submission.
async function fetchData(credentials, params) {
  const { startDate, endDate, formId } = params;
  const headers = getHeaders(credentials);
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
    // No form selected yet — list forms so the report at least surfaces
    // a meaningful "no form configured" diagnostic instead of crashing.
    try {
      const { data } = await axios.get(`${apiBase(credentials)}/forms`, { headers, timeout: 15000 });
      const forms = Array.isArray(data) ? data : (data?.forms || data?.data || []);
      result.forms_available = forms.map(f => ({ id: f.id, title: f.title }));
      result.fetch_errors.push('No form selected — pick a form in the connector config.');
    } catch (err) {
      result.fetch_errors.push(`forms list: ${err.message}`);
    }
    return result;
  }

  // Stats, funnel and timeseries can each fail independently — capture
  // per-endpoint errors so a partial failure still surfaces what we have.
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
