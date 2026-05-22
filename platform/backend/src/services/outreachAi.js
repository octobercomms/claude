const Anthropic = require('@anthropic-ai/sdk');
const { getSetting } = require('../utils/settings');

const MODEL = 'claude-sonnet-4-6';

// Draft a 3-email outreach sequence for a campaign.
// Ported from the October Outreach plugin's OO_Claude::write_sequence.
async function writeSequence(campaign, instructions = '') {
  const apiKey = await getSetting('CLAUDE_API_KEY');
  if (!apiKey) throw new Error('Claude API key not configured — add it in Settings.');
  const client = new Anthropic({ apiKey: apiKey.trim() });

  const system = "You are an expert B2B email copywriter. You write concise, warm, non-salesy "
    + "cold-outreach emails that feel personal and human. Never use generic phrases like "
    + "'I hope this email finds you well' or 'I am reaching out because'. Keep each email under 150 words.";

  let prompt = 'Write a 3-email outreach sequence for this campaign:\n\n';
  prompt += `Campaign: ${campaign.name}\n`;
  prompt += `Audience: ${campaign.audience_description || 'not specified'}\n`;
  if (instructions) prompt += `Instructions: ${instructions}\n`;
  prompt += '\nEmail 1: Initial outreach (day 0)\n';
  prompt += 'Email 2: Follow-up if no reply (day 4) — different angle, shorter\n';
  prompt += 'Email 3: Final nudge (day 9) — brief, low-pressure close\n\n';
  prompt += "Use {{first_name}} as a placeholder for the recipient's first name.\n\n";
  prompt += 'Respond as valid JSON only:\n';
  prompt += '[{"step":1,"subject":"...","body":"...","delay_days":0},{"step":2,"subject":"...","body":"...","delay_days":4},{"step":3,"subject":"...","body":"...","delay_days":9}]';

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = resp.content.find(b => b.type === 'text')?.text || '';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Claude did not return a usable sequence.');
  let steps;
  try {
    steps = JSON.parse(match[0]);
  } catch {
    throw new Error('Claude returned malformed JSON for the sequence.');
  }
  const defaults = [0, 4, 9];
  return steps.map((s, i) => ({
    step_number: s.step || i + 1,
    subject: s.subject || '',
    body: s.body || '',
    delay_days: s.delay_days ?? defaults[i] ?? 0,
  }));
}

module.exports = { writeSequence };
