const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-6';

function getClient() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

const SYSTEM_PROMPT = `You are a performance marketing analyst writing reports for October Communications, a marketing agency. Write clearly, commercially, without filler or generic language. British English. No hype. Your output will be sent directly to clients.`;

async function generateExecutiveSummary({ clientName, period, monthlyFocus, data, seoData = {} }) {
  const seoContext = buildSEOContext(seoData);
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Client: ${clientName}
Period: ${period}
Monthly focus: ${monthlyFocus || 'No specific focus set.'}
Marketing data: ${JSON.stringify(data, null, 2)}
${seoContext ? `SEO ranking data:\n${seoContext}` : ''}

Write an executive summary for this report. 300-400 words. Reference the monthly focus. Highlight the most significant movements in the data. If SEO ranking shifts are notable, mention them. Call out anything that needs attention. End with one forward-looking sentence about the coming month.`,
    }],
  });
  return message.content[0].text;
}

async function generateRecommendations({ monthlyFocus, data, seoData = {} }) {
  const seoContext = buildSEOContext(seoData);
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Based on this data and the monthly focus below, write a prioritised list of up to 8 recommendations. Each recommendation should be specific and actionable. No generic advice.

Monthly focus: ${monthlyFocus || 'No specific focus set.'}
Marketing data: ${JSON.stringify(data, null, 2)}
${seoContext ? `SEO ranking data:\n${seoContext}` : ''}`,
    }],
  });
  return message.content[0].text;
}

async function generateWeeklySummary({ clientName, week, monthlyFocus, metrics, rankMovers = [] }) {
  const rankContext = rankMovers.length
    ? `\nRanking movements: ${rankMovers.filter(r => r.change).map(r => `${r.keyword} ${r.change > 0 ? `↑${r.change}` : `↓${Math.abs(r.change)}`} (now ${r.current})`).join(', ')}`
    : '';
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Client: ${clientName}
Week: ${week}
Monthly focus context: ${monthlyFocus || 'No specific focus set.'}
Key metrics this week: ${JSON.stringify(metrics, null, 2)}${rankContext}

Write 2-3 sentences summarising this week's performance. Reference any notable movements including rankings if present. Be direct. British English.`,
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

async function parseConnectorBriefing(briefingText) {
  const validTypes = [
    'ga4', 'google_search_console', 'google_ads', 'google_merchant_center',
    'meta_ads', 'instagram_insights', 'shopify', 'woocommerce',
    'klaviyo', 'brevo', 'shopify_email', 'amazon_seller', 'dataforseo',
  ];

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: 'You are a marketing technology expert. Respond only with valid JSON.',
    messages: [{
      role: 'user',
      content: `Based on this client briefing, which connectors should be activated?

Valid connector types: ${validTypes.join(', ')}

Client briefing: ${briefingText}

Return JSON in this format:
{
  "suggested_connectors": [
    { "type": "connector_type", "reason": "brief reason", "store_label": "optional label for multi-store" }
  ],
  "notes": "any important notes"
}

Only suggest connectors from the valid types list. For Shopify with multiple stores, create one entry per store with a unique store_label.`,
    }],
  });

  const text = message.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse Claude response');
  return JSON.parse(jsonMatch[0]);
}

module.exports = {
  generateExecutiveSummary,
  generateRecommendations,
  generateWeeklySummary,
  parseConnectorBriefing,
};
