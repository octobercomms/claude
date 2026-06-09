// Internal Strategist reports — Manus-style ad performance analyses.
//
// Pulls Meta Ads + Google Ads data for the last N days (default 7) and
// the matching previous period for week-over-week comparison, plus the
// most recent prior Strategist report so Claude can write a true "since
// the last report" narrative. Output is markdown intended for AM eyes
// only — never sent to a client.

const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db');
const dataCollector = require('./dataCollector');
const adAudit = require('./adAudit');
const playbooks = require('./playbooks');

const MODEL = 'claude-sonnet-4-6';
const SYSTEM_PROMPT = `You are an internal performance marketing strategist writing a private briefing note for an account manager at October Communications, a UK marketing agency. The reader is the AM — not the client. Write like a senior strategist talking to a colleague: confident, specific, commercially literate, British English. No hype, no filler, no generic advice. Recommendations must be specific enough to act on tomorrow ("pause ad X in ad set Y because…"), not generic ("consider improving creative"). If the data is thin or the period is too short to draw conclusions, say so plainly.`;

function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

// Reduce a meta_ads connector payload to per-campaign rows so we can
// feed Claude a concise structured table rather than a 5k-line JSON dump.
function summariseMeta(payload) {
  const rows = payload?.data || [];
  return rows.map(r => {
    const spend = parseFloat(r.spend || 0);
    const purchases = parseFloat(r.actions?.find(a => a.action_type === 'purchase')?.value || 0);
    const purchaseValue = parseFloat(r.action_values?.find(a => a.action_type === 'purchase')?.value || 0);
    const addToCart = parseFloat(r.actions?.find(a => a.action_type === 'add_to_cart')?.value || 0);
    const initiateCheckout = parseFloat(r.actions?.find(a => a.action_type === 'initiate_checkout')?.value || 0);
    const linkClicks = parseFloat(r.actions?.find(a => a.action_type === 'link_click')?.value || 0);
    return {
      campaign: r.campaign_name,
      objective: r.objective,
      spend,
      impressions: parseInt(r.impressions || 0, 10),
      reach: parseInt(r.reach || 0, 10),
      clicks: parseInt(r.clicks || 0, 10),
      link_clicks: linkClicks,
      ctr: parseFloat(r.ctr || 0),
      cpc: parseFloat(r.cpc || 0),
      cpm: parseFloat(r.cpm || 0),
      frequency: parseFloat(r.frequency || 0),
      add_to_cart: addToCart,
      initiate_checkout: initiateCheckout,
      purchases,
      purchase_value: purchaseValue,
      roas: spend > 0 ? purchaseValue / spend : null,
    };
  });
}

function summariseGoogle(payload) {
  const results = payload?.results || (Array.isArray(payload) ? payload.flatMap(b => b.results || []) : []);
  const map = {};
  for (const r of results) {
    const name = r.campaign?.name || 'Unknown';
    const m = r.metrics || {};
    if (!map[name]) {
      map[name] = {
        campaign: name,
        spend: 0, impressions: 0, clicks: 0,
        conversions: 0, conversion_value: 0,
      };
    }
    map[name].spend += parseInt(m.costMicros || 0, 10) / 1_000_000;
    map[name].impressions += parseInt(m.impressions || 0, 10);
    map[name].clicks += parseInt(m.clicks || 0, 10);
    map[name].conversions += parseFloat(m.conversions || 0);
    map[name].conversion_value += parseFloat(m.conversionsValue || 0);
  }
  return Object.values(map).map(r => ({
    ...r,
    ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
    cpc: r.clicks > 0 ? r.spend / r.clicks : 0,
    cpa: r.conversions > 0 ? r.spend / r.conversions : null,
    roas: r.spend > 0 ? r.conversion_value / r.spend : null,
  }));
}

function totalsMeta(rows) {
  return rows.reduce((a, r) => ({
    spend: a.spend + r.spend, impressions: a.impressions + r.impressions,
    clicks: a.clicks + r.clicks, link_clicks: a.link_clicks + r.link_clicks,
    add_to_cart: a.add_to_cart + r.add_to_cart,
    initiate_checkout: a.initiate_checkout + r.initiate_checkout,
    purchases: a.purchases + r.purchases, purchase_value: a.purchase_value + r.purchase_value,
  }), { spend: 0, impressions: 0, clicks: 0, link_clicks: 0, add_to_cart: 0, initiate_checkout: 0, purchases: 0, purchase_value: 0 });
}

function totalsGoogle(rows) {
  return rows.reduce((a, r) => ({
    spend: a.spend + r.spend, impressions: a.impressions + r.impressions,
    clicks: a.clicks + r.clicks,
    conversions: a.conversions + r.conversions,
    conversion_value: a.conversion_value + r.conversion_value,
  }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 });
}

// Pull a snapshot of Meta + Google ads data for [start, end] and reduce
// it to per-campaign + totals JSON that's safe to feed into a prompt.
// dataCollector keys results by `${connector_type}` OR
// `${connector_type}:${store_label}` when the connector has an account
// label (most clients with multiple ad accounts do), so we have to scan
// every key that starts with the connector type rather than indexing by
// the bare name.
async function snapshot(clientId, start, end) {
  const collected = await dataCollector.collectClientData(clientId, ymd(start), ymd(end));
  const data = collected.data || {};
  const collect = (prefix) => Object.entries(data)
    .filter(([k]) => k === prefix || k.startsWith(prefix + ':'))
    .map(([k, v]) => ({ label: k.includes(':') ? k.slice(prefix.length + 1) : null, payload: v }));

  const metaAccounts = collect('meta_ads').map(({ label, payload }) => ({
    account: label,
    campaigns: summariseMeta(payload),
  }));
  const googleAccounts = collect('google_ads').map(({ label, payload }) => ({
    account: label,
    campaigns: summariseGoogle(payload),
  }));
  const metaAllCampaigns = metaAccounts.flatMap(a => a.campaigns.map(c => ({ ...c, account: a.account })));
  const googleAllCampaigns = googleAccounts.flatMap(a => a.campaigns.map(c => ({ ...c, account: a.account })));

  return {
    period_start: ymd(start),
    period_end: ymd(end),
    meta: { accounts: metaAccounts, campaigns: metaAllCampaigns, totals: totalsMeta(metaAllCampaigns) },
    google: { accounts: googleAccounts, campaigns: googleAllCampaigns, totals: totalsGoogle(googleAllCampaigns) },
    errors: collected.errors || {},
  };
}

// Render the deterministic rubric audit (adAudit.scoreSnapshot) as a compact
// markdown block Claude can lean on as the spine of its scorecard.
function renderAudit(audit) {
  if (!audit || audit.score == null) return '';
  const cats = audit.categories.map(c => {
    const head = `- **${c.label}** — ${c.status}${c.score != null ? ` (${Math.round(c.score * 100)}/100)` : ''}`;
    const findings = c.findings
      .filter(f => f.status !== 'na')
      .map(f => `    - ${f.label}: ${f.status} — ${f.evidence}`)
      .join('\n');
    return findings ? `${head}\n${findings}` : head;
  }).join('\n');
  return `# Deterministic ad-health audit (rubric-scored)
A rule-based scorer has already graded this account against a fixed rubric (methodology adapted from claude-ads). Use it as the SPINE of your Summary Scorecard and cite the overall score in your Executive Summary. Don't contradict a finding's evidence — you may add nuance and the "why".

Overall ad-health score: **${audit.score}/100** (${audit.status}); confidence: ${audit.confidence}.

${cats}
`;
}

function buildPrompt({ client, current, previous, previousReport, previousActions = [], audit = null }) {
  const hasMeta = current.meta.campaigns.length > 0;
  const hasGoogle = current.google.campaigns.length > 0;
  const platforms = [hasMeta && 'Meta Ads', hasGoogle && 'Google Ads'].filter(Boolean).join(' and ') || 'Meta Ads + Google Ads';

  return `You are writing an internal Strategist report for **${client.name}** covering ${current.period_start} to ${current.period_end} (${platforms}).

# Audience
- Reader: account manager at October Communications. Knows the client well, knows ads platforms.
- Tone: senior strategist, peer-to-peer. No client-facing softening. British English. No emojis.
- Goal: tell the AM exactly what to do Monday morning.

# Output shape
Write a markdown document with these sections, in this order. Skip a section only if there is genuinely no data for it.

1. **Executive Summary** — 1 paragraph. Lead with the overall ad-health score (NN/100) from the deterministic audit below. Total spend, headline result (ROAS, purchases, conversions). One sentence on the single biggest issue and the single biggest opportunity.
2. **Campaign Overview** — markdown table of headline metrics (Total spend, Impressions, Reach, Frequency, CPM, CTR, CPC, Add to cart, Initiate checkout, Purchases / Conversions, Cost per purchase / CPA, ROAS). Include benchmark column for retail/ecommerce where you have a defensible benchmark.
3. **Platform breakdown** — one subsection per platform (Meta / Google) if both are running. Per-campaign table with the campaign name, spend, key actions, ROAS or CPA. Identify the converter(s) and the budget drains by name.
4. **What changed since the last report** — only if a previous report is provided. Diff: spend delta, new converters, new drains, ad sets that have wound down. Reference the previous report's date.
5. **Recommendations** — numbered list, **ordered by expected impact**. Each item names the specific campaign / ad set / creative, says what to do, and why (the data evidence). Be willing to recommend "pause this specific ad in this specific ad set" not just "review creatives".
6. **Summary Scorecard** — markdown table built from the deterministic audit below: one row per audit category carrying its Status (Healthy / Strong / Weak / Broken / Mixed) and a Priority Action column. You may add extra rows (e.g. a specific creative, landing page, pixel/conversion tracking) where the data supports them, but keep the audit categories as the backbone and don't restate a status that contradicts the audit's evidence.

# Constraints
- Cite specific numbers from the data (spend, CPC, ROAS). Do not invent.
- If the data is too thin (< £100 spend, < 1 full week, no purchases at all) say so plainly and recommend "give it more time / more budget / more data" rather than over-interpreting.
- Don't refuse to make recommendations because data is imperfect. Make the best recommendation you can given the data.
- Do not include a header or sign-off line — the UI adds its own.

${renderAudit(audit)}
# Current period snapshot
\`\`\`json
${JSON.stringify(current, null, 2)}
\`\`\`

# Previous period snapshot (same length, immediately preceding)
\`\`\`json
${JSON.stringify(previous, null, 2)}
\`\`\`

${previousReport ? `# Previous Strategist report (for "since last report" diff)
Generated on ${new Date(previousReport.generated_at).toISOString().slice(0,10)} for ${previousReport.period_start} to ${previousReport.period_end}.

\`\`\`markdown
${previousReport.markdown}
\`\`\`
${previousActions && previousActions.length ? `
# Previous recommendations — what the AM actually did

You can grade follow-through. Use this to: (a) congratulate the AM on completed actions and report measurable impact in this period's data, and (b) re-raise any that were skipped IF the data still warrants action. Don't recycle items as fresh recommendations — frame them as "still open" / "now resolved" / "graded".

${previousActions.map(a => `${a.position}. ${a.done ? '✅ DONE' : '⬜ NOT DONE'} — ${a.text}${a.notes ? `\n   (AM note: ${a.notes})` : ''}`).join('\n')}
` : ''}
` : '# No previous Strategist report on file — this is the first.'}`;
}

async function callClaude({ system, user, max_tokens = 8000 }) {
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const blocks = (message.content || []).filter(b => b.type === 'text' && b.text);
  return blocks.map(b => b.text).join('\n').trim();
}

// Public — generate a Strategist report for the given client. Synchronous;
// callers should expect ~30-60s while Claude writes the document.
async function generate({ clientId, periodDays = 7, trigger = 'manual' }) {
  const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  if (!rows.length) throw new Error('Client not found');
  const client = rows[0];

  const end = new Date();
  end.setUTCHours(23, 59, 59, 0);
  const start = addDays(end, -(periodDays - 1));
  start.setUTCHours(0, 0, 0, 0);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(periodDays - 1));

  const placeholder = await pool.query(
    `INSERT INTO strategist_reports (client_id, period_start, period_end, status, trigger)
     VALUES ($1, $2, $3, 'generating', $4) RETURNING id`,
    [clientId, ymd(start), ymd(end), trigger]
  );
  const reportId = placeholder.rows[0].id;

  try {
    const [current, previous] = await Promise.all([
      snapshot(clientId, start, end),
      snapshot(clientId, prevStart, prevEnd),
    ]);

    // No ads data at all — short-circuit with a useful note instead of
    // calling Claude on an empty payload.
    if (!current.meta.campaigns.length && !current.google.campaigns.length) {
      const errLines = Object.entries(current.errors || {})
        .filter(([k]) => k.startsWith('meta_ads') || k.startsWith('google_ads'))
        .map(([k, v]) => `- **${k}**: ${v}`)
        .join('\n');
      const msg = `_No Meta Ads or Google Ads data for ${ymd(start)} – ${ymd(end)}._\n\n` +
        (errLines
          ? `One or more ads connectors returned an error:\n\n${errLines}\n\nFix them on the Setup → Connectors tab and try again.`
          : `Either no campaigns ran in this window or the connectors aren't authorised for this client. Check the Setup → Connectors tab.`);
      await pool.query(
        `UPDATE strategist_reports
            SET status = 'completed', markdown = $1, data_snapshot = $2
          WHERE id = $3`,
        [msg, { current, previous }, reportId]
      );
      return reportId;
    }

    const { rows: priorRows } = await pool.query(
      `SELECT id, period_start, period_end, generated_at, markdown
         FROM strategist_reports
        WHERE client_id = $1 AND status = 'completed' AND id <> $2
        ORDER BY generated_at DESC LIMIT 1`,
      [clientId, reportId]
    );
    const previousReport = priorRows[0] || null;

    // Previous recommendations with done/notes state — passed to Claude
    // so the next briefing can grade follow-through ("Last week you
    // recommended X — done, here's the impact"; "you didn't act on Y —
    // worth revisiting because…").
    let previousActions = [];
    if (previousReport) {
      const { rows: actionRows } = await pool.query(
        `SELECT position, text, done, notes FROM strategist_recommendations
          WHERE report_id = $1 ORDER BY position ASC`,
        [previousReport.id]
      );
      previousActions = actionRows;
    }

    // Deterministic rubric score (claude-ads methodology) + paid-ads
    // methodology playbook (marketingskills). The score anchors the scorecard;
    // the playbook grounds the recommendations. Both degrade gracefully — a
    // null audit just omits the block, a missing playbook just omits the
    // methodology section.
    const audit = adAudit.scoreSnapshot(current);
    const adsPlaybook = playbooks.getPlaybook('ads');
    const system = adsPlaybook
      ? `${SYSTEM_PROMPT}\n\n# Methodology to apply\nGround your analysis and recommendations in this paid-ads methodology:\n\n${adsPlaybook}`
      : SYSTEM_PROMPT;

    const prompt = buildPrompt({ client, current, previous, previousReport, previousActions, audit });
    const markdown = await callClaude({ system, user: prompt });

    await pool.query(
      `UPDATE strategist_reports
          SET status = 'completed', markdown = $1, data_snapshot = $2
        WHERE id = $3`,
      [markdown, { current, previous, audit }, reportId]
    );

    // Parse the Recommendations section into individual rows so the AM
    // can tick them off. Best-effort — if parsing finds nothing the
    // briefing still renders normally, just without the checklist.
    try {
      const items = extractRecommendations(markdown);
      if (items.length) {
        const values = items.map((_t, i) => `($1, $2, ${i + 1}, $${i + 3})`).join(',');
        await pool.query(
          `INSERT INTO strategist_recommendations (report_id, client_id, position, text)
           VALUES ${values}`,
          [reportId, clientId, ...items]
        );
      }
    } catch (parseErr) {
      console.warn('[strategist] recommendation parse failed:', parseErr.message);
    }

    return reportId;
  } catch (err) {
    await pool.query(
      `UPDATE strategist_reports
          SET status = 'failed', error_message = $1
        WHERE id = $2`,
      [err.message.slice(0, 2000), reportId]
    ).catch(() => {});
    throw err;
  }
}

// Pull the numbered Recommendations list out of the briefing markdown.
// Looks for a heading containing "Recommendation" (or "Recommended
// actions") and collects the numbered items beneath it until the next
// heading. Returns the cleaned text of each item — no leading numbering.
function extractRecommendations(markdown) {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  let inSection = false;
  let buffer = '';
  const items = [];
  function flush() {
    const t = buffer.trim();
    if (t) items.push(t);
    buffer = '';
  }
  for (const line of lines) {
    const isHeading = /^#{1,6}\s/.test(line);
    if (isHeading) {
      if (inSection) { flush(); inSection = false; }
      if (/^#{1,6}\s.*recommend/i.test(line)) inSection = true;
      continue;
    }
    if (!inSection) continue;
    const numStart = line.match(/^\s*\d+\.\s+(.*)$/);
    if (numStart) {
      flush();
      buffer = numStart[1];
    } else if (buffer && line.trim()) {
      buffer += ' ' + line.trim();
    } else if (!line.trim()) {
      // blank line — keep accumulating across paragraphs within an item
    }
  }
  flush();
  return items.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

module.exports = { generate, extractRecommendations };
