// CTR Boost — the *white-hat* answer to "behavioural SEO" / CTR-manipulation
// services (BrowserBlast et al.). Those try to fake the click signals Google's
// NavBoost system measures (goodClicks, badClicks, lastLongestClick) by
// injecting traffic — which decays inside NavBoost's ~13-month window and risks
// being squashed/flagged. The leaked Content Warehouse docs and the DOJ trial
// confirmed those signals are real, so the durable play is to *earn* them:
// win the real click with a better title/snippet, and match intent so searchers
// don't pogo-stick back (which is exactly a badClick).
//
// This service finds pages that already rank well in Search Console but get
// fewer clicks than their position should yield — a title/meta gap, not a
// ranking gap — and uses Claude to rewrite the snippet in the client's voice.
const pool = require('../db');
const claudeService = require('./claude');
const brandVoice = require('./brandVoice');

// Blended (desktop + mobile) organic CTR-by-position curve. Derived from the
// shape of widely published GSC aggregate studies — used only as a baseline to
// flag *under*-performers, not as a promise. Positions beyond the table decay
// gently towards zero.
const CTR_CURVE = {
  1: 0.270, 2: 0.155, 3: 0.100, 4: 0.070, 5: 0.050,
  6: 0.040, 7: 0.032, 8: 0.027, 9: 0.023, 10: 0.020,
};

// Expected CTR for an average position. GSC reports a fractional average
// position, so we round to the nearest whole rank before lookup.
function expectedCtr(position) {
  const p = Math.round(position);
  if (p < 1) return CTR_CURVE[1];
  if (CTR_CURVE[p]) return CTR_CURVE[p];
  if (p <= 20) return Math.max(0.005, 0.020 - (p - 10) * 0.0015); // 11–20 tail
  return 0.004;
}

// Turn raw GSC query+page rows into ranked CTR opportunities. An opportunity is
// a page that is visible (position within `maxPosition`), seen enough
// (`minImpressions`), but clicked materially less than its position predicts.
// Ranked by estimated missed clicks over the window so the AM works the
// biggest wins first.
function scoreOpportunities(rows, { minImpressions = 50, maxPosition = 20, gapThreshold = 0.7, limit = 50 } = {}) {
  const opps = [];
  for (const r of rows || []) {
    const impressions = r.impressions || 0;
    const position = r.position || 0;
    if (impressions < minImpressions) continue;
    if (position < 1 || position > maxPosition) continue;

    const expected = expectedCtr(position);
    const actual = r.ctr || 0;
    // Only flag when actual CTR is meaningfully below expected — ranking-1
    // pages with healthy CTR are not opportunities.
    if (actual >= expected * gapThreshold) continue;

    const missedClicks = Math.max(0, Math.round((expected - actual) * impressions));
    if (missedClicks < 1) continue;

    opps.push({
      query: r.query || null,
      url: r.page || null,
      impressions,
      clicks: r.clicks || 0,
      position: Math.round(position * 10) / 10,
      ctr: actual,
      expected_ctr: Math.round(expected * 1000) / 1000,
      gap_pct: expected > 0 ? Math.round((1 - actual / expected) * 100) : 0,
      missed_clicks: missedClicks,
    });
  }
  opps.sort((a, b) => b.missed_clicks - a.missed_clicks);
  return opps.slice(0, limit);
}

// Ask Claude to rewrite the title tag + meta description for one opportunity,
// in the client's brand voice, framed around the NavBoost click signals.
async function rewrite(clientId, { query, url, current_title, current_description, position, ctr }) {
  const clientRow = await pool.query('SELECT name, briefing_field, domain FROM clients WHERE id = $1', [clientId]);
  const client = clientRow.rows[0] || {};

  const voiceProfile = await brandVoice.loadActiveProfile(clientId);
  const voiceContext = brandVoice.renderForPrompt(voiceProfile);

  const prompt = `Client: ${client.name || '(unknown)'}
About: ${client.briefing_field || '(no briefing)'}
Domain: ${client.domain || '(no domain)'}${voiceContext}

We have a page that ALREADY RANKS for a query but is under-clicked — the title
and meta description aren't earning the click its position deserves. Do NOT
suggest ranking tactics; the job is purely to win more clicks honestly and to
match searcher intent so the visitor doesn't bounce straight back to Google.

Target query: "${query}"
Page URL: ${url || '(unknown)'}
Average position: ${position ?? '(unknown)'}
Current click-through rate: ${ctr != null ? (ctr * 100).toFixed(1) + '%' : '(unknown)'}
Current title tag: ${current_title || '(unknown — infer a plausible one)'}
Current meta description: ${current_description || '(unknown — infer a plausible one)'}

Write snippet copy that earns the click and sets accurate expectations
(promising something the page does not deliver causes pogo-sticking, which hurts).

Return a JSON object with these keys:
- meta_title: the recommended title tag, <= 60 characters, includes the core of the query naturally
- meta_description: the recommended meta description, <= 155 characters, with a concrete reason to click
- alt_title: one alternative title tag, <= 60 characters, a different angle
- rationale: 1-2 sentences on why this should lift CTR and keep intent matched

Return ONLY the JSON object. No prose, no markdown fences.`;

  const reply = await claudeService.callClaude({
    max_tokens: 1024,
    system: 'You are an SEO copywriter specialising in title tags and meta descriptions that earn clicks. British English. Output JSON only.',
    user: prompt,
  });
  const cleaned = reply.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

module.exports = { expectedCtr, scoreOpportunities, rewrite };
