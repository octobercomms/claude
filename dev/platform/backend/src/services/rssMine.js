// RSS mining — Phase 3 of the feed pipeline. The daily ingest (rssIngest.js)
// fills pr_outlet_articles with every article an outlet's feed publishes and
// matches the ones written by journalists we already know. This service turns
// the LEFTOVERS into value two ways:
//
//   1. New journalists — bylines with no matching contact (contact_id IS NULL)
//      are brand-new writers at outlets we already track. We classify the raw
//      author strings with a CHEAP model (Haiku by default, DeepSeek-eligible —
//      it's public byline names + article titles, no client data) to keep real
//      individual journalists and drop desks/agencies/staff bylines, then queue
//      each as a review suggestion for every client that outlet already serves.
//
//   2. Gone-quiet hygiene — a journalist we HAVE matched before, whose most
//      recent feed article is >6 months old, is flagged archive_suggested so the
//      account exec sees them in the archive-review queue. Pure SQL off the same
//      article stream — no model, no web search.
//
// Everything is review-first (nothing auto-added, nothing auto-archived) and
// bounded per run so it stays cheap on a nightly schedule.

const pool = require('../db');
const { callClaude } = require('./claude');
const aiModels = require('./aiModels');
const journalistScout = require('./journalistScout');

// Raw author strings that are never a single real journalist. Matched as
// case-insensitive substrings against the whole byline, so "The Editorial Team"
// and "Staff Writer" are both rejected. Multi-author bylines ("A and B", "A, B")
// are dropped separately — we can't cleanly attribute them.
const NON_PERSON = [
  'team', 'staff', 'editor', 'editorial', 'desk', 'newsroom', 'reporter',
  'correspondent', 'contributor', 'guest', 'admin', 'press association',
  'pa media', 'reuters', 'associated press', 'ap ', 'afp', 'bloomberg',
  'wire', 'bureau', 'agency', 'agencies', 'sponsored', 'advertisement',
  'newswire', 'press release', 'our ', 'unknown', 'anonymous', 'website',
];

// A first cheap pass, in code, before we spend any model tokens. Keeps only
// strings that look like they could be one person's name.
function looksLikePerson(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  if (/\d/.test(s)) return false;                 // dates, "By 123", etc.
  if (!/[a-z]/.test(s)) return false;             // all-caps brand shout
  if (/ and | & |,|;|\/| with /i.test(s)) return false; // multiple authors
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false; // "Editor" / long titles
  const low = s.toLowerCase();
  if (NON_PERSON.some((w) => low.includes(w))) return false;
  return true;
}

// Which clients does this outlet already serve? A new writer at an outlet that
// covers a client is a genuine lead for THAT client. Outlets no client is on are
// skipped — we don't want workspace noise from publications nobody pitches.
async function outletClients(outletId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT m.client_id
       FROM outreach_contacts c
       JOIN outreach_contact_clients m ON m.contact_id = c.id
      WHERE c.outlet_id = $1 AND c.kind IN ('media','industry')`,
    [outletId]
  );
  return rows.map((r) => r.client_id);
}

// A short description of what a client's world is about — used to keep feed
// mining ON-BEAT (so a design client doesn't get an outlet's crime/weather/sport
// reporters just because they share one contact there). Built from the client's
// briefing plus the beats/tags of the journalists already attached to them.
async function clientBeats(clientId) {
  const cl = (await pool.query('SELECT name, briefing_field FROM clients WHERE id = $1', [clientId])).rows[0];
  if (!cl) return '';
  const { rows } = await pool.query(
    `SELECT DISTINCT b FROM (
        SELECT jsonb_array_elements_text(c.beats) AS b
          FROM outreach_contacts c JOIN outreach_contact_clients m ON m.contact_id = c.id
         WHERE m.client_id = $1 AND jsonb_typeof(c.beats) = 'array'
        UNION
        SELECT unnest(c.tags) AS b
          FROM outreach_contacts c JOIN outreach_contact_clients m ON m.contact_id = c.id
         WHERE m.client_id = $1 AND c.tags IS NOT NULL
     ) t WHERE btrim(b) <> '' LIMIT 40`,
    [clientId]
  );
  const beats = rows.map((r) => r.b);
  const parts = [cl.name];
  if (cl.briefing_field) parts.push(String(cl.briefing_field).slice(0, 300));
  if (beats.length) parts.push(`Their journalists cover: ${beats.join(', ')}`);
  return parts.join('. ');
}

// Distinct unknown bylines at this outlet within the last 12 months, each with
// how many articles they filed and a sample (most-recent) title + url. The
// count + recency are the "is this a real regular" signal for the model.
async function unknownBylines(outletId, { months = 12, cap = 40 } = {}) {
  const { rows } = await pool.query(
    `SELECT author_name,
            COUNT(*) AS n,
            (ARRAY_AGG(title ORDER BY published_at DESC NULLS LAST))[1] AS sample_title,
            (ARRAY_AGG(url   ORDER BY published_at DESC NULLS LAST))[1] AS sample_url
       FROM pr_outlet_articles
      WHERE outlet_id = $1 AND contact_id IS NULL
        AND author_name IS NOT NULL AND btrim(author_name) <> ''
        AND (published_at IS NULL OR published_at > NOW() - ($2 || ' months')::interval)
      GROUP BY author_name
      ORDER BY n DESC
      LIMIT $3`,
    [outletId, String(months), cap]
  );
  return rows.filter((r) => looksLikePerson(r.author_name));
}

// Ask the cheap model to keep real individual journalists — and, when a client
// context is given, keep ONLY the ones whose beat is relevant to that client.
// Returns [{ name, beat }]. On failure: with no client context, fall back to the
// code-filtered list; WITH a client context, return [] rather than flood the
// client with unfiltered (possibly off-beat) names.
async function classify(outletName, candidates, { clientContext = '' } = {}) {
  const list = candidates.map((c, i) => `${i + 1}. ${c.author_name} — recent: "${(c.sample_title || '').slice(0, 90)}"`).join('\n');
  const relevance = clientContext
    ? `\n\nThese are being considered for a PR client. The client: ${clientContext}\nKeep ONLY journalists whose beat/subject is RELEVANT to this client's world. DROP anyone whose recent article is off-topic for them (e.g. crime, weather, sport, politics, showbiz for a design/architecture/interiors client). If none are relevant, return an empty array.`
    : '';
  const user = `These are raw bylines scraped from ${outletName || 'a publication'}'s RSS feed. Keep ONLY the ones that are a single real individual journalist / writer. Drop anything that is a desk, team, agency, wire service, "staff", generic role, brand, or multiple authors.${relevance}

Bylines:
${list}

Return ONLY a JSON array (in a \`\`\`json code block). For each journalist you keep:
[{ "name": "their name exactly as written", "beat": "2-4 word beat guessed from their article, or null" }]
No commentary outside the JSON.`;
  try {
    const text = await callClaude({
      feature: 'press_byline_mining',
      max_tokens: 1500,
      system: 'You clean raw newspaper/website bylines into a list of real individual journalists, and judge whether each is on-beat for a given PR client. Be strict on both: drop desks/agencies, and drop journalists whose subject is unrelated to the client. British English.',
      user,
    });
    const arr = journalistScout.extractArray(text);
    const kept = arr
      .map((x) => ({ name: String(x?.name || '').trim(), beat: (String(x?.beat || '').trim() || null) }))
      .filter((x) => x.name);
    // Only trust names the model returned that were actually in our list (guard
    // against hallucinated additions); match case-insensitively.
    const allowed = new Set(candidates.map((c) => c.author_name.toLowerCase()));
    return kept.filter((k) => allowed.has(k.name.toLowerCase()));
  } catch {
    // Don't flood a specific client with unfiltered names on model failure.
    return clientContext ? [] : candidates.map((c) => ({ name: c.author_name, beat: null }));
  }
}

// Mine one outlet: classify its unknown bylines, then queue each genuinely-new
// journalist as a review suggestion for every client that outlet serves.
async function mineOutlet(outletId, { log = () => {} } = {}) {
  const clientIds = await outletClients(outletId);
  if (!clientIds.length) return { candidates: 0, queued: 0 };

  const { rows: orows } = await pool.query('SELECT name FROM pr_outlets WHERE id = $1', [outletId]);
  const outletName = orows[0]?.name || '';

  const bylines = await unknownBylines(outletId);
  if (!bylines.length) return { candidates: 0, queued: 0 };

  const byName = new Map(bylines.map((b) => [b.author_name.toLowerCase(), b]));

  // Classify PER CLIENT with that client's beats, so each client only gets
  // journalists relevant to their world — not every new byline at the outlet.
  let candidates = 0, queued = 0;
  const PER_CLIENT_CAP = 12;
  for (const clientId of clientIds) {
    const ctx = await clientBeats(clientId);
    const people = await classify(outletName, bylines, { clientContext: ctx });
    candidates += people.length;
    let addedForClient = 0;
    for (const p of people) {
      if (addedForClient >= PER_CLIENT_CAP) break;
      const src = byName.get(p.name.toLowerCase());
      const cand = { name: p.name, outlet: outletName, email: null };
      // Reuse the scout's dedupe: skip if already a media contact or an open/added
      // suggestion for this client. Keeps the feed miner and the web scout in sync.
      if (await journalistScout.isKnown(clientId, cand)) continue;
      const guessed = await journalistScout.guessEmail(p.name, outletName);
      await pool.query(
        `INSERT INTO pr_journalist_suggestions
           (client_id, name, outlet, beat, email, guessed_email, why, source_url, status, source)
         VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,'new','rss')`,
        [
          clientId, p.name, outletName, p.beat, guessed,
          src?.sample_title ? `Recent byline in ${outletName}: "${String(src.sample_title).slice(0, 120)}"` : `Publishing in ${outletName}`,
          src?.sample_url || null,
        ]
      );
      queued++; addedForClient++;
    }
  }
  log(`rssMine: outlet ${outletId} (${outletName}) — ${queued} on-beat suggestion(s) across ${clientIds.length} client(s)`);
  return { candidates, queued };
}

// Mine every outlet that has a working feed and unknown bylines. Bounded per run.
async function mineAll({ limit = 120, log = () => {} } = {}) {
  const { rows } = await pool.query(
    `SELECT DISTINCT o.id
       FROM pr_outlets o
       JOIN pr_outlet_articles a ON a.outlet_id = o.id AND a.contact_id IS NULL
      WHERE o.merged_into IS NULL AND o.rss_status = 'found'
        AND a.author_name IS NOT NULL AND btrim(a.author_name) <> ''
      LIMIT $1`,
    [limit]
  );
  let candidates = 0, queued = 0;
  for (const r of rows) {
    try { const o = await mineOutlet(r.id, { log }); candidates += o.candidates; queued += o.queued; }
    catch (e) { log(`mineAll: outlet ${r.id} failed: ${e.message}`); }
  }
  log(`rssMine.mineAll: ${rows.length} outlets, ${candidates} journalists, ${queued} suggestions queued`);
  return { outlets: rows.length, candidates, queued };
}

// Gone-quiet hygiene — flag active journalists whose most recent FEED article is
// older than `months`. Only touches contacts we've actually matched in the feed
// (so absence means quiet, not "no feed"), and only where we have a dated
// article to judge by. Sets archive_suggested so they surface in archive-review.
async function flagInactive({ months = 6, log = () => {} } = {}) {
  const { rowCount } = await pool.query(
    `UPDATE outreach_contacts c
        SET archive_suggested = TRUE, last_byline_check = NOW()
      WHERE c.kind IN ('media','industry')
        AND c.availability_status = 'active'
        AND c.archive_suggested = FALSE
        AND EXISTS (SELECT 1 FROM pr_outlet_articles a
                     WHERE a.contact_id = c.id AND a.published_at IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM pr_outlet_articles a
                         WHERE a.contact_id = c.id
                           AND a.published_at > NOW() - ($1 || ' months')::interval)`,
    [String(months)]
  );
  log(`rssMine.flagInactive: ${rowCount} journalist(s) flagged as gone-quiet (>${months}mo)`);
  return { flagged: rowCount };
}

// Moved-outlet detection — a journalist we ALREADY know, appearing in a feed
// under a DIFFERENT outlet than the one on their record, is a likely job move.
// We queue it for review (never auto-repoint): approving updates their outlet.
// Guards keep out the obvious false positives — a namesake already recorded at
// the destination outlet, and any move we've already applied or dismissed.
async function detectMoves({ months = 6, log = () => {} } = {}) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (c.id, a.outlet_id)
            c.id AS contact_id, c.outlet_id AS from_outlet_id, a.outlet_id AS to_outlet_id,
            a.title, a.url
       FROM pr_outlet_articles a
       JOIN outreach_contacts c
         ON c.kind IN ('media','industry') AND c.merged_into IS NULL
        AND c.outlet_id IS NOT NULL AND c.outlet_id <> a.outlet_id
        AND lower(btrim(c.name)) = lower(btrim(a.author_name))
      WHERE a.contact_id IS NULL
        AND a.author_name IS NOT NULL AND btrim(a.author_name) <> ''
        AND a.published_at > NOW() - ($1 || ' months')::interval
        AND NOT EXISTS (
              SELECT 1 FROM outreach_contacts x
               WHERE x.merged_into IS NULL AND x.outlet_id = a.outlet_id
                 AND lower(btrim(x.name)) = lower(btrim(a.author_name)))
        AND NOT EXISTS (
              SELECT 1 FROM pr_contact_moves mv
               WHERE mv.contact_id = c.id AND mv.to_outlet_id = a.outlet_id
                 AND mv.status IN ('dismissed','applied'))
      ORDER BY c.id, a.outlet_id, a.published_at DESC`,
    [String(months)]
  );
  let queued = 0;
  for (const r of rows) {
    const ins = await pool.query(
      `INSERT INTO pr_contact_moves (contact_id, from_outlet_id, to_outlet_id, article_title, article_url)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (contact_id, to_outlet_id) WHERE status = 'new' DO NOTHING`,
      [r.contact_id, r.from_outlet_id, r.to_outlet_id, r.title, r.url]
    );
    queued += ins.rowCount;
  }
  log(`rssMine.detectMoves: ${queued} possible outlet move(s) queued`);
  return { queued };
}

module.exports = { looksLikePerson, unknownBylines, outletClients, classify, mineOutlet, mineAll, flagInactive, detectMoves };
