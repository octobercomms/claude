const axios = require('axios');

const authType = 'apikey';

function getHeaders(credentials) {
  if (!credentials.api_key) throw new Error('api_key required');
  if (!credentials.site_url) throw new Error('site_url required');
  return { 'X-OCF-Api-Key': credentials.api_key.trim(), Accept: 'application/json' };
}

function apiBase(credentials) {
  return credentials.site_url.replace(/\/$/, '') + '/wp-json/ocf/v1/api';
}

async function checkTokenValidity(credentials) {
  const headers = getHeaders(credentials);
  try {
    const { data } = await axios.get(`${apiBase(credentials)}/forms`, { headers, timeout: 15000 });
    if (!Array.isArray(data) && !Array.isArray(data?.data) && !Array.isArray(data?.forms)) {
      throw new Error('Unexpected response format from October Forms API');
    }
    return true;
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.message || err.response?.data?.error || err.message;
    if (status === 401 || status === 403) throw new Error(`October Forms API key invalid or unauthorised (${status})`);
    if (status === 404) throw new Error(`October Forms API not found — check the site URL (${credentials.site_url})`);
    throw new Error(`October Forms error (${status || 'network'}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
}

async function fetchData(credentials, params) {
  const { startDate, endDate } = params;
  const headers = getHeaders(credentials);
  const base = apiBase(credentials);
  const result = {
    period: { start: startDate, end: endDate },
    forms: [],
    submissions: [],
    summary: { total_forms: 0, total_submissions: 0, active_forms: 0, per_form: [] },
    fetch_errors: [],
  };

  // Fetch forms list
  try {
    const { data } = await axios.get(`${base}/forms`, { headers, timeout: 15000 });
    result.forms = Array.isArray(data) ? data : (data?.data || data?.forms || []);
    result.summary.total_forms = result.forms.length;
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    result.fetch_errors.push(`forms: ${detail}`);
  }

  // Fetch submissions — try with date params first, fall back to all + filter locally
  try {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59);

    const dateParams = { from: startDate, to: endDate };
    const { data } = await axios.get(`${base}/submissions`, {
      headers,
      params: dateParams,
      timeout: 30000,
    });

    let subs = Array.isArray(data) ? data : (data?.data || data?.submissions || []);

    // If the API ignored our date params, filter locally
    if (subs.length > 0 && subs[0]?.created_at) {
      const beforeFilter = subs.length;
      subs = subs.filter(s => {
        const d = s.created_at ? new Date(s.created_at) : null;
        return d && d >= start && d <= end;
      });
      // If filtering had no effect (all passed or count equals fetched), trust the API date params
      if (subs.length === beforeFilter) {
        // API returned only data in range — no further filtering needed
      }
    }

    result.submissions = subs;
    result.summary.total_submissions = subs.length;

    // Compute per-form breakdown
    const formMap = {};
    for (const sub of subs) {
      const fid = String(sub.form_id || sub.form || '');
      const ftitle = sub.form_title || sub.form_name || (result.forms.find(f => String(f.id) === fid)?.title) || fid || 'Unknown Form';
      if (!formMap[fid]) formMap[fid] = { form_id: fid, form_title: ftitle, count: 0 };
      formMap[fid].count++;
    }
    result.summary.per_form = Object.values(formMap).sort((a, b) => b.count - a.count);
    result.summary.active_forms = result.summary.per_form.length;
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    result.fetch_errors.push(`submissions: ${detail}`);
  }

  if (result.fetch_errors.length === 0) delete result.fetch_errors;
  return result;
}

module.exports = { authType, checkTokenValidity, fetchData };
