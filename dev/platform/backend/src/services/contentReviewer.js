// Independent reviewer pass. A second, adversarial editor reads a draft BEFORE
// it reaches a client and catches the things a one-shot generation misses:
// performance claims the data doesn't support, numbers that contradict the
// data, and house-style slips (hype, filler, American spelling). If it finds
// material problems it returns a corrected draft that fixes only those — it is
// an editor, not a rewriter.
//
// Designed to be non-destructive: any failure, an over-aggressive rewrite, or a
// clean draft all return the original text unchanged, so wiring this into a
// generator can never make the output worse or break the call. Enabled by
// default; set AI_REVIEWER_PASS = 'off' in Settings to skip it.

const Anthropic = require('@anthropic-ai/sdk');
const { recordClaudeCost } = require('./costLog');
const { getSetting } = require('../utils/settings');

const MODEL = 'claude-sonnet-4-6';

function getClient() { return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }); }

const REVIEW_TOOL = {
  name: 'return_review',
  description: 'Return the review verdict and, if the draft needs fixing, a corrected version. Always call this — never reply with free text.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['approved', 'revised'] },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['unsupported_claim', 'contradicts_data', 'hype', 'filler', 'off_brand', 'inaccurate', 'other'] },
            severity: { type: 'string', enum: ['low', 'medium', 'high'] },
            quote: { type: 'string', description: 'The offending phrase from the draft.' },
            note: { type: 'string', description: 'What is wrong and why.' },
          },
          required: ['type', 'severity', 'note'],
        },
      },
      revised: { type: 'string', description: 'The corrected draft. Only when verdict is "revised". Same length, format and voice; fix ONLY the flagged issues; never introduce a fact that is not in the data.' },
    },
    required: ['verdict', 'issues'],
  },
};

function buildSystem(houseStyle) {
  return `You are an independent editor at October Communications, a marketing agency. Another writer produced the draft below and it is about to be sent to a client. You did NOT write it — your job is to catch problems, not to praise or embellish.

Review the draft against:
 - CLAIMS vs DATA: every performance claim must be backed by the data supplied. Flag anything unsupported, and anything that contradicts the numbers or their direction (up/down). Never add a fact that isn't in the data.
 - ACCURACY: figures, percentages and directions must match the data exactly.
 - HOUSE STYLE: British English; commercial, direct, specific. No hype or filler — kill "leading", "innovative", "exciting", "we're thrilled", "in today's fast-paced world", "unlock", "elevate", and generic marketing-speak.
${houseStyle ? ` - EXTRA: ${houseStyle}\n` : ''}
If the draft is clean, return verdict "approved" with an empty issues list and no revised text. If it has real problems, return verdict "revised", list the issues, AND provide a corrected draft that fixes ONLY those issues — same length, same structure, same voice, same (supported) facts. Do not rewrite for taste, do not pad, do not change what isn't broken.`;
}

// Review a draft; return { text, verdict, issues, reviewed }. `text` is the
// draft to use — the corrected version when a material fix was made, else the
// original untouched.
async function review({ draft, kind = 'copy', houseStyle = '', data = null, clientId = null, feature = 'content_review' }) {
  const original = { text: draft, verdict: 'approved', issues: [], reviewed: false };
  if (!draft || !String(draft).trim()) return original;

  // Opt-out switch (defaults on). Only 'off'/'false'/'0' disable it.
  try {
    const flag = (await getSetting('AI_REVIEWER_PASS'));
    if (flag != null && /^(off|false|0|no)$/i.test(String(flag).trim())) return original;
  } catch { /* setting store unavailable — proceed with the default (on) */ }

  const user = `Draft type: ${kind}

Draft to review:
"""
${draft}
"""

${data ? `Data the draft must be consistent with (claims and numbers must trace back to this):\n${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}` : '(no structured data supplied — review for house style and internal consistency only)'}`;

  try {
    const msg = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1600,
      system: [{ type: 'text', text: buildSystem(houseStyle), cache_control: { type: 'ephemeral' } }],
      tools: [REVIEW_TOOL],
      tool_choice: { type: 'tool', name: 'return_review' },
      messages: [{ role: 'user', content: user }],
    });
    recordClaudeCost({ model: MODEL, response: msg, feature, clientId });

    const out = msg.content.find(b => b.type === 'tool_use')?.input || {};
    const issues = Array.isArray(out.issues) ? out.issues : [];
    const material = issues.some(i => i.severity === 'medium' || i.severity === 'high');
    const revised = out.verdict === 'revised' && out.revised ? String(out.revised).trim() : '';

    // Only accept a revision when there is a material issue AND the correction
    // stays close in length — a guard against the editor over-rewriting a draft
    // that was mostly fine.
    if (revised && material) {
      const ratio = revised.length / String(draft).length;
      if (ratio > 0.5 && ratio < 1.8) return { text: revised, verdict: 'revised', issues, reviewed: true };
    }
    return { text: draft, verdict: 'approved', issues, reviewed: true };
  } catch (e) {
    // The reviewer must never break generation — fall back to the original.
    console.error('[contentReviewer] review failed:', e.message);
    return { ...original, error: e.message };
  }
}

module.exports = { review };
