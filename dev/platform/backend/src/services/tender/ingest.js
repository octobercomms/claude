// Tender Agent — ingest job (Phase 1). Polls each enabled source, normalises
// every item into tender_notices, and deduplicates: a new external_ref is
// inserted; an existing one whose content_hash changed is updated (a genuine
// amendment → re-score later); an identical hash is skipped.
//
// Hard rule from the brief: drop anything already closed (closing_at in the
// past). Two of the three portals happily serve expired notices. A notice with
// no parseable deadline is NOT dropped — it's stored with needs_manual_check.
//
// Runs on cron daily (see services/scheduler.js) and on demand via
// POST /api/tender/ingest/run. Returns a structured run summary — a silently
// broken scraper is the likeliest failure, so every source reports its count.

const pool = require('../../db');
const { resolveAdapter } = require('./config');
const { contentHash, isExpired } = require('./normalise');

async function upsertNotice(sourceId, n) {
  if (!n.external_ref) return 'invalid';
  // Drop notices that are already closed.
  if (isExpired(n.closing_at)) return 'expired';

  const hash = contentHash(n);
  const existing = await pool.query(
    'SELECT id, content_hash FROM tender_notices WHERE source_id = $1 AND external_ref = $2',
    [sourceId, n.external_ref]
  );

  const cols = {
    url: n.url || null,
    source_url: n.source_url || null,
    title: n.title || null,
    buyer_name: n.buyer_name || null,
    buyer_country: n.buyer_country || null,
    buyer_city: n.buyer_city || null,
    cpv_codes: Array.isArray(n.cpv_codes) ? n.cpv_codes : [],
    published_at: n.published_at instanceof Date && !isNaN(n.published_at) ? n.published_at : null,
    closing_at: n.closing_at instanceof Date && !isNaN(n.closing_at) ? n.closing_at : null,
    value_min: n.value_min ?? null,
    value_max: n.value_max ?? null,
    currency: n.currency || null,
    description: n.description || null,
    raw_payload: n.raw_payload ? JSON.stringify(n.raw_payload) : null,
    content_hash: hash,
    needs_manual_check: !!n.needs_manual_check,
  };

  if (!existing.rows.length) {
    await pool.query(
      `INSERT INTO tender_notices
        (source_id, external_ref, url, source_url, title, buyer_name, buyer_country, buyer_city,
         cpv_codes, published_at, closing_at, value_min, value_max, currency,
         description, raw_payload, content_hash, needs_manual_check)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [sourceId, n.external_ref, cols.url, cols.source_url, cols.title, cols.buyer_name, cols.buyer_country, cols.buyer_city,
       cols.cpv_codes, cols.published_at, cols.closing_at, cols.value_min, cols.value_max, cols.currency,
       cols.description, cols.raw_payload, cols.content_hash, cols.needs_manual_check]
    );
    return 'inserted';
  }

  if (existing.rows[0].content_hash === hash) return 'skipped';

  // Content changed → clear the verdict so the qualifier re-runs the go/no-go
  // test on the amended notice.
  await pool.query(
    `UPDATE tender_notices SET
       url=$3, source_url=$18, title=$4, buyer_name=$5, buyer_country=$6, buyer_city=$7, cpv_codes=$8,
       published_at=$9, closing_at=$10, value_min=$11, value_max=$12, currency=$13,
       description=$14, raw_payload=$15, content_hash=$16, needs_manual_check=$17, updated_at=NOW(),
       verdict=NULL, verdict_reason=NULL, verdict_at=NULL
     WHERE source_id=$1 AND external_ref=$2`,
    [sourceId, n.external_ref, cols.url, cols.title, cols.buyer_name, cols.buyer_country, cols.buyer_city,
     cols.cpv_codes, cols.published_at, cols.closing_at, cols.value_min, cols.value_max, cols.currency,
     cols.description, cols.raw_payload, cols.content_hash, cols.needs_manual_check, cols.source_url]
  );
  return 'updated';
}

async function ingestSource(source, { log = () => {} } = {}) {
  const summary = { source: source.name, scanned: 0, seen: 0, inserted: 0, updated: 0, skipped: 0, expired: 0, invalid: 0, error: null };
  const adapter = resolveAdapter(source);
  if (!adapter) { summary.error = 'no adapter'; return summary; }
  let notices = [];
  // Adapters may report how many raw notices they scanned before the niche
  // filter via stats.scanned — so a working-but-quiet feed (many scanned, none
  // relevant) reads differently from a broken one (nothing fetched at all).
  const stats = {};
  try {
    notices = await adapter.fetch(source, { log, stats }) || [];
  } catch (e) {
    summary.error = e.message;
  }
  summary.seen = notices.length; // relevant (passed the niche filter)
  summary.scanned = stats.scanned != null ? stats.scanned : notices.length;
  for (const n of notices) {
    try {
      const outcome = await upsertNotice(source.id, n);
      if (summary[outcome] != null) summary[outcome]++;
    } catch (e) {
      summary.invalid++;
      log(`upsert failed (${n.external_ref}): ${e.message}`);
    }
  }
  const status = summary.error
    ? `error: ${summary.error}`
    : `ok: ${summary.scanned} scanned, ${summary.seen} relevant — ${summary.inserted} new, ${summary.updated} updated, ${summary.skipped} same, ${summary.expired} expired`;
  await pool.query('UPDATE tender_sources SET last_polled_at = NOW(), last_status = $2 WHERE id = $1', [source.id, status.slice(0, 300)]);
  return summary;
}

// Run every enabled source (or a single source by id). Returns the run report.
// includeSearch=false skips the paid Claude web-search source (kind 'search') —
// used for the cheap daily API-feed poll; onlySearch=true runs only it (the
// twice-weekly deep pass). The free API feeds carry no per-call cost, so they
// poll daily; web search is the only source that costs money.
async function run({ sourceId = null, includeSearch = true, onlySearch = false, log = console.log } = {}) {
  const { rows: allSources } = sourceId
    ? await pool.query('SELECT * FROM tender_sources WHERE id = $1', [sourceId])
    : await pool.query('SELECT * FROM tender_sources WHERE enabled = true ORDER BY name');
  const sources = allSources.filter(s => {
    const isSearch = s.kind === 'search';
    if (onlySearch) return isSearch;
    if (!includeSearch) return !isSearch;
    return true;
  });

  const results = [];
  for (const source of sources) {
    log(`[tender] polling ${source.name}…`);
    results.push(await ingestSource(source, { log }));
  }
  const totals = results.reduce((t, r) => ({
    seen: t.seen + r.seen, inserted: t.inserted + r.inserted, updated: t.updated + r.updated,
    skipped: t.skipped + r.skipped, expired: t.expired + r.expired,
  }), { seen: 0, inserted: 0, updated: 0, skipped: 0, expired: 0 });
  log(`[tender] done: ${totals.inserted} new / ${totals.updated} updated across ${results.length} sources`);

  // Auto go/no-go qualify anything not yet scored (new notices + the existing
  // backlog). Bounded per run so cost stays predictable; the backlog clears over
  // a run or two and daily new notices are scored as they arrive.
  let qualified = 0;
  try { ({ scored: qualified } = await require('./score').scoreUnscored({ limit: 60, log })); }
  catch (e) { log(`[tender] qualify pass failed: ${e.message}`); }

  return { ran_at: new Date().toISOString(), sources: results, totals, qualified };
}

module.exports = { run, ingestSource, upsertNotice };
