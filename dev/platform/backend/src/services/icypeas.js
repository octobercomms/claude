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

// Primary find — people at a domain optionally filtered by job titles.
// Falls back to per-person email-discovery for any lead returned without
// an email address.
async function findPeople(domain, jobTitles = [], size = 25) {
  const apiKey = await getSetting('ICYPEAS_API_KEY');
  if (!apiKey) throw new Error('Icypeas API key not configured — add it in Settings → October Outreach.');
  const trimmed = apiKey.trim();

  const query = { currentCompanyWebsite: { include: [domain] } };
  if (jobTitles.length) query.currentJobTitle = { include: jobTitles };

  let data;
  try {
    data = await request(trimmed, '/find-people', { query, pagination: { size } });
  } catch (err) {
    // Endpoint may be unavailable for some accounts — fall through with no results.
    return { domain, contacts: [], total_found: 0, error: err.message };
  }

  const leads = data.leads || data.results || data.data || [];
  const contacts = [];
  for (const lead of leads) {
    if (typeof lead !== 'object' || !lead) continue;
    const firstName = lead.firstname || lead.firstName || '';
    const lastName = lead.lastname || lead.lastName || '';
    let email = lead.email || lead.workEmail || lead.work_email || '';
    if (!email && firstName && lastName) {
      email = await emailDiscovery(trimmed, firstName, lastName, domain);
    }
    if (!email) continue;
    contacts.push({
      email: email.toLowerCase(),
      first_name: firstName,
      last_name: lastName,
      name: [firstName, lastName].filter(Boolean).join(' ').trim(),
      company: lead.currentCompany || lead.companyName || domain,
      role: lead.currentJobTitle || lead.title || '',
      title: lead.currentJobTitle || lead.title || '',
      linkedin_url: lead.linkedinUrl || lead.linkedin || '',
      website: domain,
      confidence: lead.confidence ?? 70,
      source: 'icypeas',
    });
  }
  return { domain, contacts, total_found: contacts.length };
}

// Resolve an email for a known first/last + domain when find-people returns
// a lead without an address. Returns the email string or '' on failure.
async function emailDiscovery(apiKey, firstName, lastName, domain) {
  try {
    const data = await request(apiKey, '/email-discovery', {
      firstname: firstName, lastname: lastName, domainOrCompany: domain,
    });
    return data?.email || data?.result?.email || data?.data?.email || '';
  } catch {
    return '';
  }
}

module.exports = { domainSearch, findPeople, emailDiscovery };
