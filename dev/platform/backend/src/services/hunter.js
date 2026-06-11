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

  // Hunter pricing: 50 free / month then ~$0.49 per 100 (Starter plan, 5k
  // credits / $49). Per-call rate ≈ $0.0098. Log so the Cost log shows
  // how much each search costs.
  require('./costLog').recordApiCost({ provider: 'hunter', feature: 'hunter_domain_search', costUsd: 0.0098, meta: { domain, limit } });

  return {
    domain,
    company: result.organization || '',
    contacts,
    total_found: result.meta?.total ?? contacts.length,
  };
}

// Hunter.io email-verifier. Hits the /v2/email-verifier endpoint and
// translates its result into our internal verification taxonomy so the
// rest of the platform doesn't care which provider answered.
//
// Hunter's result string maps to our status as:
//   deliverable  -> valid
//   undeliverable-> invalid
//   risky        -> risky
//   unknown      -> unknown
//
// A "risky" result usually means the catch-all flag is set or the
// address is role-based (info@, sales@). We don't auto-block those —
// the AM can choose to send anyway — but we surface the flag.
async function verifyEmail(email) {
  const apiKey = await getSetting('HUNTER_API_KEY');
  if (!apiKey) throw new Error('Hunter API key not configured — add it in Settings → AI & Email.');

  let data;
  try {
    const resp = await axios.get('https://api.hunter.io/v2/email-verifier', {
      params: { email, api_key: apiKey.trim() },
      timeout: 30000,
    });
    data = resp.data;
  } catch (err) {
    const msg = err.response?.data?.errors?.[0]?.details || err.response?.data?.error || err.message;
    throw new Error(`Hunter.io verifier: ${msg}`);
  }

  const r = data?.data || {};
  const hunterResult = r.result || 'unknown';
  const statusMap = {
    deliverable: 'valid',
    undeliverable: 'invalid',
    risky: 'risky',
    unknown: 'unknown',
  };
  const status = statusMap[hunterResult] || 'unknown';
  // Email verification is also 1 credit ≈ $0.0098 on Starter plan.
  require('./costLog').recordApiCost({ provider: 'hunter', feature: 'hunter_verify_email', costUsd: 0.0098, meta: { email } });

  return {
    status,
    score: typeof r.score === 'number' ? r.score : null,
    provider: 'hunter.io',
    detail: {
      result: hunterResult,
      regexp: r.regexp,
      gibberish: r.gibberish,
      disposable: r.disposable,
      webmail: r.webmail,
      mx_records: r.mx_records,
      smtp_server: r.smtp_server,
      smtp_check: r.smtp_check,
      accept_all: r.accept_all,
      block: r.block,
    },
  };
}

module.exports = { domainSearch, verifyEmail };
