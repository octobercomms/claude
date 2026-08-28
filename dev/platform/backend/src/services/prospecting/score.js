// Fit-gate — score a prospect against the campaign's ICP + disqualifier rules
// BEFORE it's eligible for drafting. The disqualifier check (e.g. "is a
// PR/marketing agency") is the TCPR failure this exists to prevent. Suppressed
// prospects are auto-disqualified. Runs on the model chosen in Settings → AI
// models (public company data only — safe for DeepSeek).

const claude = require('../claude');
const suppression = require('./suppression');

function parseJson(text) {
  if (!text) return null;
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const cand = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(cand.trim()); } catch { return null; }
}

function system(campaign) {
  return `You qualify outbound-sales prospects for a selective, trust-first outreach programme. Decide whether a prospect is a genuine fit BEFORE any email is drafted. Be strict — the whole point is to only contact real fits.

Who we want (ICP):
${campaign.icp || '(no ICP set — judge conservatively and prefer "maybe")'}

Hard disqualifiers (if any apply, verdict MUST be "disqualified"):
${campaign.disqualifiers || '(none set)'}

Return ONLY JSON: {"score": 0-100, "verdict": "fit|maybe|disqualified", "reasoning": "<= 20 words", "one_fact": "one specific, true, recent fact about this company an opener could reference (or null)"}.
- "fit" = clearly in ICP and not disqualified.
- "disqualified" = a hard disqualifier applies, or clearly not the ICP.
- "maybe" = plausible but unclear.
Never invent facts. If you can't find a specific fact, set one_fact to null.`;
}

function prospectLine(p) {
  return `Company: ${p.company || '—'}
Contact: ${p.contact_name || '—'}${p.role ? ` (${p.role})` : ''}
Website: ${p.website || '—'}
Email: ${p.email || '—'}
Notes: ${p.one_fact || p.fit_reasoning || '—'}`;
}

// Score one prospect. clientId is needed for the suppression check.
async function scoreProspect(prospect, campaign, { clientId } = {}) {
  // Suppressed → disqualified, no model call.
  if (clientId && prospect.email && await suppression.isSuppressed(clientId, prospect.email)) {
    return { score: 0, verdict: 'disqualified', reasoning: 'on the suppression list', one_fact: null };
  }
  const text = await claude.callClaude({
    max_tokens: 200,
    system: system(campaign),
    user: `Qualify this prospect:\n\n${prospectLine(prospect)}`,
    feature: 'outreach_score',
  });
  const o = parseJson(text) || {};
  const verdict = ['fit', 'maybe', 'disqualified'].includes(o.verdict) ? o.verdict : 'maybe';
  let score = Number.isFinite(o.score) ? Math.max(0, Math.min(100, Math.round(o.score))) : (verdict === 'fit' ? 75 : verdict === 'disqualified' ? 5 : 40);
  if (verdict === 'disqualified') score = Math.min(score, 15);
  return {
    score,
    verdict,
    reasoning: String(o.reasoning || '').trim().slice(0, 300) || null,
    one_fact: o.one_fact ? String(o.one_fact).trim().slice(0, 300) : null,
  };
}

module.exports = { scoreProspect };
