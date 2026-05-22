const axios = require('axios');
const { getSetting } = require('../utils/settings');

// Ported from the October Outreach plugin's OO_Icypeas.
async function request(apiKey, endpoint, body) {
  try {
    const { data } = await axios.post(`https://app.icypeas.com/api${endpoint}`, body, {
      headers: { 'Content-Type': 'application/json', Authorization: apiKey },
      timeout: 30000,
    });
    if (data && data.success === false) {
      throw new Error(data.message || 'Icypeas returned an error response.');
    }
    return data;
  } catch (err) {
    if (err.response) {
      const d = err.response.data || {};
      if (err.response.status === 401) throw new Error('Icypeas 401 — ' + (d.message || d.error || 'check the API key in Settings'));
      if (err.response.status === 429) throw new Error('Icypeas rate limit exceeded — try again shortly.');
      throw new Error(d.message || `Icypeas error (HTTP ${err.response.status})`);
    }
    throw err;
  }
}

async function domainSearch(domain) {
  const apiKey = await getSetting('ICYPEAS_API_KEY');
  if (!apiKey) throw new Error('Icypeas API key not configured — add it in Settings → October Outreach.');

  const data = await request(apiKey.trim(), '/domain-search', { domainOrCompany: domain });
  const leads = data.leads || data.emails || data.data || [];
  const contacts = [];
  for (const lead of leads) {
    const email = typeof lead === 'string' ? lead : (lead.email || '');
    if (!email) continue;
    contacts.push({
      email,
      name: typeof lead === 'object' ? [lead.firstname, lead.lastname].filter(Boolean).join(' ').trim() : '',
      company: domain,
      role: typeof lead === 'object' ? (lead.title || '') : '',
      website: domain,
      confidence: 70,
      source: 'icypeas',
    });
  }
  return { domain, company: domain, contacts, total_found: contacts.length };
}

module.exports = { domainSearch };
