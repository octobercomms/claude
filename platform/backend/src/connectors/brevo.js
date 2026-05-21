const axios = require('axios');

const authType = 'apikey';

function getHeaders(credentials) {
  if (!credentials.api_key) throw new Error('api_key required');
  return { 'api-key': credentials.api_key.trim(), Accept: 'application/json' };
}

async function checkTokenValidity(credentials) {
  const headers = getHeaders(credentials);
  try {
    const { data } = await axios.get('https://api.brevo.com/v3/account', { headers });
    if (!data.email) throw new Error('Invalid Brevo API key — no account returned');
    return true;
  } catch (err) {
    const detail = err.response?.data?.message || err.response?.data?.error || err.message;
    const status = err.response?.status;
    if (status === 401) throw new Error("Brevo API key is invalid or unauthorised (401) — use a v3 API key from Brevo → Settings → API Keys, not an SMTP key");
    throw new Error(`Brevo error (${status || 'network'}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
}

// Brevo contact lists — used for per-client list scoping.
async function listAccounts(credentials) {
  const headers = getHeaders(credentials);
  const { data } = await axios.get('https://api.brevo.com/v3/contacts/lists', {
    headers,
    params: { limit: 50, offset: 0, sort: 'desc' },
  });
  return (data.lists || []).map(l => ({ value: String(l.id), label: l.name }));
}

async function fetchData(credentials, params) {
  const { startDate, endDate, brevoListId, brevoAutomation } = params;
  const headers = getHeaders(credentials);
  const result = { period: { start: startDate, end: endDate }, fetch_errors: [] };
  if (brevoListId || brevoAutomation) {
    result.scope = { list_id: brevoListId || null, automation: brevoAutomation || null };
  }

  // Fetch sent campaigns (no date filter — Brevo returns them sorted by sentDate desc)
  try {
    const { data } = await axios.get('https://api.brevo.com/v3/emailCampaigns', {
      headers,
      params: { status: 'sent', limit: 50, offset: 0, sort: 'desc' },
    });
    const campaigns = data.campaigns || [];
    // Filter to period manually
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59);
    let filtered = campaigns.filter(c => {
      const sent = c.sentDate ? new Date(c.sentDate) : null;
      return sent && sent >= start && sent <= end;
    });
    // Optional per-client scoping to a single Brevo list
    if (brevoListId) {
      const wantList = Number(brevoListId);
      filtered = filtered.filter(c => Array.isArray(c.recipients?.listIds) && c.recipients.listIds.includes(wantList));
    }
    result.campaigns = filtered.map(c => ({
      name: c.name,
      subject: c.subject,
      sent_date: c.sentDate,
      statistics: c.statistics,
    }));
    result.total_campaigns = filtered.length;
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    result.fetch_errors.push(`campaigns: ${detail}`);
    result.campaigns = [];
    result.total_campaigns = 0;
  }

  // Fetch aggregated SMTP stats
  try {
    const { data } = await axios.get('https://api.brevo.com/v3/smtp/statistics/aggregatedReport', {
      headers,
      params: { startDate, endDate },
    });
    result.aggregated_stats = data;
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    result.fetch_errors.push(`aggregated_stats: ${detail}`);
  }

  if (result.fetch_errors.length === 0) delete result.fetch_errors;
  return result;
}

module.exports = { authType, checkTokenValidity, listAccounts, fetchData };
