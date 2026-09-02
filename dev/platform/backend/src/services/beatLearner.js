// Beat intelligence. The RSS pipeline attributes real articles to journalists in
// pr_outlet_articles; this reads each journalist's recent titles and distils
// what they ACTUALLY write about into `auto_topics` — a lane of its own that
// never touches hand-set `beats`. The press-release matcher reads it.
//
// Cost discipline (the answer to "won't reading thousands of sites cost a
// fortune?"): scraping is free; reading is the cost, so we only (re)read a
// journalist when NEW bylines have landed since we last learned them. Most
// nights that's a few hundred people with a couple of fresh pieces each —
// a few titles to a cheap model (Haiku by default, DeepSeek-eligible: public
// headlines, no client data). Cost tracks new activity, not database size.

const db = require('../db');
let claude; try { claude = require('./claude'); } catch { claude = null; }

const MIN_TITLES = 3;   // need a little evidence before we call it a beat
const RECENT = 20;      // titles per journalist per pass

function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : {}; } catch { return {}; }
}

// Learn one journalist's topics from their recent attributed articles.
async function learnContact(contactId) {
  if (!claude || !claude.callClaude) return { error: 'Claude not configured.' };
  const c = (await db.query(
    `SELECT c.id, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, o.name AS outlet
       FROM outreach_contacts c LEFT JOIN pr_outlets o ON o.id = c.outlet_id WHERE c.id = $1`,
    [contactId]
  )).rows[0];
  if (!c) return { error: 'Contact not found.' };
  const titles = (await db.query(
    `SELECT title FROM pr_outlet_articles
      WHERE contact_id = $1 AND title IS NOT NULL AND btrim(title) <> ''
      ORDER BY published_at DESC NULLS LAST LIMIT $2`,
    [contactId, RECENT]
  )).rows.map((r) => r.title);

  // Even with too little evidence, stamp auto_topics_at so we don't re-check
  // this person every single night — we'll look again when new bylines land.
  if (titles.length < MIN_TITLES) {
    await db.query('UPDATE outreach_contacts SET auto_topics_at = NOW() WHERE id = $1', [contactId]);
    return { skipped: 'too-few-articles', titles: titles.length };
  }

  const system = 'You profile journalists from the headlines they have written. Infer ONLY from the evidence. British English. Return JSON only.';
  const prompt = `Journalist: ${c.name || 'unknown'}${c.outlet ? ` (${c.outlet})` : ''}

Recent article headlines by them:
${titles.map((t) => `- ${t}`).join('\n')}

From ONLY these headlines, return JSON:
{"topics":["6-12 specific subjects/beats they cover, lowercase, e.g. 'sustainable architecture', 'hospitality design'"]}
Be specific (not "news"/"features"). If there's too little signal, return fewer.`;

  try {
    const d = parseJson(await claude.callClaude({ feature: 'press_beat_learn', max_tokens: 400, system, user: prompt }));
    const topics = Array.isArray(d.topics)
      ? [...new Set(d.topics.map((s) => String(s).trim().toLowerCase()).filter(Boolean))].slice(0, 14)
      : [];
    await db.query(
      'UPDATE outreach_contacts SET auto_topics = $1, auto_topics_at = NOW() WHERE id = $2',
      [JSON.stringify(topics), contactId]
    );
    return { learned: true, topics };
  } catch (e) { return { error: e.message }; }
}

// Nightly: learn journalists who have NEW attributed articles since we last
// looked (or were never looked at). Bounded per run.
async function learnAll({ limit = 300, log = () => {} } = {}) {
  if (!claude || !claude.callClaude) return { learned: 0, skipped: 'claude-not-configured' };
  const { rows } = await db.query(
    `SELECT c.id
       FROM outreach_contacts c
      WHERE c.kind IN ('media','industry') AND c.merged_into IS NULL
        AND EXISTS (
          SELECT 1 FROM pr_outlet_articles a
           WHERE a.contact_id = c.id
             AND (c.auto_topics_at IS NULL OR a.created_at > c.auto_topics_at))
      ORDER BY c.auto_topics_at ASC NULLS FIRST
      LIMIT $1`,
    [limit]
  );
  let learned = 0;
  for (const r of rows) {
    try { const out = await learnContact(r.id); if (out.learned) learned += 1; }
    catch (e) { log(`beatLearner: contact ${r.id} failed: ${e.message}`); }
  }
  log(`beatLearner.learnAll: ${rows.length} with new bylines, ${learned} profiled`);
  return { considered: rows.length, learned };
}

module.exports = { learnContact, learnAll };
