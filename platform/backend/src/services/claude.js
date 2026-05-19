const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-6';

function getClient() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

const SYSTEM_PROMPT = `You are a performance marketing analyst writing reports for October Communications, a marketing agency. Write clearly, commercially, without filler or generic language. British English. No hype. Your output will be sent directly to clients.`;

async function generateExecutiveSummary({ clientName, period, monthlyFocus, data }) {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Client: ${clientName}
Period: ${period}
Monthly focus: ${monthlyFocus || 'No specific focus set.'}
Data: ${JSON.stringify(data, null, 2)}

Write an executive summary for this report. 300-400 words. Reference the monthly focus. Highlight the most significant movements in the data. Call out anything that needs attention. End with one forward-looking sentence about the coming month.`,
    }],
  });
  return message.content[0].text;
}

async function generateRecommendations({ monthlyFocus, data }) {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Based on this data and the monthly focus below, write a prioritised list of up to 8 recommendations. Each recommendation should be specific and actionable. No generic advice.

Monthly focus: ${monthlyFocus || 'No specific focus set.'}
Data: ${JSON.stringify(data, null, 2)}`,
    }],
  });
  return message.content[0].text;
}

async function generateWeeklySummary({ clientName, week, monthlyFocus, metrics }) {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Client: ${clientName}
Week: ${week}
Monthly focus context: ${monthlyFocus || 'No specific focus set.'}
Key metrics this week: ${JSON.stringify(metrics, null, 2)}

Write 2-3 sentences summarising this week's performance. Reference any notable movements. Be direct. British English.`,
    }],
  });
  return message.content[0].text;
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
