// Refine chat — generic single-turn iteration loop on top of any
// Claude-generated artifact (a content draft body, a brief outline,
// an ad concept block, a social-post batch). The frontend sends the
// current artifact text + the AM's instruction + prior chat turns;
// Claude returns a conversational reply, and OPTIONALLY a revised
// version of the artifact wrapped in a <revision> tag so the
// frontend can offer a one-click "Apply revision" button.
//
// Deliberately stateless server-side. The whole transcript lives in
// the component state — re-loaded only if the AM returns to a saved
// artifact. That keeps the API simple (no chat_id, no persistence,
// no replay) and matches how AMs actually iterate: short bursts of
// 3–6 turns on one artifact, not a long-lived conversation.

const claudeService = require('./claude');
const brandVoice = require('./brandVoice');
const pool = require('../db');

const MODEL = 'claude-sonnet-4-6';

// Per-artifact-kind framing so Claude knows whether it's refining
// long-form prose, an outline, a JSON brief, or ad copy. Each shapes
// the system role and the revision-block format Claude is allowed to
// return.
const KIND_INSTRUCTIONS = {
  draft_markdown: {
    role: "You are a senior content editor refining a long-form blog post. The author has drafted it; you're the second pair of eyes who edits for tightness, voice, and clarity without losing the writer's intent.",
    revisionFormat: 'When the AM asks for a rewrite (of any scope — a sentence, a paragraph, a section, or the whole piece), wrap the revised markdown inside <revision scope="...">...</revision> tags so the frontend can offer an Apply button. The scope attribute should be a short label like "intro paragraph", "section 3", or "whole post" so the AM knows what they\'re applying. Outside the revision tags, give a one or two-sentence rationale — no padding.',
  },
  brief_json: {
    role: "You are an SEO content strategist refining a content brief. The brief is already drafted; you're improving it based on the AM's instructions.",
    revisionFormat: 'When the AM asks for a structural change to the brief, return the full updated JSON brief inside <revision scope="brief">{ ... }</revision>. Outside the tag, briefly explain what you changed.',
  },
  ad_concepts: {
    role: "You are a direct-response copywriter refining a set of ad concepts. Each concept has a framework, angle, headline, body, CTA, and visual direction.",
    revisionFormat: 'When the AM asks for a rewrite, return the updated concept(s) inside <revision scope="concept N">...</revision> using the same field labels as the source.',
  },
  social_post: {
    role: "You are a senior social media strategist refining a single short-form post (Instagram, TikTok, LinkedIn or Facebook). Each post has a HOOK, CAPTION, HASHTAGS, and a frame-by-frame STORYBOARD. You're tightening any of these in line with the AM's instruction — punchier hooks, sharper captions, tighter storyboards.",
    revisionFormat: 'When the AM asks for a rewrite, return the revised post inside <revision scope="post">...</revision> using these labels — only include the labels you actually changed, the frontend keeps the rest as-is:\nHOOK: <one-line hook>\nCAPTION: <full caption, line breaks OK>\nHASHTAGS: <comma-separated, no leading #, max 12>\nSTORYBOARD: <numbered list — "1. frame one. 2. frame two." — one frame per number>\n\nOutside the revision tag, give a one-sentence rationale.',
  },
  outreach_sequence: {
    role: "You are a senior B2B outreach strategist refining a multi-step cold sequence (email + LinkedIn). Steps mix channels — email, linkedin_visit, linkedin_connect, linkedin_message, manual_task — and each has a delay from the previous step. You're tightening the arc: punchier subject lines, shorter bodies, better follow-up cadence, removing redundant steps.",
    revisionFormat: 'When the AM asks for a rewrite — adding, removing, reordering, or rewriting steps — return the COMPLETE replacement sequence inside <revision scope="sequence">...</revision>. Even if the AM only asked you to change one step, emit every step so the apply replaces the whole sequence atomically. Use this exact format, one block per step separated by a blank line:\n\nSTEP 1\nCHANNEL: email | linkedin_visit | linkedin_connect | linkedin_message | manual_task\nDELAY: <integer days from previous step, 0 for the first step>\nSUBJECT: <only for email steps; omit otherwise>\nBODY: <full body for email; task prompt for linkedin/manual steps>\n\nSTEP 2\nCHANNEL: ...\n...\n\nOutside the revision tag, give a one or two-sentence rationale for the structural change.',
  },
};

const SHARED_RULES = `British English. Tight, opinionated, no filler. NEVER use AI tells: "delve into", "leverage", "robust", "moreover", "in conclusion", "comprehensive", "in today's fast-paced world", "it's worth noting", "furthermore". Don't pad responses with framing like "Great question!" or "Here's what I'd do:". Get to the point.`;

async function refine({ clientId, kind, artifact, messages, artifactMeta }) {
  const cfg = KIND_INSTRUCTIONS[kind];
  if (!cfg) throw new Error(`Unknown artifact kind: ${kind}`);
  if (!Array.isArray(messages) || !messages.length) throw new Error('messages required');
  if (artifact == null) throw new Error('artifact required');

  // Brand voice context — same injection as briefs / drafts so the
  // AM's iteration stays in voice.
  const voiceProfile = await brandVoice.loadActiveProfile(clientId);
  const voiceContext = brandVoice.renderForPrompt(voiceProfile);

  // Client name + briefing — small extra grounding so Claude can
  // reference "the brand" by name in its reply.
  const { rows: clientRows } = await pool.query('SELECT name, briefing_field FROM clients WHERE id = $1', [clientId]);
  const client = clientRows[0] || {};

  const system = `${cfg.role}

${SHARED_RULES}

${cfg.revisionFormat}

Client: ${client.name || '(unknown)'}
${client.briefing_field ? `About: ${client.briefing_field}` : ''}${voiceContext}`;

  // The artifact + any extra context (e.g. target keyword on a draft)
  // gets pinned to the FIRST user turn as a system-anchor message
  // so Claude has it for every subsequent turn without us re-sending
  // a giant artifact every message.
  const claudeMessages = [
    {
      role: 'user',
      content: `Current ${kind.replace('_', ' ')} I'm working on${artifactMeta ? ` (${artifactMeta})` : ''}:\n\n${typeof artifact === 'string' ? artifact : JSON.stringify(artifact, null, 2)}`,
    },
    { role: 'assistant', content: 'Got it. What would you like to change?' },
    ...messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || ''),
    })),
  ];

  // Use anthropic SDK directly so we can pass the conversation array
  // verbatim — callClaude is single-shot only.
  const Anthropic = require('@anthropic-ai/sdk');
  const sdk = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const message = await sdk.messages.create({
    model: MODEL,
    max_tokens: 6000,
    system,
    messages: claudeMessages,
  });
  require('./costLog').recordClaudeCost({ model: MODEL, response: message, feature: 'refine_chat' });
  const text = (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

  // Parse out any <revision scope="..."> ...</revision> block so the
  // frontend can render an Apply button under that message.
  const revisionMatch = text.match(/<revision(?:\s+scope=["']([^"']+)["'])?\s*>([\s\S]*?)<\/revision>/);
  const reply = {
    role: 'assistant',
    content: text.replace(/<revision[\s\S]*?<\/revision>/, '').trim(),
  };
  if (revisionMatch) {
    reply.revision = {
      scope: revisionMatch[1] || 'revision',
      content: revisionMatch[2].trim(),
    };
  }
  return reply;
}

module.exports = { refine };
