// Weekly media-desk digest. Everything the standing account exec did unattended
// this week — new journalists to review, gone-quiet, duplicates, outlet moves,
// deliverability — rolled into one skimmable email so the AM is TOLD what's
// waiting instead of having to remember to check the hub. Read-only: it counts
// what the other jobs already queued and links to the review screen.

const pool = require('./db');
const contactDedup = require('./contactDedup');
const emailService = require('./emailService');

async function buildDigest() {
  const [sugg, quiet, moves, attn] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE source = 'rss')  AS rss,
              COUNT(*) FILTER (WHERE source IS DISTINCT FROM 'rss') AS scout
         FROM pr_journalist_suggestions WHERE status = 'new'`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n,
              ARRAY(SELECT TRIM(CONCAT(first_name,' ',last_name))
                      FROM outreach_contacts
                     WHERE kind IN ('media','industry') AND merged_into IS NULL
                       AND archive_suggested = TRUE AND availability_status = 'active'
                     LIMIT 6) AS sample
         FROM outreach_contacts
        WHERE kind IN ('media','industry') AND merged_into IS NULL
          AND archive_suggested = TRUE AND availability_status = 'active'`
    ),
    pool.query(
      `SELECT mv.id, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name,
              fo.name AS from_outlet, too.name AS to_outlet
         FROM pr_contact_moves mv
         JOIN outreach_contacts c ON c.id = mv.contact_id AND c.merged_into IS NULL
         LEFT JOIN pr_outlets fo ON fo.id = mv.from_outlet_id
         LEFT JOIN pr_outlets too ON too.id = mv.to_outlet_id
        WHERE mv.status = 'new' ORDER BY mv.created_at DESC`
    ),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE bounced_at IS NOT NULL) AS bounced,
              COUNT(*) FILTER (WHERE bounced_at IS NULL AND verification_status = 'guessed') AS guessed
         FROM outreach_contacts
        WHERE kind IN ('media','industry') AND merged_into IS NULL
          AND (bounced_at IS NOT NULL OR verification_status = 'guessed')`
    ),
  ]);

  // Duplicate clusters — reuse the scan, drop dismissed ones.
  let dupeClusters = 0;
  try {
    const clusters = await contactDedup.scanContactDuplicates(null, { kinds: ['media', 'industry'] });
    const { rows: dis } = await pool.query('SELECT cluster_key FROM pr_contact_dedup_dismissed');
    const dismissed = new Set(dis.map((r) => r.cluster_key));
    dupeClusters = clusters.filter((c) => !dismissed.has(contactDedup.clusterKey(c))).length;
  } catch { /* dedup scan is best-effort */ }

  const newRss = Number(sugg.rows[0]?.rss) || 0;
  const newScout = Number(sugg.rows[0]?.scout) || 0;
  const moveRows = moves.rows || [];
  const counts = {
    newSuggestions: newRss + newScout,
    newRss, newScout,
    goneQuiet: Number(quiet.rows[0]?.n) || 0,
    dupeClusters,
    moves: moveRows.length,
    bounced: Number(attn.rows[0]?.bounced) || 0,
    guessed: Number(attn.rows[0]?.guessed) || 0,
  };
  counts.total = counts.newSuggestions + counts.goneQuiet + counts.dupeClusters + counts.moves + counts.bounced + counts.guessed;

  return {
    counts,
    quietSample: (quiet.rows[0]?.sample || []).filter(Boolean),
    moveSample: moveRows.slice(0, 6).map((m) => ({ name: m.name, from: m.from_outlet, to: m.to_outlet })),
  };
}

// Cron entry. Sends only when there's something to act on. Recipient reuses the
// same ALERT_EMAIL the other digests use — no new setting to configure.
async function runWeekly({ log = () => {} } = {}) {
  const digest = await buildDigest();
  if (!digest.counts.total) { log('mediaDeskDigest: nothing to report — skipping.'); return { sent: false, counts: digest.counts }; }

  const to = (process.env.ALERT_EMAIL || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  if (!to.length) { log('mediaDeskDigest: ALERT_EMAIL not set — skipping send.'); return { sent: false, counts: digest.counts }; }

  await emailService.sendMediaDeskDigest({ to, ...digest });
  log(`mediaDeskDigest: sent (${digest.counts.total} items) to ${to.join(', ')}`);
  return { sent: true, counts: digest.counts };
}

module.exports = { buildDigest, runWeekly };
