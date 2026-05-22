const axios = require('axios');
const { getSetting } = require('../utils/settings');

// Hunter.io domain search — finds published email addresses for a company
// domain. Ported from the October Outreach plugin's OO_Hunter::domain_search.
async function domainSearch(domain, limit = 10) {
  const apiKey = await getSetting('HUNTER_API_KEY');
  if (!apiKey) throw new Error('Hunter API key not configured — add it in Settings → October Outreach.');

  let data;
  try {
    const resp = await axios.get('https://api.hunter.io/v2/domain-search', {
      params: { domain, limit, api_key: apiKey.trim() },
      timeout: 30000,
    });
    data = resp.data;
  } catch (err) {
    const msg = err.response?.data?.errors?.[0]?.details || err.response?.data?.error || err.message;
    throw new Error(`Hunter.io: ${msg}`);
  }

  const result = data.data || data;
  const contacts = (result.emails || [])
    .filter(e => e.value)
    .map(e => ({
      email: e.value,
      name: [e.first_name, e.last_name].filter(Boolean).join(' ').trim(),
      company: result.organization || '',
      role: e.position || '',
      website: domain,
      confidence: e.confidence ?? null,
      source: 'hunter.io',
    }));

  return {
    domain,
    company: result.organization || '',
    contacts,
    total_found: result.meta?.total ?? contacts.length,
  };
}

module.exports = { domainSearch };
