// Per-platform caption generation for the social autopilot.
//
// Each target platform has its own conventions — Instagram is emoji-
// friendly with hashtags at the end, LinkedIn is professional and
// line-broken for scannability, Facebook sits between the two. Rather
// than asking the AM to write three captions, we let Claude generate
// one per platform from the locked plan, then surface them in the UI
// for review before publish.
//
// Called by the preview endpoint (Phase 2) and by the publisher cron
// (Phase 3) — same function, same output.

const Anthropic = require('@anthropic-ai/sdk');
const playbooks = require('./playbooks');

const MODEL = 'claude-sonnet-4-6';

function getClient() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

const PLATFORM_BRIEFS = {
  instagram: `Instagram caption.
- 1,500-2,200 characters max — use the upper end only when the story warrants it.
- Open with a hook (first line above the "more" cut) that earns the click.
- Conversational, emoji-friendly but not emoji-spammed (3-6 across the post).
- Line breaks for scannability.
- 5-12 hashtags at the very end, separated by spaces, mix of broad + niche.`,
  facebook: `Facebook caption.
- 200-800 characters, conversational tone.
- Open with a hook. Question or statement that invites engagement.
- Sparse emoji (0-2). Almost no hashtags (0-2 max).
- Plain links allowed and useful — Facebook surfaces them well.`,
  linkedin: `LinkedIn caption.
- 800-1,800 characters. Professional but human.
- Open with a strong first line (the only one shown above the "see more" cut).
- Short paragraphs (1-3 lines). Line breaks for scannability.
- 0-3 hashtags max, only specific ones (avoid #marketing-style filler).
- No emojis unless the brand voice already uses them. Otherwise plain prose.`,
};

const SYSTEM_PROMPT = `You write social media captions for performance-marketing clients of October Communications. You receive a locked post plan and a target platform; you return ONE caption ready to publish, tuned to that platform's conventions. Output the caption text only — no preamble, no "Here's the caption:" wrapper, no markdown. British English. Don't pad. Don't generate generic openers.`;

// Generate one caption for one platform from a locked plan.
async function captionForPlatform(plan, platform) {
  const brief = PLATFORM_BRIEFS[platform];
  if (!brief) throw new Error(`Unsupported platform: ${platform}`);
  const userPrompt = `Platform: ${platform}

Platform conventions:
${brief}

Locked post plan:
${JSON.stringify({
  title: plan?.title,
  audience: plan?.audience,
  hook: plan?.hook,
  framework: plan?.framework,
  scenes: plan?.scenes,
  cta: plan?.cta,
  // Pre-existing caption from the planner — use as a starting point or
  // ignore based on what the platform needs.
  base_caption: plan?.caption,
  base_hashtags: plan?.hashtags,
}, null, 2)}

Return only the caption.`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT + playbooks.systemSuffix(['copywriting']),
    messages: [{ role: 'user', content: userPrompt }],
  });
  return (response.content.find(b => b.type === 'text')?.text || '').trim();
}

// Generate captions for an array of platforms. Sequential rather than
// parallel — keeps the API rate-limit footprint small and the operation
// rarely runs against more than 3 platforms.
async function captionsForPlan(plan, platforms) {
  const out = {};
  for (const p of platforms) {
    try {
      out[p] = await captionForPlatform(plan, p);
    } catch (err) {
      out[p] = `(failed to generate: ${err.message})`;
    }
  }
  return out;
}

module.exports = { captionForPlatform, captionsForPlan };
