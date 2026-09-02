// One-paste autopilot — the account exec that sets the campaign up for you. Given
// a parsed release, it reads the story + the client brief, then picks the RIGHT
// journalists from the media database for THIS specific story (with a reason for
// each), so all that's left is to review and send. It selects from REAL contacts
// only — never invents a journalist — and the deep, per-recipient personalisation
// happens on preview/send (Opus), so "who + why" comes back fast and the drafts
// are genuinely tailored, not a generic blast.

const pool = require('../db');
const claude = require('./claude');

function parseArray(text) {
  if (!text) return [];
  const fence = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*(\[[\s\S]*?\])\s*```/);
  const tryParse = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; } };
  if (fence) { const v = tryParse(fence[1].trim()); if (v) return v; }
  const a = text.indexOf('['); const b = text.lastIndexOf(']');
  if (a !== -1 && b > a) { const v = tryParse(text.slice(a, b + 1)); if (v) return v; }
  return [];
}

// Pull a candidate pool of real, contactable journalists for this client — those
// on the client's list first (warm relationships), then the wider media library.
async function candidatePool(clientId, cap = 250) {
  const { rows } = await pool.query(
    `SELECT oc.id, oc.name, oc.company, oc.contact_type, oc.location, oc.tags,
            (occ.contact_id IS NOT NULL) AS on_client_list
       FROM outreach_contacts oc
       LEFT JOIN outreach_contact_clients occ ON occ.contact_id = oc.id AND occ.client_id = $1 AND occ.unsubscribed_at IS NULL
      WHERE oc.kind IN ('media','industry')
        AND oc.email IS NOT NULL AND oc.email <> ''
        AND (oc.status IS NULL OR oc.status <> 'do_not_contact')
        AND oc.bounced_at IS NULL
      ORDER BY on_client_list DESC, oc.name
      LIMIT $2`,
    [clientId, cap]
  );
  return rows;
}

// Ask Claude to choose the best-fit journalists for THIS story from the pool.
async function proposeAudience({ releaseId, limit = 60 }) {
  const { rows: relRows } = await pool.query(
    `SELECT pr.*, c.name AS client_name, c.briefing_field
       FROM outreach_press_releases pr JOIN clients c ON c.id = pr.client_id
      WHERE pr.id = $1`,
    [releaseId]
  );
  if (!relRows.length) throw new Error('Press release not found');
  const release = relRows[0];
  const pool_ = await candidatePool(release.client_id);
  if (!pool_.length) return { suggestions: [], candidates: 0 };

  const storyText = (release.body_html || release.summary || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
  const list = pool_.map(c => `${c.id} | ${c.name || '—'} | ${c.company || '—'} | ${c.contact_type || '—'}${c.location ? ` | ${c.location}` : ''}${c.on_client_list ? ' | on-list' : ''}`).join('\n');

  const system = 'You are a senior PR account exec choosing which journalists to pitch a specific story to. Pick only genuinely relevant journalists — a tight, well-matched list beats a big one. British English.';
  const user = `Choose the best journalists to pitch this story to, from the candidate list. Match on beat/outlet fit to THIS story — not just anyone. Prefer on-list contacts where they fit. Return up to ${limit}.

CLIENT: ${release.client_name}
CLIENT CONTEXT: ${release.briefing_field || '(none)'}

STORY HEADLINE: ${release.title}
STORY: ${storyText}

CANDIDATES (id | name | outlet | beat | location | on-list?):
${list}

Return ONLY a JSON array, best fit first:
[{ "id": "<candidate id, exactly as given>", "reason": "<= 12 words on why they fit this story" }]
Only include ids from the list. If none fit, return [].`;

  const out = await claude.callClaude({ max_tokens: 3000, system, user, feature: 'press_audience', clientId: release.client_id });
  const picks = parseArray(out);
  const byId = new Map(pool_.map(c => [String(c.id), c]));
  const suggestions = [];
  const seen = new Set();
  for (const p of picks) {
    const id = String(p.id || '').trim();
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    const c = byId.get(id);
    suggestions.push({
      contact_id: c.id, name: c.name, company: c.company,
      beat: c.contact_type || null, on_client_list: c.on_client_list,
      reason: String(p.reason || '').trim().slice(0, 160) || null,
    });
    if (suggestions.length >= limit) break;
  }
  return { suggestions, candidates: pool_.length };
}

// Suggest which AUDIENCE SEGMENTS (tags) fit this story — the scalable way to
// build a press list of hundreds/thousands, versus hand-picking a few dozen
// names. Claude chooses from the tags that actually exist in the media
// database, so selecting them resolves to real contacts.
async function suggestTags({ releaseId }) {
  const { rows: relRows } = await pool.query(
    `SELECT pr.*, c.name AS client_name, c.briefing_field
       FROM outreach_press_releases pr JOIN clients c ON c.id = pr.client_id WHERE pr.id = $1`,
    [releaseId]
  );
  if (!relRows.length) throw new Error('Press release not found');
  const release = relRows[0];

  const { rows: tagRows } = await pool.query(
    `SELECT t AS tag, COUNT(*)::int AS count
       FROM outreach_contacts c CROSS JOIN LATERAL UNNEST(c.tags) t
      WHERE c.kind IN ('media','industry') AND c.email IS NOT NULL AND c.email <> ''
        AND (c.status IS NULL OR c.status <> 'do_not_contact') AND c.bounced_at IS NULL
      GROUP BY t ORDER BY count DESC LIMIT 200`
  );
  if (!tagRows.length) return { suggested_tags: [], tags_available: 0 };

  const storyText = (release.body_html || release.summary || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2200);
  const tagList = tagRows.map(t => `${t.tag} (${t.count})`).join(', ');
  const system = 'You are a senior PR account exec choosing the RIGHT audience segments (tags) to pitch a specific story to. British English. A precise, relevant list wins coverage; a bloated one burns the sender\'s reputation and annoys journalists.';
  const user = `Pick the audience tags whose journalists would genuinely cover THIS specific story, from the tags in the media database below.

Be precise, not broad. Rules:
 - Only pick a tag if a journalist who carries it would plausibly write about THIS story — judged from the story text, not the client's general industry.
 - Do NOT add adjacent or "might-be-interested" beats just to grow the number. For an art event in New York, that means arts / culture / events / local New York press — NOT "fashion" or "hotels" unless the story is actually about those.
 - Prefer a focused list (typically 2-6 tags) that still reaches a real press list. Quality of match beats raw reach.
 - Every tag you return must be justified by something concrete IN THE STORY.

CLIENT: ${release.client_name}
STORY HEADLINE: ${release.title}
STORY:
"""
${storyText}
"""

AVAILABLE TAGS — "name (journalist count)":
${tagList}

Return ONLY a JSON array, strongest fit first:
[{ "tag": "<tag name copied EXACTLY as written above, without the count>", "reason": "<= 14 words: what in THIS story makes this beat a fit>" }]
Only use tags from the list. If none fit, return [].`;
  const text = await claude.callClaude({ max_tokens: 700, system, user, feature: 'press_audience', clientId: release.client_id });
  let arr = [];
  const fence = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*(\[[\s\S]*?\])\s*```/);
  const bodyText = fence ? fence[1] : text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  try { const v = JSON.parse(bodyText.trim()); if (Array.isArray(v)) arr = v; } catch { /* none */ }
  const byTag = new Map(tagRows.map(t => [t.tag, t.count]));
  const seen = new Set();
  const suggestions = [];
  for (const item of arr) {
    // Tolerate both the new {tag,reason} shape and a bare string.
    const tag = String((item && typeof item === 'object') ? item.tag : item || '').trim();
    if (!byTag.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    suggestions.push({
      tag,
      count: byTag.get(tag),
      reason: String((item && item.reason) || '').trim().slice(0, 160) || null,
    });
  }
  return {
    suggestions,
    suggested_tags: suggestions.map(s => s.tag), // back-compat
    tags_available: tagRows.length,
  };
}

module.exports = { proposeAudience, candidatePool, suggestTags };
