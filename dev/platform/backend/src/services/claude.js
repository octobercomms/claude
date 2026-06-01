const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const MODEL = 'claude-sonnet-4-6';

// Fetch a domain's homepage, strip the HTML, return a chunk of plain text
// suitable for stuffing into a prompt. Best-effort — failures return ''.
async function fetchHomepageText(domain) {
  if (!domain) return '';
  const url = /^https?:\/\//i.test(domain) ? domain : `https://${domain.replace(/\/$/, '')}`;
  try {
    const { data } = await axios.get(url, {
      timeout: 12000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OctoberMI/1.0; +https://platform.octobercomms.com)' },
      validateStatus: () => true,
    });
    if (typeof data !== 'string') return '';
    return data
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 18000);
  } catch {
    return '';
  }
}

function getClient() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

const SYSTEM_PROMPT = `You are a performance marketing analyst writing reports for October Communications, a marketing agency. Write clearly, commercially, without filler or generic language. British English. No hype. Your output will be sent directly to clients.`;

// Single-shot text call used by the template renderer for each narrative
// section. Returns the concatenated text content (no tool use). Keep this
// generic — section-specific framing lives in templateRenderer.js.
async function callClaude({ max_tokens, system, user, model = MODEL }) {
  const message = await getClient().messages.create({
    model,
    max_tokens,
    system: system || SYSTEM_PROMPT,
    messages: [{ role: 'user', content: user }],
  });
  const blocks = (message.content || []).filter(b => b.type === 'text' && b.text);
  return blocks.map(b => b.text).join('\n').trim();
}

// Template builder — turn-based chat that designs a report template
// conversationally. The model has one tool, `propose_template`, which lets
// it surface a draft JSON template the account manager can review and lock.
//
// History is full conversation context (passed in from the frontend); we
// don't store it server-side, the lock action is what persists.
async function chatBuildReportTemplate({ client, reportType, availableConnectors, currentTemplate, history }) {
  const reportTemplate = require('./reportTemplate');
  // Enumerate exactly which metric keys are valid for each connector type
  // present on this client. Without this, Claude was proposing ad-hoc keys
  // (e.g. `conversions` on Shopify, `total_revenue` instead of `revenue`)
  // and the renderer rendered empty cells or duplicate columns for them.
  const presentTypes = Array.from(new Set(availableConnectors.map(c => c.type)));
  const metricCatalogLines = presentTypes
    .filter(t => reportTemplate.METRIC_CATALOG[t])
    .map(t => `- ${t}: ${Object.keys(reportTemplate.METRIC_CATALOG[t]).join(', ')}`)
    .join('\n') || '(no connector catalogs available)';
  const tools = [
    {
      name: 'propose_template',
      description: 'Surface a draft report template for the account manager to review. Call this whenever the template should change — after answering questions, after the AM asks for an edit, or to propose a starting point. The frontend renders the result as a live preview the AM can lock.',
      input_schema: {
        type: 'object',
        properties: {
          template: {
            type: 'object',
            properties: {
              version: { type: 'number' },
              sections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    type: { type: 'string', enum: ['narrative', 'metrics_grid', 'connector_table', 'bar_chart', 'position_distribution'] },
                    sources: {},
                    prompt: { type: 'string' },
                    aggregate: { type: 'string', enum: ['sum', 'list'] },
                    metrics: { type: 'array', items: { type: 'string' } },
                    dimension: { type: 'string' },
                    metric: { type: 'string' },
                    compare: { type: 'string', enum: ['yoy'], description: 'Set to "yoy" on a metrics_grid section to show this period vs the same period one year ago, with delta %. Costs an extra fetch from every source in the section, so use it only when the AM asks for year-on-year — not by default.' },
                  },
                  required: ['id', 'title', 'type'],
                },
              },
            },
            required: ['version', 'sections'],
          },
        },
        required: ['template'],
      },
    },
    {
      name: 'reply_only',
      description: 'Send a plain reply without changing the template. Use this ONLY for genuine clarifying questions you cannot answer yourself, or when the AM is just chatting and not requesting a template change. If the AM asked for an edit or a draft — even a vague one — do NOT use this; call propose_template with your best interpretation instead.',
      input_schema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The message to send to the account manager.' },
        },
        required: ['message'],
      },
    },
  ];

  const system = `You are designing a ${reportType} marketing report template for a client of October Communications. You speak conversationally with the account manager and use the propose_template tool whenever the template should change.

A template is an ordered list of sections. Each section is one of:

- narrative: { id, title, type: "narrative", sources: ["*"] | [{ type, storeLabel? }], prompt: "<what Claude should write>" }
- metrics_grid: { id, title, type: "metrics_grid", sources, aggregate: "sum" | "list", metrics: [ONLY the keys listed for that source's connector type in the metric catalog below — never invent new ones], compare?: "yoy" }
- connector_table: { id, title, type: "connector_table", sources }  (renders the connector's built-in detail tables — campaign performance, top orders, top queries, etc.)
- bar_chart: { id, title, type: "bar_chart", sources: [{ type: "ga4" }], dimension: "channel", metric: "sessions" }
- position_distribution: { id, title, type: "position_distribution" }  (SEO ranking buckets — Top 3 / 4-10 / 11-20 / 21-50 / 51-100 / 100+)

YoY comparisons: a metrics_grid can include compare: "yoy" to show the same period one year earlier with a delta %. Use it whenever the AM mentions "YoY", "year-on-year", "vs last year", or has a section titled with those words. Only metrics_grid supports comparison — not tables or charts.

Source spec: ["*"] means "everything available". An entry like { type: "shopify" } matches all Shopify connectors regardless of store; { type: "shopify", storeLabel: "UK B2C" } matches that specific store.

Aggregate: "sum" combines numeric metrics across matched sources (with AOV recomputed from total revenue / total orders, ROAS recomputed from value / spend). "list" produces one cell per metric per source.

Every turn you MUST call exactly one tool: either propose_template (commits a draft the AM can lock) or reply_only (plain reply, no template change). There is no third option — you cannot send a free-text response. If you have a draft in mind, call propose_template. If you genuinely need clarification before you can draft, call reply_only with the question.

Default to propose_template. The AM can always iterate on a draft, but cannot iterate on a promise of one. Only use reply_only when the AM asked an open question with no implied edit, or when answering "yes/no/which one?" without a draft would be impossible. Never use reply_only to say "let me put that together", "on it", "building now", or anything implying a draft is coming — if a draft is coming, call propose_template now instead.

Don't add sections the AM didn't ask for. Don't try to be exhaustive — a focused 4-6 section report is usually better than 12.

Brief replies. No long explanations. Use British English.`;

  const userIntro = `Client: ${client.name}
About: ${client.briefing_field || '(no briefing set)'}

Connectors currently configured for this client:
${availableConnectors.map(c => `- ${c.type}${c.storeLabel ? ` (${c.storeLabel})` : ''}${c.status !== 'active' ? ` — ${c.status}` : ''}`).join('\n') || '(none yet)'}

Metric catalog (valid keys per connector type — use these exact strings; never invent new ones):
${metricCatalogLines}

${currentTemplate
  ? `Current saved template:\n${JSON.stringify(currentTemplate, null, 2)}`
  : 'No template saved yet — this conversation will produce the first one.'}`;

  const messages = [
    { role: 'user', content: userIntro },
    ...history.map(m => ({ role: m.role, content: m.content })),
  ];

  const response = await getClient().messages.create({
    model: MODEL,
    // A "monthly report" template can carry ~18 sections, each with a
    // type and a metrics list. The full propose_template tool call
    // (input.template object) easily exceeds 2k output tokens; when it
    // does, Claude truncates mid-call and the SDK reports a malformed
    // tool_use — the UI then renders "(no reply)" silently. 16k gives
    // plenty of headroom; the truncation branch below catches anything
    // bigger and surfaces a real error.
    max_tokens: 16384,
    system,
    tools,
    tool_choice: { type: 'any' },
    messages,
  });

  // tool_choice: "any" forces exactly one tool call per turn — either
  // propose_template (commits a draft) or reply_only (text reply). This
  // eliminates the failure mode where Claude says "let me put that together"
  // and then never calls the tool.
  const proposeUses = response.content.filter(b => b.type === 'tool_use' && b.name === 'propose_template');
  const replyUses = response.content.filter(b => b.type === 'tool_use' && b.name === 'reply_only');
  const textBlocks = response.content.filter(b => b.type === 'text');
  const proposed = proposeUses.length ? proposeUses[proposeUses.length - 1].input?.template : null;
  let reply = textBlocks.map(b => b.text).join('\n').trim();
  if (replyUses.length) {
    const replyMsg = replyUses.map(b => b.input?.message).filter(Boolean).join('\n').trim();
    reply = reply ? `${reply}\n${replyMsg}` : replyMsg;
  }
  if (!reply && proposed) reply = 'Updated the draft on the right — let me know what to change.';
  // Truncation path — Claude hit max_tokens mid-tool-call so the
  // template (or the reply) is incomplete. Don't ship a broken
  // proposed template downstream; tell the AM what happened.
  if (response.stop_reason === 'max_tokens' && !reply) {
    console.warn('[report-template chat] hit max_tokens, content blocks:',
      response.content.map(b => ({ type: b.type, name: b.name, len: JSON.stringify(b).length })));
    reply = 'My response hit the size limit before I could finish. Try splitting the request into smaller pieces — e.g. "draft the SEO sections first, then we\'ll add paid traffic".';
    return { reply, proposed: null };
  }
  return { reply, proposed };
}

function buildChatContext(chatHistory) {
  if (!chatHistory?.length) return '';
  const recent = chatHistory.slice(-20);
  const lines = recent.map(m => `${m.role === 'user' ? 'Account manager' : 'Analyst'}: ${m.content}`).join('\n\n');
  return `\nRecent conversations about this client's reporting (use these to understand priorities, what to include/exclude, and what to investigate):\n${lines}`;
}

async function generateExecutiveSummary({ clientName, clientBriefing, period, monthlyFocus, data, seoData = {}, chatHistory = [] }) {
  const seoContext = buildSEOContext(seoData);
  const chatContext = buildChatContext(chatHistory);
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Client: ${clientName}
About the client: ${clientBriefing || '(no briefing set — write a generic summary using the data only)'}
Period: ${period}
Monthly focus: ${monthlyFocus || 'No specific focus set.'}

Marketing data (each section may carry an "instruction" — guidance from the account manager for how to weight that section in the summary; treat it as a directive, not a suggestion):
${JSON.stringify(data, null, 2)}
${seoContext ? `\nSEO ranking data:\n${seoContext}` : ''}${chatContext}

Write an executive summary for this report. 300-400 words. Use the client's "About" line to set tone and vocabulary. Reference the monthly focus and any per-section instructions. Highlight the most significant movements in the data. Call out anything that needs attention. End with one forward-looking sentence about the coming month.`,
    }],
  });
  return message.content[0].text;
}

async function generateWeeklySummary({ clientName, clientBriefing, week, monthlyFocus, metrics, rankMovers = [], sections = [], chatHistory = [] }) {
  const rankContext = rankMovers.length
    ? `\nRanking movements: ${rankMovers.filter(r => r.change).map(r => `${r.keyword} ${r.change > 0 ? `↑${r.change}` : `↓${Math.abs(r.change)}`} (now ${r.current})`).join(', ')}`
    : '';
  const chatContext = buildChatContext(chatHistory);
  // List the connectors the account manager enabled for weekly so Claude
  // knows the scope, and surface any per-section instructions verbatim.
  const enabledScope = sections.length
    ? sections.map(s => `${s.connector}${s.store ? ` (${s.store})` : ''}${s.instruction ? ` — instruction: "${s.instruction}"` : ''}`).join('\n')
    : '(no sections enabled — fall back to the metrics list)';
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Client: ${clientName}
About the client: ${clientBriefing || '(no briefing set)'}
Week: ${week}
Monthly focus context: ${monthlyFocus || 'No specific focus set.'}

Enabled sections for this weekly report (treat these as the ONLY connectors in scope — do NOT mention or summarise anything else, even if you have data for it):
${enabledScope}

Per-section data:
${JSON.stringify(sections, null, 2)}

Flat top-line metrics: ${JSON.stringify(metrics, null, 2)}${rankContext}${chatContext}

Write 2-3 sentences summarising this week's performance for the enabled sections only. Reference any notable movements, weight each section per its instruction, and pick up anything specific being tracked in the conversations. Be direct. British English.`,
    }],
  });
  return message.content[0].text;
}

function buildSEOContext(seoData) {
  const parts = [];
  const rankings = (seoData.rankings || []).filter(k => k.current_position);
  if (rankings.length) {
    const top5 = [...rankings].sort((a, b) => a.current_position - b.current_position).slice(0, 5);
    parts.push(`Top keywords: ${top5.map(k => `${k.keyword} (pos ${k.current_position})`).join(', ')}`);
    const movers = rankings.filter(k => {
      const change = Math.abs((parseInt(k.position_30d_ago) || 0) - (parseInt(k.current_position) || 0));
      return change >= 3;
    });
    if (movers.length) parts.push(`Notable movers: ${movers.map(k => `${k.keyword} ${k.position_30d_ago > k.current_position ? '↑' : '↓'}`).join(', ')}`);
  }
  return parts.join('\n');
}

// Research the client's domain and draft an "About this client" paragraph.
// Fetches the homepage server-side (web_search alone returned SERP snippets
// rather than page content, which made the draft thin and absence-focused),
// then asks Claude to combine that with its own brand knowledge and an
// optional web_search to fill gaps. Output is a complete 80–150 word profile.
async function researchBriefing({ clientName, domain, existingBriefing }) {
  const homepage = await fetchHomepageText(domain);

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    system: 'You are a research analyst writing specific, factual company profiles for a B2B marketing-intelligence platform. Profiles must always describe what the business does and who it serves — not just list which marketing channels they use, and not just enumerate what they lack. Avoid superlatives ("leading", "innovative", "premier"). British English.',
    messages: [{
      role: 'user',
      content: `Write a one-paragraph briefing about this company. Start from scratch — produce a complete, self-contained paragraph that could stand alone with no other context. Never reply with a one-line addendum, a fragment, or a sentence that only adds something to the existing briefing.

Company: ${clientName}
Domain: ${domain}
${homepage ? `\nHomepage content (plain text extracted from the live site, may be truncated):\n"""\n${homepage}\n"""\n` : '\n(Could not fetch the homepage — work from the brand name, domain, and web_search.)\n'}
${existingBriefing ? `\nFor reference only — what the platform previously believed about this client. It may be incomplete or out of date. Do NOT just append to it; do NOT echo it back. Rewrite the whole paragraph from scratch using the homepage content above as your primary source:\n"""\n${existingBriefing}\n"""\n` : ''}
The paragraph must cover **all** of the following — infer from the homepage content first, use web_search only if a specific point is genuinely missing:
1. **What they sell** — specific product or service category (not just "products")
2. **Who they sell to** — consumer / trade / both; named audience if clear
3. **Where they operate** — countries or regions; whether they ship internationally
4. **Sales channels** — DTC website, retail, wholesale, Amazon, marketplaces, distributors
5. **Notable positioning** — premium / sustainable / award-winning / heritage / etc.

Write a single paragraph of 80–150 words. Lead with what they sell and who they sell to — *not* with what they don't do. Be specific and factual. If a particular point is genuinely unclear, omit just that point — but always state what they sell and where they operate.

Respond with just the briefing paragraph. No preamble, no list, no heading. Minimum 80 words — never a one-liner or addendum.`,
    }],
  });
  // Claude produces multiple text blocks when web_search runs (a short
  // planning text before each search, then the final answer). Taking the
  // LAST block returns whatever Claude wrote last — which can be a stray
  // sentence if the model finished with an addendum. The substantive
  // briefing is the longest block.
  const textBlocks = message.content.filter(b => b.type === 'text' && b.text?.trim());
  if (!textBlocks.length) return '';
  const longest = textBlocks.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  return longest.text.trim();
}

// Draft a "this month's focus" suggestion from the data we already have:
// last few months' focuses (for continuity), the AI Data Analyst's open
// investigations / decisions from the context log, and a quick connector
// health summary. Returns just a short paragraph.
async function suggestMonthlyFocus({ client, previousFocuses = [], openContextItems = [], connectorStatus = [] }) {
  const lastFocus = previousFocuses[0]?.focus_text || '';
  const earlier = previousFocuses.length > 1
    ? previousFocuses.slice(1).map(p => `${p.month}/${p.year}: ${p.focus_text}`).join('\n')
    : '';
  const openItems = openContextItems.length
    ? openContextItems.map(i => `[${i.type}] ${i.content}`).join('\n')
    : 'None.';
  const issues = connectorStatus.filter(c => c.status !== 'active');
  const connectorLine = issues.length
    ? `Connectors with issues: ${issues.map(c => `${c.connector_type}${c.store_label ? ` (${c.store_label})` : ''} — ${c.status}${c.error_message ? ': ' + c.error_message : ''}`).join('; ')}`
    : `All ${connectorStatus.length} connectors active.`;

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Suggest the focus for the next monthly report for this client.

Client: ${client.name}
About: ${client.briefing_field || '(briefing not set)'}

Previous focus (last month): ${lastFocus || '(not set)'}
${earlier ? `Earlier focuses:\n${earlier}\n` : ''}
Open items from the AI Data Analyst's context log:
${openItems}

${connectorLine}

Write a focused 60-100 word paragraph describing what THIS month's report should emphasise. Be specific — name connectors, regions, metrics or open investigations where relevant. Don't repeat last month's focus verbatim if the issue is resolved; if it's still open, carry it forward with progress noted.

Respond with just the paragraph. No preamble, no list, no heading.`,
    }],
  });
  const textBlocks = message.content.filter(b => b.type === 'text');
  return textBlocks.length ? textBlocks[textBlocks.length - 1].text.trim() : '';
}

module.exports = {
  generateExecutiveSummary,
  generateWeeklySummary,
  researchBriefing,
  suggestMonthlyFocus,
  callClaude,
  chatBuildReportTemplate,
};
