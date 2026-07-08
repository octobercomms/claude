// Client strategy playbooks — a library of stage × business-type marketing
// strategies (summary + phased checklist), assigned to a client from their
// Setup type/stage, surfaced as a checkable checklist on the dashboard, and
// optionally tailored to the client by Claude. See migration 101.

const pool = require('../db');
const claudeService = require('./claude');
const playbooks = require('./playbooks');
const dataforseo = require('../connectors/dataforseo');
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
  {
    name: 'B2B · Launch', business_type: 'b2b', lifecycle_stage: 'launch',
    summary: 'SOSTAC plan to build a B2B pipeline from zero: nail the ICP, align sales + marketing, and prove a repeatable lead → opportunity motion.',
    phases: sostac(
      ['Define the ICP, buying committee & total addressable market', 'Audit competitors’ positioning, pricing & proof', 'Baseline: current pipeline sources & win rate'],
      ['Set pipeline / MQL & SQL targets for the first 90 days', 'Define target CAC and sales-cycle length', 'Agree the marketing → sales SLA & definitions'],
      ['Sharp positioning + ICP-led messaging', 'Choose the motion: inbound, outbound/ABM, or both', 'Prioritise the 1–2 channels the buyers actually use'],
      ['Build a credibility website + lead-capture + demo flow', 'Publish proof (case studies, ROI, comparison pages)', 'Stand up LinkedIn + targeted outbound sequences', 'Create a lead magnet for the buying committee'],
      ['Align sales + marketing on stages & handoff', 'Build the outreach cadence + content calendar', 'Set up CRM, lead routing & attribution'],
      ['Weekly pipeline review: MQL→SQL→opp conversion', 'Track CAC, cycle length & source quality', 'Fix the weakest funnel stage'],
    ),
  },
  {
    name: 'B2B · Growth', business_type: 'b2b', lifecycle_stage: 'growth',
    summary: 'SOSTAC plan to scale B2B pipeline predictably: expand ABM, enable sales, and tighten attribution to reinvest in what closes.',
    phases: sostac(
      ['Review pipeline by source, segment & win rate', 'Identify the best-fit accounts & expansion segments', 'Assess sales capacity vs lead volume'],
      ['Set pipeline-coverage & revenue targets', 'Set conversion & average-deal-size goals', 'Define a target CAC payback period'],
      ['Scale the highest-quality channel; layer ABM on tier-1 accounts', 'Category authority / thought-leadership positioning', 'Packaging & pricing for larger deals'],
      ['Scale content/SEO for the buying journey', 'Run ABM plays (ads + outbound + events) on target accounts', 'Build sales enablement: decks, ROI tools, battlecards', 'Add nurture for long-cycle leads'],
      ['Document the repeatable sales process', 'Resource SDR/content against the plan', 'Operationalise account scoring & routing'],
      ['Track pipeline coverage, conversion & CAC payback', 'Multi-touch attribution to reallocate spend', 'Review deal-desk / win-loss monthly'],
    ),
  },
  {
    name: 'B2B · Maturity', business_type: 'b2b', lifecycle_stage: 'maturity',
    summary: 'SOSTAC plan to defend revenue and find the next S-curve: expand accounts, protect category position, and enter a new segment or product.',
    phases: sostac(
      ['Map account health, churn & expansion potential', 'Assess category position & competitive threats', 'Audit margin & discounting in the deal base'],
      ['Set net-revenue-retention & expansion targets', 'Set targets for a new segment / product line', 'Define win-back & reactivation goals'],
      ['Land-and-expand within existing accounts', 'Category leadership & community building', 'Diversify into an adjacent segment or product'],
      ['Customer-marketing & QBR programme for expansion', 'Thought-leadership + analyst/PR to defend position', 'Pilot a new-segment GTM or a lower-touch tier', 'Win-back campaigns for lapsed accounts'],
      ['Sequence expansion vs new-segment bets', 'Resource customer marketing + the new GTM', 'Protect core revenue while piloting'],
      ['Monitor NRR, expansion revenue & churn', 'Review the new-segment pilot vs targets', 'Double down or cut based on evidence'],
    ),
  },
  {
    name: 'Local · Launch', business_type: 'local', lifecycle_stage: 'launch',
    summary: 'SOSTAC plan to get found and chosen locally: own the map pack, build reviews, and turn local demand into bookings/visits.',
    phases: sostac(
      ['Audit the local market, catchment & competitors', 'Define the ideal local customer + key services', 'Baseline: GBP status, reviews & local rankings'],
      ['Set targets for calls / bookings / footfall', 'Set a reviews target (volume + rating)', 'Define a cost-per-enquiry goal'],
      ['Local positioning + the hero offer', 'Map-pack (proximity, category, reviews) priorities', 'Channel mix: local search + social + offline'],
      ['Optimise Google Business Profile + local citations', 'Launch a review-generation system', 'Local search/Maps ads for buying keywords', 'Location landing pages + local schema'],
      ['Set the review-ask into the customer journey', 'Build the GBP posting + content cadence', 'Set up call/booking tracking'],
      ['Weekly review of calls/bookings by source', 'Track map-pack rank + review velocity', 'Fix the weakest step (listing, CRO, follow-up)'],
    ),
  },
  {
    name: 'Local · Growth', business_type: 'local', lifecycle_stage: 'growth',
    summary: 'SOSTAC plan to scale local presence: dominate the map pack across services/areas, compound reviews, and build referrals.',
    phases: sostac(
      ['Review enquiry volume & cost by service/area', 'Identify the best services & adjacent areas', 'Spot where competitors out-rank you'],
      ['Set growth targets for enquiries & revenue', 'Set a sustained review-velocity target', 'Define a referral / repeat-visit target'],
      ['Expand to more service/area landing pages', 'Reputation as a moat (reviews + responses)', 'Add a referral / loyalty motion'],
      ['Scale local SEO + content for more terms/areas', 'Scale local ads on the best-performing services', 'Systematise reviews + owner responses', 'Launch referral incentives'],
      ['Resource content + review ops', 'Schedule promos against local demand peaks', 'Tighten booking/CRM follow-up'],
      ['Weekly KPIs: enquiries, cost, map-pack coverage', 'Track review velocity & response rate', 'Reallocate to the best services/areas'],
    ),
  },
  {
    name: 'Local · Maturity', business_type: 'local', lifecycle_stage: 'maturity',
    summary: 'SOSTAC plan to defend the patch and grow: protect the map pack, deepen loyalty, and open new services, areas or locations.',
    phases: sostac(
      ['Audit map-pack defensibility & review lead', 'Assess loyalty / repeat-visit economics', 'Spot saturation in current services/areas'],
      ['Set retention & repeat-visit targets', 'Set a margin / average-spend goal', 'Target % revenue from new services/areas'],
      ['Defend rankings + reputation lead', 'Loyalty & community as retention drivers', 'Expand to a new service, area or location'],
      ['Protect GBP + top local rankings', 'Win-back lapsed customers with local offers', 'Launch a new service / area / location pilot', 'Build community (events, partnerships, PR)'],
      ['Sequence the expansion bets', 'Resource the new service/location pilot', 'Protect BAU while expanding'],
      ['Monitor retention, average spend & rankings', 'Review the expansion pilot vs targets', 'Scale what works; cut what doesn’t'],
    ),
  },
  {
    name: 'Retail · Established', business_type: 'retail', lifecycle_stage: 'established',
    summary: 'SOSTAC plan to optimise a proven store: get more from the traffic and customers you already have — conversion, AOV, retention and efficiency — before chasing fresh growth.',
    phases: sostac(
      ['Audit funnel conversion, AOV & repeat-purchase rate by cohort', 'Review channel efficiency (ROAS/CAC) and wasted spend', 'Map where the best customers come from and why they stay'],
      ['Set targets: conversion %, AOV, repeat rate, LTV:CAC', 'Set a retention / churn-reduction goal', 'Agree a margin / paid-efficiency target'],
      ['Make CRO + retention the priority over net-new acquisition', 'Lifecycle & loyalty strategy to lift repeat revenue', 'Reallocate budget from weak channels to proven ones'],
      ['Run a structured CRO programme (PDP, cart, checkout)', 'Optimise lifecycle flows (welcome, abandonment, win-back, replenishment)', 'Launch or refine a loyalty / subscription motion', 'Trim paid waste and scale the best-ROAS campaigns'],
      ['Prioritise a test backlog by effort vs impact', 'Set the weekly experiment + reporting cadence', 'Assign owners for CRO, lifecycle and paid'],
      ['Weekly review: conversion, AOV, repeat rate, LTV:CAC', 'Keep a win/loss log for experiments', 'Reinvest the efficiency gains into the next test'],
    ),
  },
  {
    name: 'Service · Established', business_type: 'service', lifecycle_stage: 'established',
    summary: 'SOSTAC plan to optimise a proven service business: lift conversion and average value, retain & expand existing clients, and make lead-gen more efficient.',
    phases: sostac(
      ['Review close rate & average deal value by source', 'Assess client retention, churn & referral rate', 'Audit which services & niches are most profitable'],
      ['Set conversion-rate and average-deal-value targets', 'Set a retention / repeat-revenue goal', 'Define a cost-per-acquired-client target'],
      ['Optimise the sales funnel before adding new channels', 'Account growth: upsell, retainers & cross-sell', 'Double down on the most profitable niche'],
      ['Sharpen the consult → proposal → close process', 'Add nurture + reactivation sequences for old leads', 'Formalise referrals & case studies as a channel', 'Improve landing pages & proof for the best service lines'],
      ['Set follow-up SLAs and a pipeline review rhythm', 'Build the upsell / QBR motion for existing clients', 'Resource the proof & content engine'],
      ['Monthly review of close rate, deal value & retention', 'Track referral & repeat revenue', 'Cut the weakest lead source; reinvest in the best'],
    ),
  },
  {
    name: 'B2B · Established', business_type: 'b2b', lifecycle_stage: 'established',
    summary: 'SOSTAC plan to optimise a proven B2B engine: improve pipeline conversion and deal size, retain & expand accounts, and tighten marketing–sales efficiency.',
    phases: sostac(
      ['Audit funnel conversion by stage (MQL→SQL→win)', 'Review net revenue retention, churn & expansion', 'Assess ICP fit & CAC payback by segment/channel'],
      ['Set pipeline-conversion & average-contract-value targets', 'Set a net-revenue-retention / expansion goal', 'Agree a CAC-payback / efficiency target'],
      ['Prioritise conversion & ABM efficiency over net-new volume', 'Account expansion: land-and-expand & upsell', 'Tighten the marketing→sales handoff & lead scoring'],
      ['Optimise the demo/trial → close funnel & nurture', 'Run targeted ABM into best-fit accounts', 'Build customer marketing: case studies, QBRs, expansion plays', 'Refine attribution & lead scoring with sales'],
      ['Agree SLAs & a shared pipeline review with sales', 'Resource the ABM + customer-marketing programmes', 'Set the reporting cadence on pipeline & NRR'],
      ['Monthly review: conversion by stage, ACV, NRR, CAC payback', 'Joint sales/marketing pipeline review', 'Reallocate to the highest-ROI segments & plays'],
    ),
  },
  {
    name: 'Local · Established', business_type: 'local', lifecycle_stage: 'established',
    summary: 'SOSTAC plan to optimise a proven local business: convert more nearby demand, lift repeat visits & reviews, and run efficient local marketing.',
    phases: sostac(
      ['Audit local search visibility & Google Business Profile', 'Review repeat-visit / repeat-booking rate & reviews', 'Assess which services & locations are most profitable'],
      ['Set targets: calls/bookings, repeat rate, review volume & rating', 'Set a retention / repeat-visit goal', 'Agree an efficient cost-per-enquiry target'],
      ['Own local search + reputation as the priority', 'Retention: loyalty, reminders, repeat bookings', 'Focus spend on the highest-value services & areas'],
      ['Optimise GBP + local landing pages for conversion', 'Run a review-generation engine', 'Add reminder / loyalty SMS-email for repeat visits', 'Tighten local paid (radius, peak times) for efficiency'],
      ['Build the review-ask into the customer journey', 'Schedule local promos around peak periods', 'Assign owners for GBP, reviews & retention'],
      ['Monthly review: enquiries, repeat rate, review rating', 'Track cost-per-enquiry by channel', 'Cut waste; reinvest in what drives bookings'],
    ),
  },
];

// Additive seeding: insert any seed type×stage combo that isn't present yet, so
// new combos (e.g. B2B / Local) fill in without disturbing existing seed rows
// (preserving their ids + any clients linked to them) or admin-authored ones.
async function ensureSeeded() {
  const { rows } = await pool.query('SELECT business_type, lifecycle_stage FROM strategy_templates WHERE is_seed = TRUE');
  const have = new Set(rows.map(r => `${r.business_type}|${r.lifecycle_stage}`));
  for (const t of SEED) {
    if (have.has(`${t.business_type}|${t.lifecycle_stage}`)) continue;
    await pool.query(
      `INSERT INTO strategy_templates (name, business_type, lifecycle_stage, summary, phases, is_seed)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [t.name, t.business_type, t.lifecycle_stage, t.summary, JSON.stringify(t.phases)]
    );
    have.add(`${t.business_type}|${t.lifecycle_stage}`);
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

// Cross-client roll-up for the main dashboard. Scoped to the caller's visible
// clients (null = admin, all).
async function overview(visibleClientIds) {
  const scoped = Array.isArray(visibleClientIds);
  const { rows } = await pool.query(
    `SELECT cs.client_id, c.name AS client_name, c.business_type, c.lifecycle_stage,
            st.name AS template_name, cs.phases
       FROM client_strategy cs
       JOIN clients c ON c.id = cs.client_id
       LEFT JOIN strategy_templates st ON st.id = cs.template_id
      ${scoped ? 'WHERE cs.client_id = ANY($1::uuid[])' : ''}
      ORDER BY c.name`,
    scoped ? [visibleClientIds] : []
  );
  return rows.map(r => {
    const total = (r.phases || []).reduce((n, p) => n + (p.items || []).length, 0);
    const done = (r.phases || []).reduce((n, p) => n + (p.items || []).filter(i => i.done).length, 0);
    return {
      client_id: r.client_id, client_name: r.client_name,
      business_type: r.business_type, lifecycle_stage: r.lifecycle_stage,
      template_name: r.template_name, done, total,
      pct: total ? Math.round((done / total) * 100) : 0,
    };
  });
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
// Sanitise the AI profile to a known shape (defensive — the model can drift).
function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const arr = (v, n = 8) => (Array.isArray(v) ? v.map(x => String(x)).filter(Boolean).slice(0, n) : []);
  const personas = (Array.isArray(p.personas) ? p.personas : []).slice(0, 4).map(x => ({
    label: String(x.label || 'Persona'),
    who: String(x.who || ''),
    age: String(x.age || ''),
    budget: String(x.budget || ''),
    location: String(x.location || ''),
    values: arr(x.values, 6),
  })).filter(x => x.who || x.values.length);
  const objectives = (Array.isArray(p.objectives) ? p.objectives : []).slice(0, 6).map(o => ({
    metric: String(o.metric || ''),
    baseline: String(o.baseline || ''),
    target: String(o.target || ''),
    timeframe: String(o.timeframe || ''),
  })).filter(o => o.metric);
  const competitor_table = (Array.isArray(p.competitor_table) ? p.competitor_table : []).slice(0, 12).map(x => ({
    name: String(x.name || ''),
    domain: String(x.domain || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase(),
    domain_authority: x.domain_authority === null || x.domain_authority === undefined || x.domain_authority === '' ? null : String(x.domain_authority),
    note: String(x.note || ''),
  })).filter(x => x.name);
  const target_media = (Array.isArray(p.target_media) ? p.target_media : []).slice(0, 12).map(x => ({
    outlet: String(x.outlet || ''), topic: String(x.topic || ''), tier: String(x.tier || ''),
  })).filter(x => x.outlet);
  const target_awards = (Array.isArray(p.target_awards) ? p.target_awards : []).slice(0, 10).map(x => ({
    award: String(x.award || ''), note: String(x.note || ''),
  })).filter(x => x.award);
  const funnel = {
    attract: arr(p.funnel?.attract), convert: arr(p.funnel?.convert),
    close: arr(p.funnel?.close), retain: arr(p.funnel?.retain),
  };
  return {
    exec_summary: String(p.exec_summary || ''),
    positioning: String(p.positioning || ''),
    key_messages: arr(p.key_messages, 6),
    personas,
    swot: {
      strengths: arr(p.swot?.strengths), weaknesses: arr(p.swot?.weaknesses),
      opportunities: arr(p.swot?.opportunities), threats: arr(p.swot?.threats),
    },
    competitors: {
      functional: arr(p.competitors?.functional), emotional: arr(p.competitors?.emotional),
      situational: arr(p.competitors?.situational),
    },
    competitor_table,
    funnel,
    objectives,
    target_media,
    target_awards,
  };
}

// Replace AI-estimated competitor DA with DataForSEO's real domain rank where
// available. Non-fatal: if DFS isn't configured or the call fails, the AI's
// estimate stands.
async function enrichCompetitorDA(profile) {
  const table = profile?.competitor_table || [];
  const domains = table.map(c => c.domain).filter(Boolean);
  if (!domains.length) return profile;
  try {
    const ranks = await dataforseo.fetchDomainRanks(domains);
    for (const c of table) {
      if (c.domain && ranks[c.domain] != null) c.domain_authority = String(ranks[c.domain]);
    }
  } catch { /* leave AI estimates in place */ }
  return profile;
}

async function tailorWithClaude(clientId) {
  const cur = await getClientStrategy(clientId);
  if (!cur) { const e = new Error('Assign a strategy first.'); e.status = 400; throw e; }
  const { rows } = await pool.query('SELECT name, briefing_field, monthly_focus, domain FROM clients WHERE id = $1', [clientId]);
  const c = rows[0] || {};
  // Ground objectives in the client's real channels.
  const { rows: conn } = await pool.query(
    "SELECT DISTINCT connector_type FROM connectors WHERE client_id = $1 AND status = 'active'", [clientId]
  );
  const channels = conn.map(r => r.connector_type).join(', ') || '(none connected yet)';
  const skeleton = (cur.phases || []).map(p => ({ title: p.title, items: (p.items || []).map(i => i.text) }));

  const raw = await claudeService.callClaude({
    max_tokens: 5000,
    system: 'You are a senior marketing strategist at October, a UK agency, writing a client strategy in the style of the firm\'s hand-crafted SOSTAC plans. Adapt the checklist to the specific client AND produce a structured strategic profile: a confident narrative exec summary, a positioning statement + key messages, concrete primary/secondary personas (age, budget, location, values), a real SWOT, a competitor map (functional/emotional/situational) AND a benchmarked competitor table (real named companies + their domains), tactics mapped to the demand funnel (attract/convert/close/retain), quantified SMART objectives, and PR target media + awards. Specific to THIS client — no generic filler, no copy-paste between clients. For the competitor table give each competitor\'s real website domain (you don\'t need to know their DA — leave it null, we fill it from live data). British English. JSON only — no prose, no fences.' + playbooks.systemSuffix(['trust-brokering']),
    user: `Client: ${c.name}${c.domain ? ` (${c.domain})` : ''}
About: ${c.briefing_field || '(no brief)'}
This month's focus: ${c.monthly_focus || '(none)'}
Strategy: ${cur.template_name || ''} — ${cur.summary || ''}
Connected data channels: ${channels}

Current SOSTAC checklist:
${JSON.stringify(skeleton)}

Tailor the checklist and write the profile. For objectives, give a metric, a baseline (use "TBC from <channel>" if you can't know it), a target, and a timeframe. Return ONLY:
{"summary":"1–2 sentence tailored strategy summary","phases":[{"title":"keep the phase titles","items":["specific, client-tailored actions"]}],"profile":{"exec_summary":"a confident 3–5 sentence narrative","positioning":"one positioning statement","key_messages":["3–5 key messages"],"personas":[{"label":"Primary","who":"…","age":"…","budget":"…","location":"…","values":["…"]}],"swot":{"strengths":["…"],"weaknesses":["…"],"opportunities":["…"],"threats":["…"]},"competitors":{"functional":["…"],"emotional":["…"],"situational":["…"]},"competitor_table":[{"name":"Real competitor","domain":"example.com","domain_authority":null,"note":"how they compete"}],"funnel":{"attract":["tactics that build awareness"],"convert":["tactics that turn interest into leads"],"close":["tactics that close the sale"],"retain":["tactics that retain & grow"]},"objectives":[{"metric":"…","baseline":"…","target":"…","timeframe":"…"}],"target_media":[{"outlet":"publication","topic":"angle","tier":"1|2|3"}],"target_awards":[{"award":"award name","note":"category/why"}]}}`,
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
  let profile = cleanProfile(out.profile);
  if (profile) profile = await enrichCompetitorDA(profile);
  await pool.query('UPDATE client_strategy SET summary = $2, phases = $3, profile = $4, updated_at = NOW() WHERE client_id = $1',
    [clientId, out.summary || cur.summary, JSON.stringify(phases), profile ? JSON.stringify(profile) : null]);
  return getClientStrategy(clientId);
}

module.exports = {
  BUSINESS_TYPES, LIFECYCLE_STAGES,
  listTemplates, matchTemplate, getTemplate, createTemplate, updateTemplate, deleteTemplate,
  assignToClient, getClientStrategy, setItem, tailorWithClaude, overview,
};
