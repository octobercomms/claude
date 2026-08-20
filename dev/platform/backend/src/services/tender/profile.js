// The October bid profile — a single markdown doc (id = 1) that every bid
// workspace reads, so learning compounds across bids. The account lead edits it,
// and the agent is told it may suggest additions (won/lost notes, reusable
// boilerplate) which the lead pastes in.

const pool = require('../../db');

async function get() {
  const { rows } = await pool.query('SELECT profile_md, company_json, updated_at FROM tender_org_profile WHERE id = 1');
  const r = rows[0] || {};
  return { profile_md: r.profile_md || '', company: r.company_json || {}, updated_at: r.updated_at || null };
}

// Structured company details (SQ facts a tender demands) — stored separately so
// the agent uses them verbatim.
async function setCompany(company) {
  const c = company && typeof company === 'object' && !Array.isArray(company) ? company : {};
  const { rows } = await pool.query(
    `INSERT INTO tender_org_profile (id, company_json, updated_at) VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET company_json = EXCLUDED.company_json, updated_at = NOW()
     RETURNING company_json`,
    [JSON.stringify(c)]
  );
  return { company: rows[0].company_json || {} };
}

// The ordered field set a bid needs — shared shape for the form and the prompt.
const COMPANY_FIELDS = [
  ['legal_name', 'Legal (registered) name'],
  ['trading_name', 'Trading name'],
  ['company_number', 'Company registration number'],
  ['vat_number', 'VAT number'],
  ['company_type', 'Company type (Ltd, LLP…)'],
  ['incorporation_date', 'Date of incorporation'],
  ['registered_address', 'Registered office address'],
  ['trading_address', 'Trading address'],
  ['directors', 'Directors / owners / PSCs'],
  ['employees', 'Number of employees'],
  ['turnover', 'Annual turnover (last 3 years)'],
  ['duns', 'DUNS number'],
  ['website', 'Website'],
  ['bid_contact', 'Bid contact (name, email, phone)'],
  ['insurances', 'Insurances (EL / PL / PI — levels & insurer)'],
  ['accreditations', 'Accreditations (Cyber Essentials, ISO…)'],
  ['policies', 'Policies held (E&D, H&S, Environmental, Modern Slavery, GDPR, Anti-bribery…)'],
  ['additional', 'Anything else a tender asks for'],
];

// Render the company facts for the system prompt — labelled, verbatim.
function companyBlock(company) {
  if (!company || !Object.keys(company).length) {
    return '(not provided — if a tender needs a company number, VAT number, insurance level, policy or similar, tell the lead exactly what to add on the Tenders page; never invent these)';
  }
  const lines = COMPANY_FIELDS
    .map(([k, label]) => (company[k] ? `- ${label}: ${company[k]}` : null))
    .filter(Boolean);
  return lines.length ? lines.join('\n') : '(none provided)';
}

async function set(profileMd) {
  const md = typeof profileMd === 'string' ? profileMd : '';
  const { rows } = await pool.query(
    `INSERT INTO tender_org_profile (id, profile_md, updated_at) VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET profile_md = EXCLUDED.profile_md, updated_at = NOW()
     RETURNING profile_md, updated_at`,
    [md]
  );
  return rows[0];
}

// Append a learned snippet to the profile (used by "Learn from this bid").
async function append(snippet) {
  const s = (snippet || '').trim();
  if (!s) return get();
  const cur = (await get()).profile_md || '';
  return set(cur ? `${cur}\n\n${s}` : s);
}

module.exports = { get, set, append, setCompany, companyBlock, COMPANY_FIELDS };
