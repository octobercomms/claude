const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const users = require('../services/users');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    // Visibility — admins see all, viewers see only assigned clients
    const visibleIds = await users.getVisibleClientIds(req.user);
    if (visibleIds && !visibleIds.length) {
      return res.json({ clients: [], alerts: { expired_meta_tokens: [] }, upcoming_reports: [], recent_reports: [] });
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

    res.json({
      clients,
      alerts: { expired_meta_tokens: expiredMeta },
      upcoming_reports: upcoming,
      recent_reports: recentReports,
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

module.exports = router;
