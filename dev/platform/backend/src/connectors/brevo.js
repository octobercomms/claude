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
    if (status === 401) {
      const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
      const key = (credentials.api_key || '').trim();
      // A correct, brand-new v3 key that still 401s is almost never an SMTP key
      // — it's usually an IP allowlist or an unactivated account. Surface
      // Brevo's own reason and detect the common cases instead of guessing.
      if (/^xsmtpsib-/i.test(key)) {
        throw new Error('That looks like an SMTP key (starts "xsmtpsib-"). Use a v3 API key (starts "xkeysib-") from Brevo → Settings → API Keys.');
      }
      if (/\bip\b|whitelist|allowlist|authorised ip|authorized ip/i.test(msg)) {
        throw new Error(`Brevo blocked this server's IP (401). In Brevo → Settings → Security → Authorised IPs, either disable IP restriction or allowlist OMI's outbound IP. Brevo said: "${msg}"`);
      }
      throw new Error(`Brevo rejected the key (401): "${msg}". Check it's a v3 key (starts "xkeysib-") from Settings → API Keys, that the account is fully activated, and that Settings → Security → Authorised IPs permits this server.`);
    }
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
      params: { status: 'sent', limit: 100, offset: 0, sort: 'desc' },
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
      statistics: c.statistics?.globalStats || c.statistics || null,
    }));
    result.total_campaigns = filtered.length;

    // Aggregate performance for the period from each campaign's own stats.
    // Derived here rather than from /smtp/statistics/aggregatedReport, which
    // measures transactional email — a different dataset that is not always
    // enabled on the account and was returning 400 on marketing-only accounts.
    const agg = {};
    for (const c of filtered) {
      const g = c.statistics?.globalStats || {};
      for (const [k, v] of Object.entries(g)) {
        if (typeof v === 'number') agg[k] = (agg[k] || 0) + v;
      }
    }
    result.aggregated_stats = agg;
  } catch (err) {
    const code = err.response?.data?.code;
    const detail = err.response?.data?.message || err.message;
    result.fetch_errors.push(`campaigns: ${code ? `[${code}] ` : ''}${detail}`);
    result.campaigns = [];
    result.total_campaigns = 0;
  }

  if (result.fetch_errors.length === 0) delete result.fetch_errors;
  return result;
}

module.exports = { authType, checkTokenValidity, listAccounts, fetchData };
