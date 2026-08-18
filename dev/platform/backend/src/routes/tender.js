// Tender Agent — admin API (Phase 1: ingest). Org-level, so it is agency-staff
// only (the read-only `client` role is blocked). Lists sources and ingested
// notices and runs the ingest on demand. Scoring, briefs and the digest arrive
// in later phases — see docs/platform/tender-agent/STACK.md.

const express = require('express');
const pool = require('../db');
const { authenticate, agencyOnly } = require('../middleware/auth');
const ingest = require('../services/tender/ingest');

const router = express.Router();
router.use(authenticate);
router.use(agencyOnly);

// List sources with their last poll status.
router.get('/sources', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, kind, market, enabled, last_polled_at, last_status
       FROM tender_sources ORDER BY market, name`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List notices. Filters: market, upcoming (closing in the future or unknown),
// needs_check. Newest first. Paginated with limit/offset.
router.get('/notices', async (req, res) => {
  const { market, upcoming, needs_check } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const where = [];
  const params = [];
  if (market) { params.push(market); where.push(`s.market = $${params.length}`); }
  if (needs_check === '1' || needs_check === 'true') where.push('n.needs_manual_check = true');
  if (upcoming === '1' || upcoming === 'true') where.push('(n.closing_at IS NULL OR n.closing_at >= NOW())');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  try {
    const { rows } = await pool.query(
      `SELECT n.id, n.external_ref, n.url, n.title, n.buyer_name, n.buyer_country, n.buyer_city,
              n.cpv_codes, n.published_at, n.closing_at, n.value_min, n.value_max, n.currency,
              n.needs_manual_check, n.first_seen_at, s.name AS source_name, s.market
       FROM tender_notices n LEFT JOIN tender_sources s ON s.id = n.source_id
       ${clause}
       ORDER BY n.first_seen_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Trigger an ingest run now. Optional body { source_id } to poll one source.
// Long-running (network + rate limits), so this awaits and returns the summary;
// the cron does the same on a schedule.
router.post('/ingest/run', async (req, res) => {
  try {
    const sourceId = req.body?.source_id || null;
    const report = await ingest.run({ sourceId, log: (m) => console.log(m) });
    res.json(report);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
