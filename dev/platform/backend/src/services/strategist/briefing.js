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
const { parseQueue, reconcile, openItemsBlock } = require('./queue');
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

// Brevity is a system-level instruction because it kept losing to one.
//
// The synthesis and pillar prompts below both ask for something short, and
// this prompt used to answer them with "depth is welcome and expected — this
// is a proper strategic review, not a one-line summary." A model handed both
// splits the difference, which is how the account lead ended up with a wall of
// text nobody reads. The user prompts were tightened twice; the contradiction
// above them survived both times and kept winning.
//
// What the account lead wants is a queue of decisions, not a document. So the
// output is short by instruction, and the reasoning behind each item travels
// with that item rather than as an essay around them.
const SYSTEM = `You are the senior strategist on the October Communications team — a UK marketing agency — writing for the account lead. Be the expert in the room: think like the business owner deciding where the next few weeks of effort and budget should go.

**Brevity is the discipline, and it is not optional.** This is read on a Monday morning by someone with an agency to run. They want to know what changed and what is now theirs to do. They are not studying a report. A point worth making is worth one or two sentences; nothing is worth a paragraph of preamble, and nothing is worth restating the account back to someone who already knows it.

Every claim carries its number. Where you name a problem, name the cause rather than the symptom, and name what you would do. Skip the mechanics lesson unless the recommendation makes no sense without it.

Banned outright: throat-clearing openers, "it is worth noting", summaries of what you are about to say, closing paragraphs that repeat the above, and generic filler ("consider improving content", "engage your audience"). If a pillar's data is thin, say so in one line and stop; do not pad it into a section. Length is never evidence of rigour.

Confident, commercially literate, British English. Never invent numbers — if a figure isn't in the data, don't cite it.`;

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

// The account lead's own notes/steer for this briefing (typed directly or
// promoted from the strategist chat). Rendered as a prompt block so every pass
// weights them. Each note is capped so a long promoted chat answer can't
// dominate the prompt.
function steerBlock(steer, { emphasis = false } = {}) {
  const notes = (steer || []).map(s => String(s || '').trim()).filter(Boolean).slice(0, 30);
  if (!notes.length) return '';
  const bullets = notes.map(n => `- ${n.length > 600 ? n.slice(0, 600) + '…' : n}`).join('\n');
  const heading = emphasis
    ? `# The account lead's steer (important — reflect this)
The account lead has shared these thoughts to inform this briefing. Treat them as priorities and context: engage with them directly, act on them where the data supports it, and if you disagree with any, say so plainly and explain why.`
    : `# The account lead's steer
Points the account lead flagged for this briefing — weight them and address any that touch ${'this channel'} where relevant:`;
  return `\n\n${heading}\n${bullets}`;
}

function pillarPrompt({ pillar, ctx, data, steer }) {
  return `You are ${pillar.lens} writing the **${pillar.label}** section of a client briefing.

# Client context
${contextBlock(ctx)}${steerBlock(steer)}

# Your brief
${pillar.frame}
This feeds the account lead's queue. **It is shown folded up underneath a queue item**, opened only when they want to know why that item is on the list — so it is short, specific, and reads as the reason behind an action rather than as a section of a report. No heading (the UI adds it). Six sentences is a lot; most should be fewer.

- **The state of play** — two or three sentences on what the numbers say, citing the figures. No preamble.
- **What is actually wrong, and why** — root cause, not symptom, with the number that reveals it. Skip this if nothing is wrong.
- End with a \`### Recommendations\` list, each line as \`[CRUCIAL] The action :: why it matters, with the figure\` (crucial = next 30 days and it moves the needle; nice = worthwhile but can wait).

If the data is too thin to judge, say that in one line rather than padding. Length is not a measure of usefulness here.

# ${pillar.label} data (last ${data.days} days)
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\``;
}

function synthesisPrompt({ ctx, commercial, sections, steer, openItems, lastGeneratedAt }) {
  const pillarBlocks = sections.map(s => `## ${s.label}\n${s.ok ? s.markdown : `_No ${s.label} data this period._`}`).join('\n\n');
  const since = lastGeneratedAt
    ? `The previous briefing was ${new Date(lastGeneratedAt).toISOString().slice(0, 10)}.`
    : 'This is the first briefing for this account.';
  return `You are the lead strategist writing the account lead's weekly briefing, having read all four pillar analyses below.

This is read on a Monday morning by someone running an agency. They do not need the analysis; they need to know what changed, what is now theirs to do, and what they can ignore. Write accordingly: if little changed, the briefing should be short, and its shortness is the message.

# Client context
${contextBlock(ctx)}${steerBlock(steer, { emphasis: true })}
${commercial ? `\n# Commercial headline\nRevenue (period): £${commercial.revenue.toLocaleString('en-GB')} from ${commercial.orders} orders.` : ''}

# Already open, from the last briefing
${since}
${openItemsBlock(openItems)}

# The four pillar analyses
${pillarBlocks}

# Write (markdown, no top-level heading)

\`### What changed\`
**At most three bullets, one line each, and fewer is better.** Only things that are genuinely different from the last briefing: a number that moved enough to matter, something that broke, something that was fixed and what happened as a result. Do not restate the state of the account; they have read it before.

If nothing material changed, **this section** is one line saying so. That finishes the section, not the briefing: the queue below is always written.

${lastGeneratedAt ? '' : "**This is the first briefing for this account, so nothing has changed yet.** Write one line for this section saying it is the first and these are opening baselines. Everything worth doing is new, which makes the queue the entire deliverable: it must not be empty."}

The page shows this prose and then the queue, as a list of tickable rows. There are no figures, tables or sections under it, so do not refer to anything "below" except the queue itself.

\`### The queue\`
Every item, most important first, one per line, in this exact shape:

\`[CRUCIAL][PAID][A1] The action :: why it matters, with the figure that shows it\`

- \`[CRUCIAL]\` means do it in the next 30 days and it moves the needle. \`[NICE]\` means worthwhile but it can wait. Be hard about this: if everything is crucial, nothing is.
- **The pillar tag** is which analysis the item came out of: \`[PAID]\`, \`[EARNED]\`, \`[SHARED]\` or \`[OWNED]\`. Every row shows it on screen, so it is how the account lead sees at a glance which part of the account their week is in. Use \`[CROSS]\` only for work that genuinely spans the account, such as attribution or a measurement fix that no single pillar owns. **Do not tag everything \`[CROSS]\`**: an item that came out of the Paid analysis is \`[PAID]\`, even when fixing it helps everything.
- The \`[A1]\` tag: copy it verbatim from the open list above when this item continues one that is already open, so it keeps its age. Leave the tag off entirely for anything newly raised. Never invent a tag.
- Drop an open item by simply not re-emitting it. Only drop it when it is genuinely resolved or no longer worth doing, and say which in What changed.
- The action is one sentence, specific enough to start on Monday. The rationale after \` :: \` is one sentence and carries the number.

**Never end the briefing without this section.** An empty queue says there is nothing worth doing on this account for the next 30 days, which on an account someone is paying for is almost never true, and on a first briefing never is. Where a pillar analysis above names a problem, that problem is a queue item.

Nothing else. No headline paragraph, no "where to focus", no closing summary. The queue is the deliverable.`;
}

// Every recommendation the pillar passes made, as queue lines.
//
// Only ever used when the synthesis wrote no queue. Each pillar's expert pass
// already ends with a `### Recommendations` list in the same
// `[CRUCIAL] action :: why` shape, parsed on the way in by `runPillar`, so
// this is a shape change rather than a second opinion. Crucial first, and the
// pillar is carried through so the item can say where it came from.
function pillarFallbackQueue(sections) {
  const out = [];
  for (const priority of ['crucial', 'nice']) {
    for (const section of sections) {
      if (!section.ok) continue;
      for (const rec of section.recommendations || []) {
        if (rec.priority !== priority) continue;
        const [text, rationale] = String(rec.text).split('::').map(part => part.trim());
        if (!text) continue;
        out.push({ priority, text, rationale: rationale || null, pillar: section.pillar, tag: null });
      }
    }
  }
  return out;
}

// Which queue this briefing ships, and whether it is the synthesis's own.
//
// Extracted so the decision is testable: the fallback below was first written
// inline in `generate`, where it could only be exercised with a database and
// five Claude calls, and a mutation that disabled it passed every test.
function queueFor(synthMd, sections) {
  const lines = parseQueue(synthMd);
  if (lines.length) return { lines, fromPillars: false };
  const fallback = pillarFallbackQueue(sections);
  return { lines: fallback, fromPillars: fallback.length > 0 };
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

async function runPillar(pillar, clientId, days, ctx, steer) {
  try {
    const data = await pillar.mod.reportData(clientId, { days });
    if (!data || !data.has_data) {
      return { pillar: pillar.key, label: pillar.label, ok: false, markdown: '', data, recommendations: [] };
    }
    const markdown = await claude.callClaude({
      model: MODEL, feature: FEATURE, clientId, max_tokens: 6000,
      system: SYSTEM, user: pillarPrompt({ pillar, ctx, data, steer }),
    });
    return { pillar: pillar.key, label: pillar.label, ok: true, markdown, data, recommendations: parseRecs(markdown) };
  } catch (err) {
    return { pillar: pillar.key, label: pillar.label, ok: false, markdown: '', error: err.message, data: null, recommendations: [] };
  }
}

// What the last briefing left open, and when it ran. This is the memory: both
// 041 and 140 said the next briefing would ground itself in what was actually
// actioned, and neither wired it up, so every briefing re-derived the account
// from nothing and wrote the same paragraphs every week.
//
// Only the most recent completed briefing's items count. Walking further back
// would resurrect things a later briefing deliberately dropped.
async function loadOpenItems(clientId) {
  const { rows: brows } = await pool.query(
    `SELECT id, generated_at FROM strategist_briefings
      WHERE client_id = $1 AND status = 'completed'
      ORDER BY generated_at DESC LIMIT 1`, [clientId]);
  if (!brows.length) return { openItems: [], lastGeneratedAt: null, lastBriefingId: null };

  const { rows } = await pool.query(
    `SELECT id, text, rationale, pillar, priority, first_raised_at
       FROM strategist_briefing_recommendations
      WHERE briefing_id = $1 AND done = false
      ORDER BY first_raised_at ASC, position ASC`, [brows[0].id]);
  return { openItems: rows, lastGeneratedAt: brows[0].generated_at, lastBriefingId: brows[0].id };
}

async function insertRecs(briefingId, clientId, recs) {
  if (!recs.length) return;
  const values = [];
  const params = [briefingId, clientId];
  recs.forEach((r, i) => {
    const base = params.length;
    // first_raised_at defaults to NOW() for a newly raised item; a carried one
    // brings the date it first appeared, which is the age the UI shows.
    values.push(`($1, $2, $${base + 1}, $${base + 2}, ${i + 1}, $${base + 3}, $${base + 4}, COALESCE($${base + 5}::timestamptz, NOW()), $${base + 6}::uuid)`);
    params.push(
      r.pillar, r.priority === 'crucial' ? 'crucial' : 'nice', r.text.slice(0, 1000),
      r.rationale ? String(r.rationale).slice(0, 2000) : null,
      r.first_raised_at || null, r.carried_from || null,
    );
  });
  await pool.query(
    `INSERT INTO strategist_briefing_recommendations
       (briefing_id, client_id, pillar, priority, position, text, rationale, first_raised_at, carried_from)
     VALUES ${values.join(',')}`, params);
}

// Generate a briefing for one client. Synchronous — expect ~1–2 min while the
// five Claude passes run.
async function generate({ clientId, days = 30, trigger = 'manual' }) {
  const { rows: crows } = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  if (!crows.length) throw new Error('Client not found');
  const client = crows[0];
  const ctx = await loadContext(clientId, client);

  // The account lead's steer — their own notes/thoughts to inform this briefing.
  let steer = [];
  try {
    const { rows: srows } = await pool.query(
      'SELECT text FROM strategist_steer_notes WHERE client_id = $1 ORDER BY created_at DESC LIMIT 30',
      [clientId]
    );
    steer = srows.map(r => r.text);
  } catch { /* table optional / best-effort */ }

  // What the last briefing left open. Read before the insert below, so this
  // briefing's own (still empty) row cannot be mistaken for the previous one.
  const { openItems, lastGeneratedAt } = await loadOpenItems(clientId);

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
      Promise.all(PILLARS.map(p => runPillar(p, clientId, days, ctx, steer))),
    ]);

    const synthMd = await claude.callClaude({
      model: MODEL, feature: FEATURE, clientId, max_tokens: 8000,
      system: SYSTEM, user: synthesisPrompt({ ctx, commercial, sections, steer, openItems, lastGeneratedAt }),
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

    // The synthesis queue is the account lead's list, and the only place that
    // threads back to what was already open. The pillar recommendations are
    // evidence behind it: they are kept on their sections rather than merged
    // into the queue, because two lists of the same work is how the old
    // briefing ended up with six items saying one thing.
    //
    // Unless the synthesis wrote no queue at all. Then there is no second list
    // to duplicate, and the choice is between the pillars' own recommendations
    // and a page with nothing on it. A briefing whose entire point is the
    // queue shipping an empty one is the worse failure, and it shipped
    // silently: Falcon's first briefing cost five Claude passes, produced
    // paid and owned recommendations inside the pillar analyses, and threw
    // every one of them away because the synthesis stopped after one line.
    //
    // The prompt that caused that is fixed above. This is the floor under it,
    // because a model can always omit a section and the fix must not depend on
    // it never doing so again.
    const { lines: queueLines, fromPillars } = queueFor(synthMd, sections);
    if (fromPillars || !queueLines.length) {
      console.warn(
        `[strategist] synthesis wrote no queue for client ${clientId}; ` +
        (fromPillars
          ? `falling back to ${queueLines.length} item(s) from the pillar analyses`
          : 'and the pillars had none either, so the queue is genuinely empty')
      );
    }
    const { items, dropped } = reconcile(queueLines, openItems);
    // The model's order IS the priority, so it is preserved as written. Only a
    // nice-to-have that outranks a crucial is corrected, which the prompt asks
    // it not to do but which costs nothing to enforce.
    const ordered = [
      ...items.filter(r => r.priority === 'crucial'),
      ...items.filter(r => r.priority !== 'crucial'),
    ].map(r => ({ ...r, pillar: r.pillar || 'cross' }));
    if (fromPillars) {
      // Said out loud on the page rather than passed off as the strategist's
      // own ranking. These items were never put in order against each other.
      ordered.forEach(r => { r.rationale = `${r.rationale ? r.rationale + ' ' : ''}(From the ${PILLAR_LABEL[r.pillar] || r.pillar} analysis: the briefing did not rank this against the rest.)`; });
    }
    await insertRecs(briefingId, clientId, ordered).catch(e => console.warn('[strategist] rec insert failed:', e.message));
    if (dropped.length) {
      console.log(`[strategist] ${dropped.length} item(s) dropped from the queue for client ${clientId}: ` +
        dropped.map(d => d.text.slice(0, 60)).join(' | '));
    }

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

module.exports = { generate, clientReport, parseRecs, pillarFallbackQueue, queueFor, PILLARS };
