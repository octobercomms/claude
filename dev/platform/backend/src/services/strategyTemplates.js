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
// Structured to PR Smith's SOSTAC® planning framework — the six phases every
// template follows: Situation, Objectives, Strategy, Tactics, Action, Control.
// Items are tailored per business type × lifecycle stage. The AM tailors a
// client's copy with Claude; admins edit the library in Settings.
const SOSTAC = ['Situation Analysis', 'Objectives', 'Strategy', 'Tactics', 'Action', 'Control'];
const sostac = (sa, o, st, ta, ac, co) => SOSTAC.map((title, i) => ({ title, items: [sa, o, st, ta, ac, co][i] }));

const SEED = [
  {
    name: 'Retail · Launch', business_type: 'retail', lifecycle_stage: 'launch',
    summary: 'SOSTAC plan to take the product to market: prove product–market fit, win the first buyers, and learn what converts before scaling spend.',
    phases: sostac(
      ['Audit the market, category & key competitors', 'Define the ideal customer + 2–3 buying occasions', 'Baseline: traffic, conversion, AOV, channels available'],
      ['Set SMART launch goals (first-90-day revenue / orders)', 'Define target CAC and a break-even ROAS', 'Agree the data goals (email list size, first reviews)'],
      ['Positioning + the hero offer / launch promotion', 'Segment & target the first audience to win', 'Channel priority: where the first buyers actually are'],
      ['Install GA4 + pixels and email/SMS capture + welcome flow', 'Launch a tight paid-social creative test (3–5 variants)', 'Seed founder/UGC content + first-review push'],
      ['Build the launch calendar + owners and budget', 'Brief creative & set the weekly test cadence', 'Set the first-order incentive live'],
      ['Weekly review: CAC vs AOV, winning creative/audience', 'Fix the biggest funnel drop-off (CRO)', 'Decide what to scale next month'],
    ),
  },
  {
    name: 'Retail · Growth', business_type: 'retail', lifecycle_stage: 'growth',
    summary: 'SOSTAC plan to scale profitably: expand winning channels, raise AOV and repeat rate, and build a content + retention engine.',
    phases: sostac(
      ['Review channel performance + unit economics to date', 'Identify winning creatives, audiences & SKUs', 'Map the gaps competitors are exploiting'],
      ['Set growth targets: revenue, ROAS, repeat rate, LTV', 'Define an AOV uplift target', 'Set a new-customer vs returning revenue split'],
      ['Decide which channels to scale + the second channel', 'Retention strategy: lifecycle flows + loyalty', 'Pricing & merchandising approach to lift AOV'],
      ['Scale winning paid campaigns; systematise weekly creative tests', 'Stand up SEO/content for high-intent terms', 'Build bundles/cross-sell + post-purchase & win-back flows', 'Launch a referral / affiliate motion'],
      ['Resource the content + creative pipeline', 'Schedule promos against the calendar', 'Forecast inventory against demand'],
      ['Weekly KPI review: CAC, ROAS, repeat rate, LTV:CAC', 'Tighten attribution & reporting', 'Kill underperformers; reinvest in winners'],
    ),
  },
  {
    name: 'Retail · Maturity', business_type: 'retail', lifecycle_stage: 'maturity',
    summary: 'SOSTAC plan to defend share and reignite growth: maximise lifetime value, protect margins, and open the next product/market or channel.',
    phases: sostac(
      ['Audit margin, discount dependency & SKU profitability', 'Assess brand health, share & customer cohorts', 'Spot saturation in current channels'],
      ['Set defend goals: retention, LTV, margin %', 'Set a target for revenue from new lines/channels', 'Agree acceptable churn / reactivation targets'],
      ['Retention & loyalty economics as the priority', 'Diversification: new product, channel or audience', 'Brand refresh / repositioning where needed'],
      ['Win back lapsed customers with segmented offers', 'Protect brand search & top SKUs', 'Test a new product line or channel (marketplace/wholesale/retail)', 'Pilot a community or content franchise'],
      ['Sequence the reinvention bets by effort/return', 'Resource the new channel/product test', 'Protect BAU while piloting'],
      ['Monitor retention, margin & cohort LTV', 'Review the diversification pilots against targets', 'Double down or cut based on evidence'],
    ),
  },
  {
    name: 'Service · Launch', business_type: 'service', lifecycle_stage: 'launch',
    summary: 'SOSTAC plan to generate qualified leads and prove the offer: trust signals, a simple lead engine, and tight follow-up so enquiries convert.',
    phases: sostac(
      ['Define the ICP + the core problem you solve', 'Audit competitors’ positioning, offers & proof', 'Baseline current enquiry sources & close rate'],
      ['Set lead-volume & cost-per-lead targets', 'Set an enquiry → client conversion target', 'Agree the revenue goal for the first 90 days'],
      ['Productise the offer + clear pricing', 'Pick the 1–2 channels with the best-fit buyers', 'Trust/risk-reversal strategy (proof, guarantees)'],
      ['Build a high-converting landing page + lead form', 'Stand up Google Business Profile + reviews', 'Launch search/intent ads + targeted outreach (email/LinkedIn)', 'Publish 2–3 proof assets (case study, FAQ)'],
      ['Set a fast follow-up SLA + owner', 'Build the enquiry → consult → proposal flow', 'Schedule the outreach + content cadence'],
      ['Weekly review of lead quality & cost by source', 'Tighten the weakest step in the funnel', 'Ask every happy client for a review/referral'],
    ),
  },
  {
    name: 'Service · Growth', business_type: 'service', lifecycle_stage: 'growth',
    summary: 'SOSTAC plan to scale lead flow and conversion without dropping quality: build authority, systematise sales, and turn clients into a referral engine.',
    phases: sostac(
      ['Review lead quality & conversion by source', 'Assess capacity & delivery quality vs demand', 'Identify the niche where you win most'],
      ['Set pipeline & revenue growth targets', 'Set conversion-rate and average-deal-size goals', 'Define a referral / repeat-revenue target'],
      ['Scale the best-quality channel + add a second', 'Authority/thought-leadership positioning', 'Packaging: tiered offers / retainers'],
      ['Build authority content / SEO for the niche', 'Add nurture sequences for slow leads', 'Run webinars / lead magnets', 'Add an outbound or partnership channel'],
      ['Document the sales process + objection handling', 'Build an onboarding + results-reporting rhythm', 'Resource content + sales against the plan'],
      ['Track pipeline stages + conversion by source', 'Review delivery quality & client satisfaction', 'Formalise the referral programme; upsell existing clients'],
    ),
  },
  {
    name: 'Service · Maturity', business_type: 'service', lifecycle_stage: 'maturity',
    summary: 'SOSTAC plan to protect the book and find new growth: deepen accounts, price on value, and open a new segment or productised offering.',
    phases: sostac(
      ['Map account health + churn risk', 'Audit pricing vs value delivered', 'Assess brand/reputation & market saturation'],
      ['Set retention & net-revenue-retention targets', 'Set a price-realisation / margin goal', 'Target % revenue from new segments/products'],
      ['Account deepening & value-based pricing', 'Diversification: new segment or productised offer', 'Reputation & thought-leadership defence'],
      ['Raise prices in line with demonstrated value', 'Deepen retainers with new service lines', 'Productise a service into a scalable offer', 'Build thought-leadership / partnerships; protect reviews/PR'],
      ['Sequence the new-growth bets', 'Resource the productised/self-serve tier', 'Protect delivery while expanding'],
      ['Monitor churn, NRR & price realisation', 'Review the diversification pilots vs targets', 'Scale what works; retire what doesn’t'],
    ),
  },
];

// Re-seed when the SOSTAC seed set is absent (e.g. after migration 102 clears an
// older seed). Gated on seed rows only, so admins' custom templates are kept.
async function ensureSeeded() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM strategy_templates WHERE is_seed = TRUE');
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

// Normalise an editor-submitted phases array to [{title, items:[text]}].
function cleanPhases(phases) {
  return (Array.isArray(phases) ? phases : [])
    .map(p => ({
      title: String(p.title || '').trim(),
      items: (Array.isArray(p.items) ? p.items : [])
        .map(it => String(typeof it === 'string' ? it : it.text || '').trim()).filter(Boolean),
    }))
    .filter(p => p.title || p.items.length);
}

async function getTemplate(id) {
  const { rows } = await pool.query('SELECT * FROM strategy_templates WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createTemplate({ name, business_type, lifecycle_stage, summary, phases }) {
  if (!name || !business_type || !lifecycle_stage) { const e = new Error('name, business_type and lifecycle_stage are required.'); e.status = 400; throw e; }
  const { rows } = await pool.query(
    `INSERT INTO strategy_templates (name, business_type, lifecycle_stage, summary, phases)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name.trim(), business_type, lifecycle_stage, summary || null, JSON.stringify(cleanPhases(phases))]
  );
  return rows[0];
}

async function updateTemplate(id, { name, business_type, lifecycle_stage, summary, phases }) {
  const { rows } = await pool.query(
    `UPDATE strategy_templates SET
       name = COALESCE($2, name),
       business_type = COALESCE($3, business_type),
       lifecycle_stage = COALESCE($4, lifecycle_stage),
       summary = $5,
       phases = COALESCE($6::jsonb, phases),
       updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, name?.trim() || null, business_type || null, lifecycle_stage || null,
     summary ?? null, phases === undefined ? null : JSON.stringify(cleanPhases(phases))]
  );
  if (!rows.length) { const e = new Error('Template not found'); e.status = 404; throw e; }
  return rows[0];
}

async function deleteTemplate(id) {
  await pool.query('DELETE FROM strategy_templates WHERE id = $1', [id]);
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
  listTemplates, matchTemplate, getTemplate, createTemplate, updateTemplate, deleteTemplate,
  assignToClient, getClientStrategy, setItem, tailorWithClaude,
};
