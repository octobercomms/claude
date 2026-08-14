// Unified cross-PESO Strategist briefing.
//
// For one client: run an expert analysis of each PESO pillar on its own stored
// data (Paid / Earned / Shared / Owned), then a synthesis pass that reads all
// four together and writes the client-level briefing + the top cross-channel
// priorities. Persists to strategist_briefings (+ per-pillar sections) and a
// single prioritised, pillar-tagged task list (strategist_briefing_recommendations).
//
// Each pillar reuses its existing OverviewReport.reportData(clientId,{days})
// stored-data gatherer; only the expert prompting + synthesis is new here.
// The LLM passes run on Claude Opus and are cost-tracked automatically.

const pool = require('../../db');
const claude = require('../claude');
const dataCollector = require('../dataCollector');

const MODEL = 'claude-opus-4-8';
const FEATURE = 'strategist_briefing';

// Pillar registry — each maps to an existing stored-data gatherer + an expert lens.
const PILLARS = [
  { key: 'paid',   label: 'Paid',   mod: require('../paidOverviewReport'),
    lens: 'a senior paid-media strategist (Meta & Google Ads)',
    frame: 'Judge account structure, spend efficiency (ROAS/CPA), audience targeting, and creative. Name the converters and the budget drains.' },
  { key: 'earned', label: 'Earned', mod: require('../earnedOverviewReport'),
    lens: 'a senior PR & earned-media strategist',
    frame: 'Judge coverage volume and quality (outlet tier), the health of journalist relationships, the pitch→published funnel, and whether coverage is winning authority/backlinks.' },
  { key: 'shared', label: 'Shared', mod: require('../socialOverviewReport'),
    lens: 'a senior organic-social strategist',
    frame: 'Judge posting cadence and consistency, reach and engagement-rate trend, which formats/frameworks and networks are working, and content-market fit.' },
  { key: 'owned',  label: 'Owned',  mod: require('../ownedOverviewReport'),
    lens: 'a senior SEO & content strategist',
    frame: 'Work the Technical / Content / Authority / Measurement framework plus AI-search readiness (AI Overviews). Judge rankings and movement, technical health, authority, and the biggest ranking opportunities.' },
];

const SYSTEM = `You are the senior strategist on the October Communications team — a UK marketing agency — writing a thorough internal briefing for the account lead. Be the expert in the room: think like the business owner deciding where the next few months of effort and budget should go.

For every point you make, work the full chain: what the data actually shows (cite the number) → what it means / why it's happening → what you would do about it → the expected impact and how it moves the account to its next stage. Don't just name a metric — interpret it. Where useful, explain the mechanics so the account lead understands *why* the recommendation works, not just what to do.

Depth is welcome and expected — this is a proper strategic review, not a one-line summary. But rigour comes first: every claim must be grounded in the numbers provided, specific enough to act on, and free of generic filler ("consider improving content", "engage your audience"). If a pillar's data is thin, say so plainly and don't over-read it. Confident, commercially literate, British English. Never invent numbers — if a figure isn't in the data, don't cite it.`;

// Client-facing reframe: the account director's voice, written for the client.
const CLIENT_SYSTEM = `You are a senior account director at October Communications, a UK marketing agency, writing a polished progress report addressed to the client. Warm, confident, plain British English, jargon kept light and always explained.

Your job is to tell the client the story of their marketing this period: what we did, what the results were, what it means for their business, and what we're focusing on next. Explain the "so what" behind the numbers — a client should finish the report understanding both how things are going and that they're in expert hands.

Hard rules: only use figures that appear in the internal briefing you're given — never invent or round beyond what's there. Do not expose internal commercial candour, agency margins, blunt criticism of the client, or the internal [CRUCIAL]/[NICE] tags. Reframe priorities positively as "where we're focusing next". No hype, no empty superlatives. British English throughout.`;

// Pull light client context to steer the analysis.
async function loadContext(clientId, client) {
  let strategy = null;
  try {
    const { rows } = await pool.query('SELECT summary, profile FROM client_strategy WHERE client_id = $1', [clientId]);
    strategy = rows[0] || null;
  } catch { /* optional */ }
  return {
    name: client.name, domain: client.domain,
    about: client.briefing_field || null,
    monthly_focus: client.monthly_focus || null,
    business_type: client.business_type || null,
    lifecycle_stage: client.lifecycle_stage || null,
    competitors: client.competitor_domains || [],
    strategy_summary: strategy?.summary || null,
  };
}

// Best-effort commercial opener (ecom revenue/orders). GA4 parsing is skipped —
// pillars carry channel detail; this just gives the synthesis a headline.
async function commercialSnapshot(clientId, startDate, endDate) {
  try {
    const collected = await dataCollector.collectClientData(clientId, startDate, endDate);
    const data = collected.data || {};
    let revenue = 0, orders = 0, found = false;
    for (const [k, payload] of Object.entries(data)) {
      if (k.startsWith('shopify') || k.startsWith('woocommerce')) {
        const s = payload?.summary || {};
        revenue += Number(s.total_revenue || 0);
        orders += Number(s.total_orders || 0);
        found = true;
      }
    }
    return found ? { revenue: Math.round(revenue), orders } : null;
  } catch { return null; }
}

function contextBlock(ctx) {
  const bits = [
    `Client: ${ctx.name}${ctx.domain ? ` (${ctx.domain})` : ''}`,
    ctx.about ? `About: ${ctx.about}` : null,
    ctx.business_type ? `Business type: ${ctx.business_type}${ctx.lifecycle_stage ? ` · ${ctx.lifecycle_stage} stage` : ''}` : null,
    ctx.monthly_focus ? `Current focus: ${ctx.monthly_focus}` : null,
    ctx.competitors?.length ? `Competitors: ${ctx.competitors.join(', ')}` : null,
    ctx.strategy_summary ? `Strategy: ${ctx.strategy_summary}` : null,
  ].filter(Boolean);
  return bits.join('\n');
}

function pillarPrompt({ pillar, ctx, data }) {
  return `You are ${pillar.lens} writing the **${pillar.label}** section of a client briefing.

# Client context
${contextBlock(ctx)}

# Your brief
${pillar.frame}
Write a thorough markdown analysis (no top-level heading — the UI adds it). Use \`###\` sub-headings and cover:
- **What the data shows** — read the numbers: the state of play, the trend, and what stands out (good and bad). Cite specific figures.
- **What's working** — what to protect and build on, and *why* it's working.
- **What's holding growth back** — the real constraints, root cause not just symptom, with the numbers that reveal them.
- **What I'd do** — the specific moves, each with the reasoning (why it works) and the expected impact / what "good" looks like next.
- End with a \`### Recommendations\` list. Each line MUST start with \`[CRUCIAL]\` or \`[NICE]\` (crucial = do it in the next 30–90 days, it moves the needle; nice = worthwhile but not urgent), then the specific action and the one-line why.
Be genuinely useful and specific — enough that the account lead could act on this on Monday. If the data is too thin to judge a sub-section, say so plainly rather than padding.

# ${pillar.label} data (last ${data.days} days)
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\``;
}

function synthesisPrompt({ ctx, commercial, sections }) {
  const pillarBlocks = sections.map(s => `## ${s.label}\n${s.ok ? s.markdown : `_No ${s.label} data this period._`}`).join('\n\n');
  return `You are the lead strategist writing the **client-level synthesis** at the top of the briefing, having read all four pillar analyses below.

# Client context
${contextBlock(ctx)}
${commercial ? `\n# Commercial headline\nRevenue (period): £${commercial.revenue.toLocaleString('en-GB')} from ${commercial.orders} orders.` : ''}

# The four pillar analyses
${pillarBlocks}

# Write (markdown, no top-level heading)
1. **The headline** — a short paragraph: how the account is doing overall, the single biggest opportunity right now, and the one risk worth naming.
2. **Where to focus** — the cross-channel story in real depth: what's working to build on, what's holding growth back, and — importantly — how the channels should support each other (e.g. what owned/earned should do for paid, where social amplifies the rest). Explain the reasoning, not just the conclusion.
3. **The next stage** — if you were the business owner, what does "levelling up" look like over the next few months, and what's the sequence to get there?
4. A \`### This month's priorities\` list — the few things that matter most across the WHOLE account, most important first. Each line starts with \`[CRUCIAL]\` or \`[NICE]\`, then the action and why. These are account-level priorities, not a rehash of every pillar recommendation.
Be decisive and commercially minded: where should the next month of effort and budget go, and what is merely nice to have?`;
}

// Parse "[CRUCIAL]/[NICE] text" lines out of a markdown block.
function parseRecs(markdown) {
  if (!markdown) return [];
  const out = [];
  for (const raw of markdown.split('\n')) {
    const m = raw.match(/^\s*(?:[-*]|\d+\.)?\s*\[(CRUCIAL|NICE)\]\s*(.+?)\s*$/i);
    if (m) out.push({ priority: m[1].toLowerCase(), text: m[2].replace(/\*\*/g, '').trim() });
  }
  return out;
}

async function runPillar(pillar, clientId, days, ctx) {
  try {
    const data = await pillar.mod.reportData(clientId, { days });
    if (!data || !data.has_data) {
      return { pillar: pillar.key, label: pillar.label, ok: false, markdown: '', data, recommendations: [] };
    }
    const markdown = await claude.callClaude({
      model: MODEL, feature: FEATURE, clientId, max_tokens: 6000,
      system: SYSTEM, user: pillarPrompt({ pillar, ctx, data }),
    });
    return { pillar: pillar.key, label: pillar.label, ok: true, markdown, data, recommendations: parseRecs(markdown) };
  } catch (err) {
    return { pillar: pillar.key, label: pillar.label, ok: false, markdown: '', error: err.message, data: null, recommendations: [] };
  }
}

async function insertRecs(briefingId, clientId, recs) {
  if (!recs.length) return;
  const values = [];
  const params = [briefingId, clientId];
  recs.forEach((r, i) => {
    const base = params.length;
    values.push(`($1, $2, $${base + 1}, $${base + 2}, ${i + 1}, $${base + 3})`);
    params.push(r.pillar, r.priority === 'crucial' ? 'crucial' : 'nice', r.text.slice(0, 1000));
  });
  await pool.query(
    `INSERT INTO strategist_briefing_recommendations (briefing_id, client_id, pillar, priority, position, text)
     VALUES ${values.join(',')}`, params);
}

// Generate a briefing for one client. Synchronous — expect ~1–2 min while the
// five Claude passes run.
async function generate({ clientId, days = 30, trigger = 'manual' }) {
  const { rows: crows } = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  if (!crows.length) throw new Error('Client not found');
  const client = crows[0];
  const ctx = await loadContext(clientId, client);

  const ins = await pool.query(
    `INSERT INTO strategist_briefings (client_id, status, trigger, period_start, period_end)
     VALUES ($1, 'generating', $2, (NOW() - make_interval(days => $3))::date, NOW()::date) RETURNING id`,
    [clientId, trigger, days]
  );
  const briefingId = ins.rows[0].id;

  try {
    const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const end = new Date().toISOString().slice(0, 10);
    const [commercial, sections] = await Promise.all([
      commercialSnapshot(clientId, start, end),
      Promise.all(PILLARS.map(p => runPillar(p, clientId, days, ctx))),
    ]);

    const synthMd = await claude.callClaude({
      model: MODEL, feature: FEATURE, clientId, max_tokens: 8000,
      system: SYSTEM, user: synthesisPrompt({ ctx, commercial, sections }),
    });

    await pool.query(
      `UPDATE strategist_briefings SET status='completed', synthesis=$1, sections=$2, data_snapshot=$3 WHERE id=$4`,
      [
        synthMd,
        JSON.stringify(sections.map(s => ({ pillar: s.pillar, label: s.label, markdown: s.markdown, ok: s.ok, error: s.error || null }))),
        JSON.stringify({ commercial, pillars: sections.map(s => ({ pillar: s.pillar, data: s.data })) }),
        briefingId,
      ]
    );

    const recs = [];
    for (const s of sections) for (const r of s.recommendations) recs.push({ pillar: s.pillar, ...r });
    for (const r of parseRecs(synthMd)) recs.push({ pillar: 'cross', ...r });
    // Crucial first, then by pillar order, for a sensible checklist order.
    recs.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'crucial' ? -1 : 1));
    await insertRecs(briefingId, clientId, recs).catch(e => console.warn('[strategist] rec insert failed:', e.message));

    return briefingId;
  } catch (err) {
    await pool.query(`UPDATE strategist_briefings SET status='failed', error_message=$1 WHERE id=$2`,
      [String(err.message || err).slice(0, 2000), briefingId]).catch(() => {});
    throw err;
  }
}

// ── Client-facing report ─────────────────────────────────────────────────────
// A second Claude pass that reframes a completed briefing into a polished
// progress report addressed to the client. Cached on the briefing row; pass
// { force: true } to regenerate. Returns the markdown.
const PILLAR_LABEL = { paid: 'Paid media', earned: 'PR & earned media', shared: 'Social', owned: 'SEO & content', cross: 'Across the account' };

function clientReportPrompt({ ctx, synthesis, sections }) {
  const pillarBlocks = (sections || [])
    .filter(s => s.ok && s.markdown)
    .map(s => `## ${PILLAR_LABEL[s.pillar] || s.label}\n${s.markdown}`)
    .join('\n\n');
  return `Rewrite the internal strategist briefing below as a progress report for the client.

# Client
${contextBlock(ctx)}

# Internal briefing — account-level synthesis
${synthesis || '_none_'}

# Internal briefing — by channel
${pillarBlocks || '_none_'}

# Write the client report (markdown, no top-level # heading — the document adds the title)
Structure it as:
- A short, warm opening paragraph — the story of the period in 3–4 sentences.
- \`## How things are going\` — the honest-but-constructive overall picture, in plain English, with the headline numbers that matter to them.
- \`## By channel\` — a subsection (\`###\`) for each channel that has something to report (paid media, PR & earned, social, SEO & content). What we did, the results, and what it means. Skip channels with nothing to say rather than padding.
- \`## Where we're focusing next\` — the plan for the coming weeks as a short prioritised list, framed as what we're doing for them (not internal jargon, no [CRUCIAL]/[NICE] tags).
- A one-line close.
Keep it readable for a busy business owner — thorough but not padded. Only use numbers that appear above.`;
}

async function clientReport(briefingId, { force = false } = {}) {
  const { rows } = await pool.query('SELECT * FROM strategist_briefings WHERE id = $1', [briefingId]);
  if (!rows.length) throw new Error('Briefing not found');
  const b = rows[0];
  if (b.status !== 'completed') throw new Error('Briefing not ready');
  if (b.client_report && !force) return b.client_report;

  const { rows: crows } = await pool.query('SELECT * FROM clients WHERE id = $1', [b.client_id]);
  const client = crows[0] || { name: 'Client' };
  const ctx = await loadContext(b.client_id, client);
  const sections = Array.isArray(b.sections) ? b.sections : [];

  const md = await claude.callClaude({
    model: MODEL, feature: 'strategist_client_report', clientId: b.client_id, max_tokens: 6000,
    system: CLIENT_SYSTEM, user: clientReportPrompt({ ctx, synthesis: b.synthesis, sections }),
  });
  await pool.query('UPDATE strategist_briefings SET client_report = $1, client_report_at = NOW() WHERE id = $2', [md, briefingId]);
  return md;
}

module.exports = { generate, clientReport, parseRecs, PILLARS };
