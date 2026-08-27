// Auto go/no-go qualifier. Runs October's go/no-go test on each notice so the
// working list can default to the ones worth a look and move clear rejects to a
// "No-go" view (never deleted). Deterministic-ish, cheap, and grounded in the
// October bid profile so it matches how the "Start with Claude" workspace judges
// fit.
//
// Verdicts:
//   go     — clearly October's niche (arts/culture/design/heritage/destination
//            PR & comms) and biddable (deadline realistic, plausible references).
//   review — borderline; a human should glance (unclear sector, thin detail).
//   nogo   — not the niche (generic marketing/advertising/build/research/
//            non-cultural) or not biddable (deadline gone, wrong scale/geography).

const pool = require('../../db');
const Anthropic = require('@anthropic-ai/sdk');
const claude = require('../claude');
const costLog = require('../costLog');
const profile = require('./profile');

const MODEL = 'claude-sonnet-4-6';

function parseJson(text) {
  if (!text) return null;
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const cand = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(cand.trim()); } catch { return null; }
}

function noticeLine(n) {
  const val = n.value_min ? `${n.currency || ''} ${Number(n.value_min).toLocaleString('en-GB')}`.trim() : 'not stated';
  const closes = n.closing_at ? new Date(n.closing_at).toISOString().slice(0, 10) : 'unknown';
  return `Title: ${n.title || '—'}
Buyer: ${n.buyer_name || '—'}${n.buyer_country ? ` (${n.buyer_country})` : ''}
Value: ${val}
Closes: ${closes}
Detail: ${n.description || '(only the title is available)'}`;
}

function system(profileMd) {
  return `You are the bid qualifier for October Communications, a UK PR & communications consultancy. Decide whether a public-sector tender is worth October's time using its go/no-go test.

October's profile and niche:
${profileMd || '(arts, culture, design, architecture, heritage and destination/tourism PR — international media relations, thought leadership, press strategy, strategic communications.)'}

The go/no-go test:
- GO: the work is genuinely PR / communications / media relations / brand-and-audience for an arts, culture, design, architecture, heritage or destination/tourism buyer, AND it looks biddable (a future deadline that allows a proper bid; a scale October could deliver; October could plausibly show three comparable references).
- NO-GO: it is not that niche — generic marketing/advertising production, digital/web build, market research, event logistics, construction/fit-out, or a non-cultural buyer — OR it is not biddable (deadline already gone, wrong country/scale).
- REVIEW: genuinely borderline, or the detail is too thin to be sure — a human should glance.

Judge only on what's given; do not invent facts. Be strict — the point is to shrink a long list to what truly fits.

Respond with ONLY a JSON object: {"verdict":"go|review|nogo","reason":"<= 14 words, plain"}.`;
}

async function scoreNotice(notice, { profileMd } = {}) {
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 150,
    system: claude.cacheableSystem(system(profileMd)),
    messages: [{ role: 'user', content: `Qualify this tender:\n\n${noticeLine(notice)}` }],
  });
  try { costLog.recordClaudeCost({ model: MODEL, response: resp, feature: 'tender_score' }); } catch { /* best effort */ }
  const obj = parseJson(resp.content.find(b => b.type === 'text')?.text || '');
  const verdict = ['go', 'review', 'nogo'].includes(obj?.verdict) ? obj.verdict : 'review';
  const reason = String(obj?.reason || '').trim().slice(0, 200) || null;
  return { verdict, reason };
}

// Score notices that don't have a verdict yet (new ones, and the backlog on the
// first run after this ships). Bounded per run to keep cost predictable.
async function scoreUnscored({ limit = 40, log = () => {} } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM tender_notices
      WHERE verdict IS NULL AND dismissed = false AND (closing_at IS NULL OR closing_at >= NOW())
      ORDER BY first_seen_at DESC LIMIT $1`,
    [limit]
  );
  if (!rows.length) return { scored: 0 };
  const prof = await profile.get().catch(() => ({ profile_md: '' }));
  let scored = 0;
  for (const notice of rows) {
    try {
      const { verdict, reason } = await scoreNotice(notice, { profileMd: prof.profile_md });
      await pool.query('UPDATE tender_notices SET verdict = $2, verdict_reason = $3, verdict_at = NOW() WHERE id = $1', [notice.id, verdict, reason]);
      scored++;
    } catch (e) { log(`[tender] score failed for ${notice.id}: ${e.message}`); }
  }
  log(`[tender] qualified ${scored}/${rows.length} notices`);
  return { scored };
}

// Score a specific set of notices (bulk "Qualify selected"). Re-scores even if
// already qualified, so it doubles as a "re-run the test on these".
async function scoreIds(ids, { log = () => {} } = {}) {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
  if (!list.length) return { scored: 0 };
  const { rows } = await pool.query('SELECT * FROM tender_notices WHERE id::text = ANY($1::text[])', [list]);
  const prof = await profile.get().catch(() => ({ profile_md: '' }));
  let scored = 0;
  for (const notice of rows) {
    try {
      const { verdict, reason } = await scoreNotice(notice, { profileMd: prof.profile_md });
      await pool.query('UPDATE tender_notices SET verdict = $2, verdict_reason = $3, verdict_at = NOW() WHERE id = $1', [notice.id, verdict, reason]);
      scored++;
    } catch (e) { log(`[tender] score failed for ${notice.id}: ${e.message}`); }
  }
  return { scored };
}

// How many notices are still waiting for a verdict (for the "Qualify all" loop).
async function pendingCount() {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM tender_notices WHERE verdict IS NULL AND dismissed = false AND (closing_at IS NULL OR closing_at >= NOW())'
  );
  return rows[0].n;
}

module.exports = { scoreNotice, scoreUnscored, scoreIds, pendingCount };
