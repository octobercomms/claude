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

async function generateWeeklySummary({ clientName, week, monthlyFocus, metrics, rankMovers = [], chatHistory = [] }) {
  const rankContext = rankMovers.length
    ? `\nRanking movements: ${rankMovers.filter(r => r.change).map(r => `${r.keyword} ${r.change > 0 ? `↑${r.change}` : `↓${Math.abs(r.change)}`} (now ${r.current})`).join(', ')}`
    : '';
  const chatContext = buildChatContext(chatHistory);
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Client: ${clientName}
Week: ${week}
Monthly focus context: ${monthlyFocus || 'No specific focus set.'}
Key metrics this week: ${JSON.stringify(metrics, null, 2)}${rankContext}${chatContext}

Write 2-3 sentences summarising this week's performance. Reference any notable movements and any specific things being tracked in the conversations. Be direct. British English.`,
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
      content: `Write a one-paragraph briefing about this company for use as ongoing context inside a marketing platform.

Company: ${clientName}
Domain: ${domain}
${homepage ? `\nHomepage content (plain text extracted from the live site, may be truncated):\n"""\n${homepage}\n"""\n` : '\n(Could not fetch the homepage — work from the brand name, domain, and web_search.)\n'}
${existingBriefing ? `\nExisting briefing — improve and complete it; keep what's still accurate:\n"""\n${existingBriefing}\n"""\n` : ''}
Cover **all** of the following — infer from the homepage content and use web_search to fill any gaps:
1. **What they sell** — specific product or service category (not just "products")
2. **Who they sell to** — consumer / trade / both; named audience if clear
3. **Where they operate** — countries or regions; whether they ship internationally
4. **Sales channels** — DTC website, retail, wholesale, Amazon, marketplaces, distributors
5. **Notable positioning** — premium / sustainable / award-winning / heritage / etc.

Write a single paragraph of 80–150 words. Lead with what they sell and who they sell to — *not* with what they don't do. Be specific and factual. If a particular point is genuinely unclear from the available content, omit just that point — but you should always be able to say what they sell and where they operate from the homepage.

Respond with just the briefing paragraph. No preamble, no list, no heading.`,
    }],
  });
  const textBlocks = message.content.filter(b => b.type === 'text');
  return textBlocks.length ? textBlocks[textBlocks.length - 1].text.trim() : '';
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
};
