const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-6';

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

async function generateRecommendations({ clientBriefing, monthlyFocus, data, seoData = {}, chatHistory = [] }) {
  const seoContext = buildSEOContext(seoData);
  const chatContext = buildChatContext(chatHistory);
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Based on this data and context, write a prioritised list of up to 8 recommendations. Each recommendation should be specific and actionable. No generic advice.

About the client: ${clientBriefing || '(no briefing set)'}
Monthly focus: ${monthlyFocus || 'No specific focus set.'}

Marketing data (each section may include an "instruction" from the account manager that should weight that section's recommendation):
${JSON.stringify(data, null, 2)}
${seoContext ? `\nSEO ranking data:\n${seoContext}` : ''}${chatContext}`,
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
// Uses Claude's server-side web_search tool so the result reflects the live
// site, not just training data. The frontend opens the draft in a small
// modal so the account manager can edit before saving.
async function researchBriefing({ clientName, domain, existingBriefing }) {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    system: 'You are a research analyst writing brief, specific company profiles for a B2B marketing-intelligence platform. Use web search to pull current information from the company\'s own website. No marketing fluff, no superlatives — keep it factual.',
    messages: [{
      role: 'user',
      content: `Research this company and write a one-paragraph briefing for use as ongoing context inside a marketing platform.

Company: ${clientName}
Domain: ${domain}
${existingBriefing ? `Existing briefing (keep what's already accurate, improve the rest):\n${existingBriefing}\n\n` : ''}
Cover, where you can find it: what they sell, who they sell to (consumer / trade / both), the countries or regions they operate in, sales channels (DTC, retail, marketplaces, Amazon), and any notable positioning. Keep it factual — if you can't confirm something from the site, leave it out rather than guess.

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
  generateRecommendations,
  generateWeeklySummary,
  researchBriefing,
  suggestMonthlyFocus,
};
