// "Dig deeper" lead discovery — paid B2B data providers for when the free
// scrape/Serper path doesn't surface enough companies. Three pluggable
// providers (Apollo, People Data Labs, Hunter Discover), each inert until its
// API key is set in platform settings. Every adapter takes the same structured
// query and returns contacts in the outreach /contacts/bulk shape, so results
// flow into the existing find → rank → add path unchanged.
//
// Note: these hit live third-party APIs that can't be exercised here. The
// endpoints/params follow each provider's current docs; first real runs may
// want a small tweak per provider — the adapters are isolated to make that easy.

const axios = require('axios');
const { getSetting } = require('../utils/settings');
const hunter = require('./hunter');

// Apollo removed from OMI — Hunter + People Data Labs cover deep-find.
const PROVIDERS = ['peopledatalabs', 'hunter'];

async function keyFor(provider) {
  if (provider === 'peopledatalabs') return getSetting('PEOPLEDATALABS_API_KEY');
  if (provider === 'hunter') return getSetting('HUNTER_API_KEY');
  return null;
}

// Which providers are configured (have a key) — the UI only offers these.
async function availableProviders() {
  const out = [];
  for (const p of PROVIDERS) { if (await keyFor(p)) out.push(p); }
  return out;
}

const arr = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map(s => String(s).trim()).filter(Boolean);

function contact(c) {
  const name = (c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '').trim() || null;
  const email = c.email && /@/.test(c.email) && !/email_not_unlocked|not_unlocked/i.test(c.email) ? String(c.email).trim() : null;
  if (!name && !email) return null;
  return {
    name, first_name: c.first_name || null, last_name: c.last_name || null,
    email, company: c.company || null, role: c.role || c.title || null, title: c.title || c.role || null,
    location: c.location || null, linkedin_url: c.linkedin_url || null, website: c.website || null,
    source: c.source, confidence: c.confidence || null,
  };
}

// ── Apollo ───────────────────────────────────────────────────────────────────
async function apolloSearch(key, q) {
  const body = {
    page: 1, per_page: Math.min(25, q.limit || 25),
    person_titles: arr(q.titles),
    person_locations: arr(q.location),
    q_organization_keyword_tags: arr(q.industry || q.keywords),
    organization_num_employees_ranges: arr(q.employees),
  };
  const { data } = await axios.post('https://api.apollo.io/v1/mixed_people/search', body, {
    headers: { 'X-Api-Key': key, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    timeout: 25000,
  });
  return (data.people || []).map(p => contact({
    name: p.name, first_name: p.first_name, last_name: p.last_name, email: p.email,
    title: p.title, company: p.organization?.name, website: p.organization?.website_url,
    location: [p.city, p.state, p.country].filter(Boolean).join(', ') || null,
    linkedin_url: p.linkedin_url, source: 'apollo', confidence: p.email ? 'high' : 'medium',
  })).filter(Boolean);
}

// ── People Data Labs ─────────────────────────────────────────────────────────
async function pdlSearch(key, q) {
  const must = [];
  for (const t of arr(q.titles)) must.push({ match: { job_title: t } });
  for (const l of arr(q.location)) must.push({ match: { location_names: l } });
  for (const i of arr(q.industry)) must.push({ match: { job_company_industry: i } });
  const { data } = await axios.post('https://api.peopledatalabs.com/v5/person/search', {
    query: { bool: { must } }, size: Math.min(25, q.limit || 25),
  }, { headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' }, timeout: 25000 });
  return (data.data || []).map(p => contact({
    name: p.full_name, first_name: p.first_name, last_name: p.last_name,
    email: p.work_email || (p.emails && p.emails[0]?.address),
    title: p.job_title, company: p.job_company_name, website: p.job_company_website,
    location: p.location_name, linkedin_url: p.linkedin_url ? `https://${p.linkedin_url}` : null,
    source: 'peopledatalabs', confidence: p.work_email ? 'high' : 'low',
  })).filter(Boolean);
}

// ── Hunter Discover ──────────────────────────────────────────────────────────
// Discover companies by criteria, then pull contacts for the top few via the
// existing domain-search. Capped tight — each company is an extra API call.
async function hunterDiscover(key, q) {
  const body = {};
  const kw = arr(q.industry || q.keywords).join(' ');
  if (kw) body.query = kw;
  if (arr(q.location).length) body.headquarters_location = arr(q.location);
  if (arr(q.employees).length) body.headcount = arr(q.employees)[0];
  const { data } = await axios.post(`https://api.hunter.io/v2/discover?api_key=${encodeURIComponent(key)}`, body, {
    headers: { 'Content-Type': 'application/json' }, timeout: 25000,
  });
  const companies = (data.data || data.companies || []).slice(0, 5);
  const out = [];
  for (const co of companies) {
    const domain = co.domain || co.organization?.domain;
    if (!domain) continue;
    try {
      const res = await hunter.domainSearch(domain);
      for (const c of (res.contacts || res.emails || [])) {
        const norm = contact({
          name: c.name, first_name: c.first_name, last_name: c.last_name, email: c.email || c.value,
          title: c.role || c.position, company: co.organization || domain, website: `https://${domain}`,
          source: 'hunter', confidence: c.confidence ? 'high' : 'medium',
        });
        if (norm) out.push(norm);
      }
    } catch { /* skip a dead domain */ }
  }
  return out;
}

// Dispatch a deep-find to one provider. Throws a clear error when unconfigured.
async function deepFind({ provider, query }) {
  if (!PROVIDERS.includes(provider)) throw badReq(`Unknown provider: ${provider}`);
  const key = await keyFor(provider);
  if (!key) throw badReq(`${provider} isn't configured — add its API key in Settings → Integrations.`);
  const q = query || {};
  let contacts;
  if (provider === 'apollo') contacts = await apolloSearch(key, q);
  else if (provider === 'peopledatalabs') contacts = await pdlSearch(key, q);
  else contacts = await hunterDiscover(key, q);
  // Dedupe by email-or-name.
  const seen = new Set();
  return contacts.filter(c => {
    const k = (c.email || c.name || '').toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function badReq(msg) { const e = new Error(msg); e.status = 400; return e; }

module.exports = { PROVIDERS, availableProviders, deepFind };
