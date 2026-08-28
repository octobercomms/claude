// Drafting — one personalised outbound message per prospect (never a template),
// and AI-drafted replies. Everything comes back as a draft; nothing sends here.
// Stays on Claude for quality (feature outreach_draft / outreach_reply).

const claude = require('../claude');

function parseJson(text) {
  if (!text) return null;
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const cand = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(cand.trim()); } catch { return null; }
}

const VOICE = `Write like one real person emailing another — warm, brief, specific, no marketing gloss, no hype, British English, no em dashes. Never repeat a case study verbatim or sound templated. Reference the one specific fact so it's obvious this was written for them. A soft, single call to action. End with a genuine, low-key opt-out line in natural language (e.g. "If this isn't relevant just say and I'll not email again"). Keep it short — a real cold note, not a brochure.`;

// Draft outbound step `step` of the sequence for a prospect.
async function draftOutbound({ prospect, campaign, identity, step = 1 }) {
  const stepSpec = (campaign.sequence || [])[step - 1] || {};
  const system = `You draft selective, trust-first B2B outbound emails for ${identity?.from_name || 'the sender'} at October's client. ${VOICE}

Sender: ${identity?.from_name || '—'} <${identity?.from_email || '—'}>
What we offer / who we are: ${campaign.icp ? `we help companies like the recipient (context: ${campaign.icp})` : '(context not set)'}
This is step ${step} of the sequence. Angle for this step: ${stepSpec.angle || (step === 1 ? 'first touch — earn attention with the specific fact, offer a short call' : 'gentle, brief follow-up that adds one new reason, never nags')}.
Booking: ${campaign.booking_url ? `offer this real booking link only if inviting a call: ${campaign.booking_url}` : 'no booking link set — invite a reply to find a time instead'}.

Return ONLY JSON: {"subject": "...", "body": "..."} — body is plain text with real line breaks.`;
  const user = `Prospect:
Company: ${prospect.company || '—'}
Contact: ${prospect.contact_name || 'there'}${prospect.role ? ` (${prospect.role})` : ''}
The one specific fact to reference: ${prospect.one_fact || '(none found — open honestly and generally, do not fabricate a fact)'}`;
  const text = await claude.callClaude({ max_tokens: 700, system, user, feature: 'outreach_draft' });
  const o = parseJson(text) || {};
  return { subject: String(o.subject || '').trim() || 'Quick note', body: String(o.body || '').trim() };
}

// Draft a reply to an inbound message — reads what they actually said (the TCPR
// failure was ignoring the reply). Comes back as a draft for approval.
async function draftReply({ prospect, campaign, identity, thread, incoming }) {
  const system = `You draft a reply for ${identity?.from_name || 'the sender'} to a prospect who has responded to a cold email. ${VOICE}

READ what they actually said and respond to it directly — acknowledge objections honestly (if they say they're not a fit, say so gracefully and offer the opt-out). Only push for a call if it genuinely makes sense. ${campaign.booking_url ? `Real booking link if a call is warranted: ${campaign.booking_url}.` : ''}

Return ONLY JSON: {"subject": "...", "body": "..."}.`;
  const user = `Prospect: ${prospect.contact_name || 'there'} at ${prospect.company || '—'}.
Conversation so far:
${(thread || []).map(m => `${m.direction === 'out' ? 'Us' : 'Them'}: ${m.body}`).join('\n\n')}

Their latest reply:
"""
${incoming || ''}
"""`;
  const text = await claude.callClaude({ max_tokens: 700, system, user, feature: 'outreach_reply' });
  const o = parseJson(text) || {};
  return { subject: String(o.subject || '').trim() || `Re: ${prospect.company || ''}`.trim(), body: String(o.body || '').trim() };
}

module.exports = { draftOutbound, draftReply };
