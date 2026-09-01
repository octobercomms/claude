// Claude as media-database account exec — keeps the journalist DB true without
// anyone babysitting it. On a schedule it researches each media contact on the
// open web (recent bylines), and works out: are they still writing, where, have
// they moved outlet, or gone quiet? No byline in ~6 months → flag for archiving;
// found at a new outlet → propose the move. Findings are recorded on the contact
// (enrichment_note) and low-risk moves proposed, so every campaign hits a fresh
// list. The web_search runs at Anthropic's end, so it sidesteps our egress limits
// (same proven pattern as the tender + prospecting scouts).

const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db');
const aiModels = require('./aiModels');
const { recordClaudeCost } = require('./costLog');

const FALLBACK_MODEL = 'claude-sonnet-4-6';
const SIX_MONTHS_MS = 183 * 24 * 3600 * 1000;

function parseObject(text) {
  if (!text) return null;
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const cand = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(cand.trim()); } catch { return null; }
}

async function model() {
  try {
    const m = await aiModels.resolveModel('media_db_research');
    if (aiModels.MODELS[m]?.provider === 'anthropic') return m;
  } catch { /* fall through */ }
  return FALLBACK_MODEL;
}

// Research one journalist on the web. Returns findings, or null on failure.
async function researchJournalist({ name, outlet }) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key || !name) return null;
  const client = new Anthropic({ apiKey: key });
  const prompt = `Research the journalist "${name}"${outlet ? ` (currently listed at ${outlet})` : ''} on the open web. Find their MOST RECENT published bylines and where they publish now.

Work out:
- Are they still actively writing (a byline in roughly the last 6 months)?
- What outlet do they mainly write for NOW? Has that changed from "${outlet || 'unknown'}"?
- Roughly when was their most recent byline you can find?
- Any sign they've left journalism, moved role, or are on extended leave?

Return ONLY JSON:
{
  "active": true/false,
  "current_outlet": "the outlet they write for now, or null",
  "moved": true/false,
  "last_byline": "approx YYYY-MM or YYYY, or null",
  "note": "one sentence summary of what you found",
  "confidence": "high|medium|low"
}
Never guess — if you can't verify, set active to null and confidence "low".`;

  let message;
  try {
    message = await client.messages.create({
      model: await model(),
      max_tokens: 800,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
      messages: [{ role: 'user', content: prompt }],
    });
  } catch { return null; }
  try { recordClaudeCost({ model: message.model, response: message, feature: 'media_db_research' }); } catch { /* non-fatal */ }
  const text = (message.content || []).filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n');
  return parseObject(text);
}

// Apply findings to the contact: always stamp the check date + a note; propose an
// archive if they've gone quiet (>6mo / inactive); propose/apply an outlet move.
async function applyFindings(contact, f) {
  const parts = [];
  if (f.note) parts.push(f.note);
  const goneQuiet = f.active === false || (f.last_byline && bylineOlderThan(f.last_byline, SIX_MONTHS_MS));
  const moved = f.moved && f.current_outlet && norm(f.current_outlet) !== norm(contact.company);

  if (moved) parts.push(`Appears to have moved to ${f.current_outlet}` + (f.confidence === 'high' ? ' — outlet updated.' : ' — please confirm.'));
  const note = parts.join(' ').slice(0, 500) || null;

  const sets = ['last_byline_check = NOW()', 'last_enriched_at = NOW()'];
  const params = [contact.id];
  const push = (frag, val) => { params.push(val); sets.push(frag.replace('$N', `$${params.length}`)); };
  if (note) push('enrichment_note = $N', note);
  if (f.confidence) push('enrichment_conf = $N', f.confidence);
  // High-confidence outlet move: apply it. Otherwise it's just noted for review.
  if (moved && f.confidence === 'high') push('company = $N', f.current_outlet);
  // Gone quiet → suggest archiving (a review flag the archive sweep already reads).
  if (goneQuiet) sets.push('archive_suggested = true');

  await pool.query(`UPDATE outreach_contacts SET ${sets.join(', ')} WHERE id = $1`, params);
  return { moved: !!moved, applied_move: moved && f.confidence === 'high', gone_quiet: !!goneQuiet };
}

function norm(s) { return String(s || '').trim().toLowerCase(); }
function bylineOlderThan(byline, ms) {
  // byline like "2025-03" or "2024" — treat the 1st of the month/year.
  const m = String(byline).match(/(\d{4})(?:-(\d{1,2}))?/);
  if (!m) return false;
  const d = new Date(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, 1);
  return Date.now() - d.getTime() > ms;
}

// Scheduled sweep — research the media contacts most overdue for a check. It's
// the paid web-search step, so it stays low-frequency and bounded per run.
async function sweep({ limit = 15, log = () => {} } = {}) {
  const { rows } = await pool.query(
    `SELECT id, name, company FROM outreach_contacts
      WHERE kind IN ('media','industry') AND name IS NOT NULL AND name <> ''
        AND (status IS NULL OR status <> 'do_not_contact')
        AND (last_byline_check IS NULL OR last_byline_check < NOW() - INTERVAL '45 days')
      ORDER BY last_byline_check NULLS FIRST
      LIMIT $1`,
    [limit]
  );
  let checked = 0, moved = 0, quiet = 0;
  for (const c of rows) {
    const f = await researchJournalist({ name: c.name, outlet: c.company });
    if (!f) {
      await pool.query('UPDATE outreach_contacts SET last_byline_check = NOW() WHERE id = $1', [c.id]);
      continue;
    }
    const r = await applyFindings(c, f);
    checked++; if (r.moved) moved++; if (r.gone_quiet) quiet++;
    log(`media check: ${c.name} — ${f.note || 'no note'}`);
  }
  log(`media sweep: ${checked} checked, ${moved} moves, ${quiet} gone quiet`);
  return { checked, moved, quiet, scanned: rows.length };
}

module.exports = { sweep, researchJournalist, applyFindings };
