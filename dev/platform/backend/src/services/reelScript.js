// Generate a talking-head reel script with Claude at a chosen length. The
// target duration sets the video's runtime, so we translate seconds → a word
// target (~150 wpm) and ask for just the spoken words in the client's brand
// voice. Output is plain spoken copy — no scene directions — because it goes
// straight to HeyGen as the avatar's script.

const pool = require('../db');
const Anthropic = require('@anthropic-ai/sdk');
const brandVoice = require('./brandVoice');
const { recordClaudeCost } = require('./costLog');

const MODEL = 'claude-sonnet-4-6';
const WPM = 150; // natural speaking pace

async function generate(clientId, { topic, seconds } = {}) {
  const secs = Math.min(240, Math.max(15, parseInt(seconds, 10) || 60));
  const words = Math.round((secs / 60) * WPM);

  const { rows } = await pool.query(
    'SELECT name, domain, briefing_field, monthly_focus FROM clients WHERE id = $1',
    [clientId]
  );
  if (!rows.length) { const e = new Error('Client not found'); e.status = 404; throw e; }
  const c = rows[0];

  // Brand voice, if the client has a profile — keeps the script on-tone.
  let voice = '';
  try {
    const profile = await brandVoice.loadActiveProfile(clientId);
    if (profile) voice = brandVoice.renderForPrompt(profile);
  } catch { /* no profile — fine */ }

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const r = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: `You write scripts for a single talking-head avatar reel (one presenter speaking to camera). Output ONLY the spoken words — no scene directions, camera notes, timestamps, headings, or markdown. It must read as a natural spoken monologue. British English.${voice ? `\n\nWrite in this brand voice:\n${voice}` : ''}`,
    messages: [{
      role: 'user',
      content: `Write a spoken script of about ${words} words (≈ ${secs} seconds at a natural pace) for ${c.name}${c.domain ? ` (${c.domain})` : ''}.

Topic / brief: ${topic || c.monthly_focus || c.briefing_field || 'an engaging, useful update relevant to this brand and its audience'}
${c.briefing_field ? `\nBrand brief: ${c.briefing_field}` : ''}

Hit the target length closely — it sets the video's runtime. Open with a strong hook in the first sentence. Give me just the words to speak.`,
    }],
  });
  recordClaudeCost({ model: MODEL, response: r, feature: 'heygen_reel_script', clientId });

  const script = (r.content.find(b => b.type === 'text')?.text || '').trim();
  if (!script) { const e = new Error('Claude returned an empty script — try again.'); e.status = 502; throw e; }
  return { script, target_seconds: secs, target_words: words };
}

module.exports = { generate };
