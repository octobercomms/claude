// Client strategy playbooks — a library of stage × business-type marketing
// strategies (summary + phased checklist), assigned to a client from their
// Setup type/stage, surfaced as a checkable checklist on the dashboard, and
// optionally tailored to the client by Claude. See migration 101.

const pool = require('../db');
const claudeService = require('./claude');
const crypto = require('crypto');

const BUSINESS_TYPES = [
  { value: 'retail',     label: 'Retail / e-commerce' },
  { value: 'service',    label: 'Service business' },
  { value: 'b2b',        label: 'B2B' },
  { value: 'local',      label: 'Local business' },
];
const LIFECYCLE_STAGES = [
  { value: 'launch',      label: 'Launch — getting to market' },
  { value: 'growth',      label: 'Growth — scaling demand' },
  { value: 'established', label: 'Established — optimise & retain' },
  { value: 'maturity',    label: 'Maturity — defend & reinvent' },
];

// ── Seed library ─────────────────────────────────────────────────────────────
// A representative starter set grounded in lifecycle marketing theory. The AM
// can tailor a client's copy with Claude, and (later) edit the library itself.
const SEED = [
  {
    name: 'Retail · Launch', business_type: 'retail', lifecycle_stage: 'launch',
    summary: 'Build awareness and prove product–market fit. Win the first cohort of buyers, capture data, and learn what converts before scaling spend.',
    phases: [
      { title: 'Foundations', items: ['Define the ideal customer + 2–3 buying occasions', 'Nail positioning & the hero offer', 'Install analytics + conversion tracking (GA4, pixels)', 'Set up email/SMS capture with a welcome flow'] },
      { title: 'Demand', items: ['Launch a tight paid-social test (3–5 creatives)', 'Seed founder/UGC content + first reviews', 'Run a launch promo / first-order incentive', 'Outreach to micro-influencers in the niche'] },
      { title: 'Learn', items: ['Review CAC vs AOV weekly', 'Identify the winning creative + audience', 'Fix the biggest funnel drop-off (CRO)', 'Decide what to scale next month'] },
    ],
  },
  {
    name: 'Retail · Growth', business_type: 'retail', lifecycle_stage: 'growth',
    summary: 'Scale what works profitably. Expand winning channels, raise AOV and repeat rate, and build a content + retention engine.',
    phases: [
      { title: 'Scale acquisition', items: ['Scale winning paid campaigns; add a second channel', 'Systematise creative testing (weekly batch)', 'Stand up SEO/content for high-intent terms', 'Launch a referral / affiliate motion'] },
      { title: 'Raise value', items: ['Add bundles / cross-sell to lift AOV', 'Build post-purchase + win-back email flows', 'Introduce a loyalty or subscribe-and-save offer', 'Optimise the PDP + checkout for conversion'] },
      { title: 'Operate', items: ['Weekly KPI review: CAC, ROAS, repeat rate', 'Forecast inventory against demand', 'Tighten attribution & reporting'] },
    ],
  },
  {
    name: 'Retail · Maturity', business_type: 'retail', lifecycle_stage: 'maturity',
    summary: 'Defend share and reignite growth. Maximise lifetime value, protect margins, and find the next product/market or channel.',
    phases: [
      { title: 'Defend & retain', items: ['Double down on retention + loyalty economics', 'Win-back lapsed customers with segmented offers', 'Protect brand search & top SKUs', 'Audit margin & discount dependency'] },
      { title: 'Reinvent', items: ['Test a new product line or category', 'Enter a new channel (marketplace / wholesale / retail)', 'Refresh brand + creative to a new audience', 'Pilot a community or content franchise'] },
    ],
  },
  {
    name: 'Service · Launch', business_type: 'service', lifecycle_stage: 'launch',
    summary: 'Generate qualified leads and prove the offer. Build trust signals, a simple lead engine, and a tight follow-up so early enquiries convert.',
    phases: [
      { title: 'Foundations', items: ['Define the ICP + the core problem you solve', 'Productise the offer + clear pricing', 'Build a high-converting landing page + lead form', 'Set up lead tracking + a fast follow-up SLA'] },
      { title: 'Lead generation', items: ['Stand up Google Business Profile + reviews', 'Launch search/intent ads for buying keywords', 'Start targeted outreach (email/LinkedIn)', 'Publish 2–3 proof assets (case study, FAQ)'] },
      { title: 'Convert', items: ['Tighten the enquiry → consult → proposal flow', 'Add testimonials + guarantees to reduce risk', 'Review lead quality & cost weekly', 'Ask every happy client for a review/referral'] },
    ],
  },
  {
    name: 'Service · Growth', business_type: 'service', lifecycle_stage: 'growth',
    summary: 'Scale lead flow and conversion without dropping quality. Build authority, systematise sales, and turn clients into a referral engine.',
    phases: [
      { title: 'Scale demand', items: ['Scale the channel(s) with the best lead quality', 'Build authority content / SEO for the niche', 'Add a second outbound or partnership channel', 'Run webinars / lead magnets for the pipeline'] },
      { title: 'Systematise sales', items: ['Document the sales process + objection handling', 'Add nurture sequences for slow leads', 'Track pipeline stages + conversion by source', 'Introduce tiered packages / retainers'] },
      { title: 'Retain & refer', items: ['Build an onboarding + results-reporting rhythm', 'Formalise a referral programme', 'Upsell existing clients into more services'] },
    ],
  },
  {
    name: 'Service · Maturity', business_type: 'service', lifecycle_stage: 'maturity',
    summary: 'Protect the book and find new growth. Deepen accounts, raise prices on value, and open a new segment or productised offering.',
    phases: [
      { title: 'Defend & deepen', items: ['Map account health + churn risk; intervene early', 'Raise prices in line with demonstrated value', 'Deepen retainers with new service lines', 'Protect brand + reputation (reviews, PR)'] },
      { title: 'New growth', items: ['Productise a service into a scalable offer', 'Enter an adjacent segment or vertical', 'Build thought-leadership / partnerships', 'Test a lower-touch / self-serve tier'] },
    ],
  },
];

async function ensureSeeded() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM strategy_templates');
  if (rows[0].n > 0) return;
  for (const t of SEED) {
    await pool.query(
      `INSERT INTO strategy_templates (name, business_type, lifecycle_stage, summary, phases, is_seed)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [t.name, t.business_type, t.lifecycle_stage, t.summary, JSON.stringify(t.phases)]
    );
  }
}

// ── Library ──────────────────────────────────────────────────────────────────
async function listTemplates() {
  await ensureSeeded();
  const { rows } = await pool.query('SELECT * FROM strategy_templates ORDER BY business_type, lifecycle_stage, name');
  return rows;
}

async function matchTemplate(businessType, lifecycleStage) {
  await ensureSeeded();
  const { rows } = await pool.query(
    `SELECT * FROM strategy_templates
      WHERE business_type = $1 AND lifecycle_stage = $2
      ORDER BY is_seed DESC, id ASC LIMIT 1`,
    [businessType, lifecycleStage]
  );
  return rows[0] || null;
}

// ── Per-client strategy ──────────────────────────────────────────────────────
function withIds(phases) {
  return (phases || []).map(p => ({
    title: p.title,
    items: (p.items || []).map(it => {
      const text = typeof it === 'string' ? it : it.text;
      return { id: crypto.randomBytes(6).toString('hex'), text, done: false, note: '' };
    }),
  }));
}

// Assign a template to a client (explicit id, or auto-matched from type+stage)
// and snapshot its phases into the client's checklist. Also records the
// type/stage on the client.
async function assignToClient(clientId, { templateId, businessType, lifecycleStage }) {
  let template = null;
  if (templateId) {
    const { rows } = await pool.query('SELECT * FROM strategy_templates WHERE id = $1', [templateId]);
    template = rows[0] || null;
  } else if (businessType && lifecycleStage) {
    template = await matchTemplate(businessType, lifecycleStage);
  }
  if (!template) { const e = new Error('No strategy template matches that business type + stage yet.'); e.status = 400; throw e; }

  if (businessType || lifecycleStage) {
    await pool.query(
      'UPDATE clients SET business_type = COALESCE($2, business_type), lifecycle_stage = COALESCE($3, lifecycle_stage) WHERE id = $1',
      [clientId, businessType || null, lifecycleStage || null]
    );
  }
  await pool.query(
    `INSERT INTO client_strategy (client_id, template_id, summary, phases)
       VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id) DO UPDATE SET template_id = $2, summary = $3, phases = $4, updated_at = NOW()`,
    [clientId, template.id, template.summary, JSON.stringify(withIds(template.phases))]
  );
  return getClientStrategy(clientId);
}

async function getClientStrategy(clientId) {
  const { rows } = await pool.query(
    `SELECT cs.*, st.name AS template_name, st.business_type, st.lifecycle_stage
       FROM client_strategy cs LEFT JOIN strategy_templates st ON st.id = cs.template_id
      WHERE cs.client_id = $1`,
    [clientId]
  );
  if (!rows.length) return null;
  const s = rows[0];
  const total = (s.phases || []).reduce((n, p) => n + (p.items || []).length, 0);
  const done = (s.phases || []).reduce((n, p) => n + (p.items || []).filter(i => i.done).length, 0);
  return { ...s, progress: { done, total } };
}

async function setItem(clientId, itemId, { done, note }) {
  const cur = await getClientStrategy(clientId);
  if (!cur) { const e = new Error('No strategy assigned'); e.status = 404; throw e; }
  let found = false;
  const phases = (cur.phases || []).map(p => ({
    ...p,
    items: (p.items || []).map(it => {
      if (it.id !== itemId) return it;
      found = true;
      return { ...it, done: done === undefined ? it.done : !!done, note: note === undefined ? it.note : String(note).slice(0, 2000) };
    }),
  }));
  if (!found) { const e = new Error('Checklist item not found'); e.status = 404; throw e; }
  await pool.query('UPDATE client_strategy SET phases = $2, updated_at = NOW() WHERE client_id = $1', [clientId, JSON.stringify(phases)]);
  return getClientStrategy(clientId);
}

// ── Claude tailoring ─────────────────────────────────────────────────────────
function parseJson(raw) {
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error('Tailoring returned malformed JSON.'); }
}

// Adapt the client's checklist to their specifics. Preserves checked state for
// items whose text is unchanged; new/edited items start unchecked.
async function tailorWithClaude(clientId) {
  const cur = await getClientStrategy(clientId);
  if (!cur) { const e = new Error('Assign a strategy first.'); e.status = 400; throw e; }
  const { rows } = await pool.query('SELECT name, briefing_field, monthly_focus, domain FROM clients WHERE id = $1', [clientId]);
  const c = rows[0] || {};
  const skeleton = (cur.phases || []).map(p => ({ title: p.title, items: (p.items || []).map(i => i.text) }));

  const raw = await claudeService.callClaude({
    max_tokens: 3000,
    system: 'You adapt a marketing-strategy checklist to a specific client. Keep the phase structure and the strategic intent; make each item concrete and specific to this client (their offer, audience, channels). Don\'t add generic filler. British English. JSON only — no prose, no fences.',
    user: `Client: ${c.name}${c.domain ? ` (${c.domain})` : ''}
About: ${c.briefing_field || '(no brief)'}
This month's focus: ${c.monthly_focus || '(none)'}
Strategy: ${cur.template_name || ''} — ${cur.summary || ''}

Current checklist:
${JSON.stringify(skeleton)}

Tailor it to this client. Return ONLY:
{"summary":"a 1–2 sentence strategy summary tailored to this client","phases":[{"title":"keep the phase titles","items":["specific, client-tailored actions"]}]}`,
    feature: 'client_strategy_tailor',
    clientId,
  });
  const out = parseJson(raw);
  if (!Array.isArray(out.phases)) throw new Error('Tailoring did not return phases.');

  // Preserve done/note where the item text is unchanged.
  const prevByText = new Map();
  for (const p of cur.phases || []) for (const it of p.items || []) prevByText.set(it.text.trim().toLowerCase(), it);
  const phases = out.phases.map(p => ({
    title: p.title,
    items: (p.items || []).map(text => {
      const prev = prevByText.get(String(text).trim().toLowerCase());
      return { id: crypto.randomBytes(6).toString('hex'), text: String(text), done: prev?.done || false, note: prev?.note || '' };
    }),
  }));
  await pool.query('UPDATE client_strategy SET summary = $2, phases = $3, updated_at = NOW() WHERE client_id = $1',
    [clientId, out.summary || cur.summary, JSON.stringify(phases)]);
  return getClientStrategy(clientId);
}

module.exports = {
  BUSINESS_TYPES, LIFECYCLE_STAGES,
  listTemplates, matchTemplate,
  assignToClient, getClientStrategy, setItem, tailorWithClaude,
};
