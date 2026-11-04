const pool = require('../../db');
const { summariseAttention, STALE_DAYS } = require('./attention');

async function captureBaseline({ log = () => {} } = {}) {
  const { rows: attRows } = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (b.client_id) b.id, b.client_id
        FROM strategist_briefings b
       WHERE b.status = 'completed'
       ORDER BY b.client_id, b.generated_at DESC
    )
    SELECT l.client_id,
           c.name AS client_name,
           c.slug,
           COUNT(*)               AS crucial_open,
           MIN(r.first_raised_at) AS oldest_raised_at
      FROM latest l
      JOIN clients c ON c.id = l.client_id
      JOIN strategist_briefing_recommendations r
        ON r.briefing_id = l.id AND r.done = false AND r.priority = 'crucial'
     GROUP BY l.client_id, c.name, c.slug`);

  const now = new Date();
  const { clients } = summariseAttention(attRows, { now });

  let inserted = 0;
  for (const c of clients) {
    const detail = {
      client_name: c.client_name,
      stale_threshold_days: STALE_DAYS,
    };
    await pool.query(
      `INSERT INTO gtm_baselines (client_id, snapshot_date, crucial_open, stale_count, oldest_item_days, detail)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)
       ON CONFLICT (client_id, snapshot_date) DO UPDATE
          SET crucial_open = EXCLUDED.crucial_open,
              stale_count  = EXCLUDED.stale_count,
              oldest_item_days = EXCLUDED.oldest_item_days,
              detail       = EXCLUDED.detail`,
      [c.client_id, c.crucial_open, c.stale ? 1 : 0, c.oldest_days, JSON.stringify(detail)]
    );
    inserted++;
  }

  // Clients with zero crucial items also deserve a row so a clean slate reads
  // as zero rather than as no data.
  const { rows: activeClients } = await pool.query(
    `SELECT id FROM clients WHERE active = true AND strategist_active = true`
  );
  for (const ac of activeClients) {
    if (clients.some(c => c.client_id === ac.id)) continue;
    await pool.query(
      `INSERT INTO gtm_baselines (client_id, snapshot_date, crucial_open, stale_count, oldest_item_days)
       VALUES ($1, CURRENT_DATE, 0, 0, NULL)
       ON CONFLICT (client_id, snapshot_date) DO NOTHING`,
      [ac.id]
    );
    inserted++;
  }

  log(`[gtm-baseline] Captured ${inserted} client snapshot(s) for ${now.toISOString().slice(0, 10)}`);
  return { clients: inserted, date: now.toISOString().slice(0, 10) };
}

async function getBaselines({ clientId, limit = 52 } = {}) {
  if (clientId) {
    const { rows } = await pool.query(
      `SELECT snapshot_date, crucial_open, stale_count, oldest_item_days
         FROM gtm_baselines
        WHERE client_id = $1
        ORDER BY snapshot_date DESC
        LIMIT $2`,
      [clientId, limit]
    );
    return rows;
  }
  // Aggregate across all clients per date: total stale, total crucial open
  const { rows } = await pool.query(
    `SELECT snapshot_date,
            SUM(crucial_open)::int  AS crucial_open,
            SUM(stale_count)::int   AS stale_count,
            COUNT(*)::int           AS client_count
       FROM gtm_baselines
      GROUP BY snapshot_date
      ORDER BY snapshot_date DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

async function latestSnapshot() {
  const { rows } = await pool.query(
    `SELECT snapshot_date,
            SUM(crucial_open)::int  AS crucial_open,
            SUM(stale_count)::int   AS stale_count,
            COUNT(*)::int           AS client_count
       FROM gtm_baselines
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM gtm_baselines)
      GROUP BY snapshot_date`
  );
  return rows[0] || null;
}

module.exports = { captureBaseline, getBaselines, latestSnapshot };
