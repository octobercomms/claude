// Lead scoring — rank a batch of found/scraped contacts by how well they fit
// the client's ideal customer profile and the AM's stated service criteria.
//
// This is the "ranked based on my service criteria" step: after the finder or
// scraper returns raw contacts, one Claude pass scores each 0–100 with a short
// reason, so the AM can sort and pick the best leads before adding them to the
// library. Scores are a find-time ranking aid on the preview list — they are
// NOT persisted on the shared contact row (the same contact can be a great fit
// for one client and a poor fit for another).

const claudeService = require('./claude');

const MAX_PER_CALL = 60; // bound the prompt; finders rarely return more in one go

function parseJson(raw) {
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error('Lead scoring returned malformed JSON.'); }
}

const SCORE_SYSTEM =
  'You score B2B outreach leads for fit against a target customer profile and service criteria. ' +
  'Score each lead 0–100: 100 = an ideal-fit decision-maker at an on-target company; ' +
  '50 = plausible but unclear; 0 = clearly off-target or unusable. ' +
  'Reward seniority/role relevance and company fit; penalise generic inboxes and off-target roles. ' +
  'Be decisive and consistent. British English. Respond with JSON only — no prose, no code fences.';

function buildPrompt({ criteria, clientContext, contacts }) {
  const lines = contacts.map((c, i) => {
    const bits = [
      c.name && `name: ${c.name}`,
      (c.role || c.title) && `role: ${c.role || c.title}`,
      c.company && `company: ${c.company}`,
      c.location && `location: ${c.location}`,
      c.website && `site: ${c.website}`,
      c.email && `email: ${c.email}`,
    ].filter(Boolean).join(' · ');
    return `${i}. ${bits || '(sparse)'}`;
  }).join('\n');

  return `Target / service criteria (what makes a good lead for this client):
"""
${criteria}
"""
${clientContext ? `\nClient context: ${clientContext}\n` : ''}
Score each lead below for fit against those criteria. Return ONLY:
{"scores":[{"index":0,"score":0-100,"reason":"one short clause"}]}

Rules:
- Include every index exactly once.
- reason is a brief justification (e.g. "senior buyer at on-target firm" or "generic info@ inbox").
- A named decision-maker beats a generic inbox; an off-target role or industry scores low.

Leads:
${lines}`;
}

// Rank contacts → returns the same array with fit_score (0–100) and fit_reason
// added, sorted high → low. Falls back to the original order if scoring can't
// be applied (e.g. empty criteria).
async function rankContacts({ clientId = null, criteria, clientContext = '', contacts }) {
  if (!Array.isArray(contacts) || !contacts.length) return [];
  if (!criteria || !String(criteria).trim()) {
    const err = new Error('Scoring criteria are required to rank leads.');
    err.status = 400;
    throw err;
  }
  const slice = contacts.slice(0, MAX_PER_CALL);
  const raw = await claudeService.callClaude({
    max_tokens: 4000,
    system: SCORE_SYSTEM,
    user: buildPrompt({ criteria: String(criteria).trim(), clientContext, contacts: slice }),
    feature: 'lead_scoring',
    clientId,
  });
  const scores = parseJson(raw)?.scores;
  const byIndex = new Map();
  if (Array.isArray(scores)) {
    for (const s of scores) {
      const idx = Number(s.index);
      if (Number.isInteger(idx)) {
        const n = Math.max(0, Math.min(100, Math.round(Number(s.score))));
        byIndex.set(idx, { score: Number.isFinite(n) ? n : null, reason: s.reason || null });
      }
    }
  }
  const scored = contacts.map((c, i) => {
    const s = i < MAX_PER_CALL ? byIndex.get(i) : null;
    return { ...c, fit_score: s?.score ?? null, fit_reason: s?.reason ?? null };
  });
  // Highest fit first; unscored (nulls) sink to the bottom but keep their order.
  scored.sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1));
  return scored;
}

module.exports = { rankContacts };
