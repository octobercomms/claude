// Minimal Anthropic client for the QA grade stage. Sends sampled frames + the
// transcript and asks Claude to score the auto-edited cut. The worker carries
// its own ANTHROPIC_API_KEY (it runs on a separate box).

const fs = require('fs');
const axios = require('axios');
const { config } = require('./config');

const GRADE_CRITERIA =
  'Grade this auto-edited vertical short (0–100) on: pacing & dead-air (no awkward gaps), ' +
  'a strong opening hook, captions present and legible & on-brand (if any), framing, and overall ' +
  'ship-ability for social. 85+ = ready to publish.';

async function gradeCut(frames, transcript) {
  const content = frames.map(f => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(f).toString('base64') },
  }));
  content.push({
    type: 'text',
    text: `Transcript (may be empty if no speech):\n"""${String(transcript || '').slice(0, 4000)}"""\n\n${GRADE_CRITERIA}\n\n` +
      `Return ONLY JSON:\n` +
      `{"score": <0-100 integer>, "notes": "one or two sentences on what to fix", ` +
      `"adjust": {"tighten": <0-2 — how much more dead air to cut next pass>, "drop_intro": <true if it opens slow and the first moments should be dropped>}}`,
  });

  const { data } = await axios.post('https://api.anthropic.com/v1/messages', {
    model: config.anthropicModel,
    max_tokens: 400,
    system: 'You are a senior short-form video editor doing QA on an auto-edited cut. Tough but fair. JSON only — no prose, no code fences.',
    messages: [{ role: 'user', content }],
  }, {
    headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    timeout: 60000,
  });

  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const out = JSON.parse(cleaned);
  const adjust = out.adjust && typeof out.adjust === 'object'
    ? { tighten: Math.max(0, Math.min(2, Math.round(Number(out.adjust.tighten) || 0))), drop_intro: !!out.adjust.drop_intro }
    : { tighten: 1, drop_intro: false };
  return { score: Math.max(0, Math.min(100, Math.round(Number(out.score) || 0))), notes: out.notes || '', adjust };
}

module.exports = { gradeCut };
