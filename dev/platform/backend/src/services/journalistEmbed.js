// Nightly: embed each journalist's topic profile so the matcher can rank by
// meaning. Only (re)embeds people whose profile changed since last time (new
// auto_topics or enrichment), so cost tracks change, not database size. No-ops
// cleanly when no OpenAI key is configured.

const db = require('../db');
const embeddings = require('./embeddings');

const CHUNK = 96; // profiles per embeddings API call

async function embedBatch({ limit = 500, log = () => {} } = {}) {
  if (!(await embeddings.available())) { log('journalistEmbed: no OpenAI key — skipping'); return { embedded: 0, skipped: 'no-key' }; }

  const { rows } = await db.query(
    `SELECT c.id, c.beats, c.topics, c.auto_topics, c.enrichment_note,
            (SELECT string_agg(s.t, ' | ') FROM (
               SELECT title AS t FROM pr_outlet_articles
                WHERE contact_id = c.id AND title IS NOT NULL AND btrim(title) <> ''
                ORDER BY published_at DESC NULLS LAST LIMIT 8) s) AS recent_titles
       FROM outreach_contacts c
      WHERE c.kind IN ('media','industry') AND c.merged_into IS NULL
        AND ( jsonb_array_length(COALESCE(c.auto_topics, '[]'::jsonb)) > 0
           OR jsonb_array_length(COALESCE(c.beats,       '[]'::jsonb)) > 0
           OR jsonb_array_length(COALESCE(c.topics,      '[]'::jsonb)) > 0 )
        AND ( c.embedding_at IS NULL
           OR (c.auto_topics_at  IS NOT NULL AND c.auto_topics_at  > c.embedding_at)
           OR (c.last_enriched_at IS NOT NULL AND c.last_enriched_at > c.embedding_at) )
      ORDER BY c.embedding_at ASC NULLS FIRST
      LIMIT $1`,
    [limit]
  );
  if (!rows.length) return { embedded: 0 };

  let embedded = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const texts = chunk.map((r) => embeddings.profileText(r));
    let vecs;
    try { vecs = await embeddings.embed(texts); }
    catch (e) { log(`journalistEmbed: chunk failed — ${e.message}`); break; }
    for (let j = 0; j < chunk.length; j++) {
      if (!vecs[j]) continue;
      await db.query('UPDATE outreach_contacts SET topic_embedding = $1, embedding_at = NOW() WHERE id = $2',
        [JSON.stringify(vecs[j]), chunk[j].id]);
      embedded++;
    }
  }
  log(`journalistEmbed.embedBatch: ${embedded}/${rows.length} journalists embedded`);
  return { considered: rows.length, embedded };
}

module.exports = { embedBatch };
