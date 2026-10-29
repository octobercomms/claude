const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const users = require('../services/users');
const { summariseAttention } = require('../services/strategist/attention');
const usageTracking = require('../services/usageTracking');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    // Visibility — admins see all, viewers see only assigned clients
    const visibleIds = await users.getVisibleClientIds(req.user);
    if (visibleIds && !visibleIds.length) {
      return res.json({
        clients: [], alerts: { expired_meta_tokens: [] },
        attention: { clients: [], stale: 0, total: 0, stale_days: 14 },
        upcoming_reports: [], recent_reports: [],
        report_health: { sent: 0, skipped_no_recipients: 0, failed: 0, total: 0 },
      });
    }
    const filterSql = visibleIds === null ? '' : ' AND c.id = ANY($1)';
    const filterSqlReports = visibleIds === null ? '' : ' AND cl.id = ANY($1)';
    const filterParams = visibleIds === null ? [] : [visibleIds];

    // Client summary with connector status and last report
    const { rows: clients } = await pool.query(`
      SELECT
        c.id, c.name, c.slug, c.active, c.report_schedule,
        (
          SELECT json_build_object(
            'id', r.id, 'report_type', r.report_type,
            'status', r.status, 'sent_at', r.sent_at, 'created_at', r.created_at
          )
          FROM reports r WHERE r.client_id = c.id
          ORDER BY r.created_at DESC LIMIT 1
        ) as last_report,
        (
          SELECT json_agg(json_build_object(
            'type', conn.connector_type, 'status', conn.status,
            'store_label', conn.store_label, 'last_checked', conn.last_checked
          ))
          FROM connectors conn WHERE conn.client_id = c.id
        ) as connectors
      FROM clients c
      WHERE c.active = true${filterSql}
      ORDER BY c.name
    `, filterParams);

    // Expired Meta tokens
    const { rows: expiredMeta } = await pool.query(`
      SELECT conn.id, conn.client_id, cl.name as client_name, conn.connector_type, conn.error_message
      FROM connectors conn
      JOIN clients cl ON cl.id = conn.client_id
      WHERE conn.connector_type IN ('meta_ads', 'instagram_insights')
        AND conn.status IN ('expired', 'error')
        AND cl.active = true${filterSqlReports}
    `, filterParams);

    // Upcoming reports (next 7 days)
    const upcoming = clients.map(client => {
      const schedule = client.report_schedule;
      const next = getNextReportDate(schedule);
      return { client_id: client.id, client_name: client.name, next_report: next };
    }).filter(u => u.next_report);

    // Recent report activity
    const { rows: recentReports } = await pool.query(`
      SELECT r.id, r.client_id, cl.name as client_name, r.report_type, r.status,
             r.created_at, r.sent_at, r.period_start, r.period_end
      FROM reports r
      JOIN clients cl ON cl.id = r.client_id
      WHERE 1=1${filterSqlReports}
      ORDER BY r.created_at DESC
      LIMIT 10
    `, filterParams);

    // Report health, last 7 days. Counted rather than inferred from
    // recent_reports, which is a LIMIT 10 feed and silently truncates once
    // there are more than ten clients on a weekly schedule.
    //
    // 'skipped_no_recipients' is the one worth surfacing: the report was
    // generated in full (connector pulls, a Claude narrative, a PDF) and then
    // binned because the client has no report_recipients. It costs the same
    // as a delivered report and produces nothing.
    let reportHealth = { sent: 0, skipped_no_recipients: 0, failed: 0, total: 0 };
    try {
      const { rows: healthRows } = await pool.query(`
        SELECT r.status, COUNT(*)::int AS n
        FROM reports r
        JOIN clients cl ON cl.id = r.client_id
        WHERE r.created_at >= NOW() - INTERVAL '7 days'${filterSqlReports}
        GROUP BY r.status
      `, filterParams);
      for (const row of healthRows) {
        reportHealth[row.status] = (reportHealth[row.status] || 0) + row.n;
        reportHealth.total += row.n;
      }
    } catch (e) { console.error('[dashboard] report health failed:', e.message); }

    // Strategy progress per client, so the client list can show it on the card
    // instead of carrying a separate cross-client table.
    let strategyByClient = {};
    try {
      const strategyRows = await require('../services/strategyTemplates').overview(visibleIds);
      strategyByClient = Object.fromEntries(strategyRows.map(s => [s.client_id, s]));
    } catch (e) { console.error('[dashboard] strategy overview failed:', e.message); }
    for (const client of clients) {
      const s = strategyByClient[client.id];
      client.strategy = s ? { template_name: s.template_name, done: s.done, total: s.total, pct: s.pct } : null;
    }

    // Which clients are slipping: open CRUCIAL items on each client's most
    // recent briefing, ranked oldest first. The per-client queue answers "what
    // is open for Falcon"; this answers "which of my clients has something on
    // fire", which is the question an agency owner actually has on a Monday
    // and which no per-client screen can answer.
    //
    // Best-effort: a dashboard that fails to load because the strategist has
    // never run is worse than one without this number.
    let attention = { clients: [], stale: 0, total: 0, stale_days: 14 };
    try {
      const { rows: attRows } = await pool.query(`
        WITH latest AS (
          SELECT DISTINCT ON (b.client_id) b.id, b.client_id
            FROM strategist_briefings b
            JOIN clients c ON c.id = b.client_id
           WHERE b.status = 'completed'${filterSql}
           ORDER BY b.client_id, b.generated_at DESC
        )
        SELECT l.client_id,
               c.name AS client_name,
               c.slug,
               COUNT(*)                   AS crucial_open,
               MIN(r.first_raised_at)     AS oldest_raised_at
          FROM latest l
          JOIN clients c ON c.id = l.client_id
          JOIN strategist_briefing_recommendations r
            ON r.briefing_id = l.id AND r.done = false AND r.priority = 'crucial'
         GROUP BY l.client_id, c.name, c.slug`, filterParams);
      attention = summariseAttention(attRows);
    } catch (e) { console.error('[dashboard] attention roll-up failed:', e.message); }

    // Combined API spend this month — admin only (it's workspace-wide
    // cost data). visibleIds === null means the user sees everything.
    let apiSpend = null;
    if (visibleIds === null) {
      try { apiSpend = await usageTracking.monthlySpend(); }
      catch (e) { console.error('[dashboard] api spend failed:', e.message); }
    }

    res.json({
      clients,
      alerts: { expired_meta_tokens: expiredMeta },
      attention,
      upcoming_reports: upcoming,
      recent_reports: recentReports,
      report_health: reportHealth,
      api_spend: apiSpend,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getNextReportDate(schedule) {
  const now = new Date();
  const results = [];

  // Weekly
  if (schedule.weekly_day && schedule.weekly_time) {
    const dayMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const targetDay = dayMap[schedule.weekly_day.toLowerCase()] ?? 1;
    const [h, m] = (schedule.weekly_time || '10:00').split(':').map(Number);
    const next = new Date(now);
    const daysUntil = (targetDay - now.getDay() + 7) % 7 || 7;
    next.setDate(now.getDate() + daysUntil);
    next.setHours(h, m, 0, 0);
    results.push({ type: 'weekly', date: next });
  }

  // Monthly
  if (schedule.monthly_day) {
    const next = new Date(now.getFullYear(), now.getMonth(), schedule.monthly_day);
    if (next <= now) next.setMonth(next.getMonth() + 1);
    results.push({ type: 'monthly', date: next });
  }

  results.sort((a, b) => a.date - b.date);
  return results[0] || null;
}

// Personalised read-only client landing — the caller's own single client.
// Reads only our DB (no paid API calls). Each tile is best-effort so a
// missing table/column can never 500 the whole page.
router.get('/client-home', async (req, res) => {
  try {
    const visibleIds = await users.getVisibleClientIds(req.user);
    const clientId = Array.isArray(visibleIds) && visibleIds.length ? visibleIds[0] : null;
    if (!clientId) return res.status(400).json({ error: 'No client assigned to this account.' });

    const { rows: cRows } = await pool.query('SELECT id, name, domain FROM clients WHERE id = $1', [clientId]);
    if (!cRows.length) return res.status(404).json({ error: 'Client not found' });
    const client = cRows[0];

    const tile = async (fn) => { try { return await fn(); } catch { return null; } };
    const num = async (sql) => { const { rows } = await pool.query(sql, [clientId]); return rows[0]?.n ?? null; };

    const [latestReport, published30d, upcoming, keywords, backlinks, recentPosts] = await Promise.all([
      tile(async () => {
        const { rows } = await pool.query(
          `SELECT id, report_type, period_start, period_end, status, sent_at, created_at
             FROM reports WHERE client_id = $1 AND status IN ('sent','generated')
            ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 1`, [clientId]);
        return rows[0] || null;
      }),
      tile(() => num(`SELECT COUNT(*)::int AS n FROM social_posts WHERE client_id = $1 AND status = 'published' AND published_at >= NOW() - INTERVAL '30 days'`)),
      tile(() => num(`SELECT COUNT(*)::int AS n FROM social_post_publications WHERE client_id = $1 AND status = 'pending' AND scheduled_at > NOW()`)),
      tile(() => num(`SELECT COUNT(*)::int AS n FROM seo_keywords WHERE client_id = $1 AND active = true`)),
      tile(async () => {
        const { rows } = await pool.query(
          `SELECT referring_domains_total, backlinks_total, captured_at FROM dfs_backlinks_summary
            WHERE client_id = $1 ORDER BY captured_at DESC LIMIT 1`, [clientId]);
        return rows[0] || null;
      }),
      tile(async () => {
        const { rows } = await pool.query(
          `SELECT id, hook, caption, platform, published_url, published_at FROM social_posts
            WHERE client_id = $1 AND status = 'published' ORDER BY published_at DESC LIMIT 6`, [clientId]);
        return rows;
      }),
    ]);

    res.json({
      client,
      latest_report: latestReport,
      recent_posts: recentPosts || [],
      tiles: {
        posts_published_30d: published30d,
        upcoming_scheduled: upcoming,
        keywords_tracked: keywords,
        referring_domains: backlinks?.referring_domains_total ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
