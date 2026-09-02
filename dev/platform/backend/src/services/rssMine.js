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

// Ask the cheap model to keep only real individual journalists and give each a
// short beat. Returns [{ name, beat }]. Never throws — on any failure we fall
// back to the code-filtered list with no beat (still review-gated).
async function classify(outletName, candidates) {
  const list = candidates.map((c, i) => `${i + 1}. ${c.author_name} — recent: "${(c.sample_title || '').slice(0, 90)}"`).join('\n');
  const user = `These are raw bylines scraped from ${outletName || 'a publication'}'s RSS feed. Keep ONLY the ones that are a single real individual journalist / writer. Drop anything that is a desk, team, agency, wire service, "staff", generic role, brand, or multiple authors.

Bylines:
${list}

Return ONLY a JSON array (in a \`\`\`json code block). For each real journalist you keep:
[{ "name": "their name exactly as written", "beat": "2-4 word beat guessed from their article, or null" }]
No commentary outside the JSON.`;
  try {
    const text = await callClaude({
      feature: 'press_byline_mining',
      max_tokens: 1500,
      system: 'You clean raw newspaper/website bylines into a list of real individual journalists. Be strict: when unsure whether a string is a person or a desk/agency, drop it. British English.',
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
    return candidates.map((c) => ({ name: c.author_name, beat: null }));
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
  const people = await classify(outletName, bylines);

  let queued = 0;
  for (const p of people) {
    const src = byName.get(p.name.toLowerCase());
    const cand = { name: p.name, outlet: outletName, email: null };
    // A guessed (unconfirmed) email from the outlet's known pattern, shown red.
    const guessed = await journalistScout.guessEmail(p.name, outletName);
    for (const clientId of clientIds) {
      // Reuse the scout's dedupe: skip if already a media contact or an open/added
      // suggestion for this client. Keeps the feed miner and the web scout in sync.
      if (await journalistScout.isKnown(clientId, cand)) continue;
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
      queued++;
    }
  }
  log(`rssMine: outlet ${outletId} (${outletName}) — ${people.length} people, ${queued} queued across ${clientIds.length} client(s)`);
  return { candidates: people.length, queued };
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

module.exports = { looksLikePerson, unknownBylines, outletClients, classify, mineOutlet, mineAll, flagInactive };
