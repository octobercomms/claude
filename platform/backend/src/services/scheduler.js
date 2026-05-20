const cron = require('node-cron');
const pool = require('../db');
const reportService = require('./reportService');
const dataForSEO = require('../connectors/dataforseo');
const emailService = require('./emailService');

// Weekly reports: every Monday at 10:00 AM
cron.schedule('0 10 * * 1', async () => {
  console.log('[Scheduler] Running weekly reports...');
  await runScheduledReports('weekly');
});

// Monthly reports: 1st of every month at 08:00 AM
cron.schedule('0 8 1 * *', async () => {
  console.log('[Scheduler] Running monthly reports...');
  await runScheduledReports('monthly');
});

// Daily SEO rank checks: 06:00 AM
cron.schedule('0 6 * * *', async () => {
  console.log('[Scheduler] Running daily SEO rank checks...');
  await runDailyRankChecks();
});

// Daily connector health check: 07:30 AM
cron.schedule('30 7 * * *', async () => {
  console.log('[Scheduler] Running connector health check...');
  await runConnectorHealthCheck();
});

async function runScheduledReports(reportType) {
  try {
    const { rows: clients } = await pool.query(
      'SELECT * FROM clients WHERE active = true'
    );

    for (const client of clients) {
      const schedule = client.report_schedule || {};

      // For weekly: check if today matches configured day (default Monday)
      if (reportType === 'weekly') {
        const configuredDay = (schedule.weekly_day || 'monday').toLowerCase();
        const dayMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
        const today = new Date().getDay();
        if (dayMap[configuredDay] !== today) continue;
      }

      // For monthly: check monthly_day (default 1)
      if (reportType === 'monthly') {
        const configuredDay = schedule.monthly_day || 1;
        if (new Date().getDate() !== configuredDay) continue;
      }

      // Skip Goldfinger monthly (weekly only)
      if (reportType === 'monthly' && client.slug === 'goldfinger') continue;

      const { start, end } = getPeriodDates(reportType);

      try {
        const { rows } = await pool.query(
          `INSERT INTO reports (client_id, report_type, period_start, period_end, status)
           VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
          [client.id, reportType, start, end]
        );

        console.log(`[Scheduler] Generating ${reportType} report for ${client.name} (${rows[0].id})`);
        await reportService.generateReport(rows[0].id);
      } catch (err) {
        console.error(`[Scheduler] Report failed for ${client.name}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Fatal error in runScheduledReports:', err.message);
  }
}

async function runDailyRankChecks() {
  try {
    const { rows: keywords } = await pool.query(
      `SELECT k.* FROM seo_keywords k
       JOIN clients c ON c.id = k.client_id
       WHERE k.active = true AND c.active = true`
    );

    for (const kw of keywords) {
      try {
        const result = await dataForSEO.checkRank(kw);
        await pool.query(
          `INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
           VALUES ($1, CURRENT_DATE, $2, $3)
           ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position = EXCLUDED.position, url = EXCLUDED.url`,
          [kw.id, result.position, result.url]
        );
      } catch (err) {
        console.error(`[SEO] Rank check failed for "${kw.keyword}":`, err.message);
      }
    }

    console.log(`[SEO] Rank checks complete for ${keywords.length} keywords`);
  } catch (err) {
    console.error('[SEO] Fatal error in runDailyRankChecks:', err.message);
  }
}

async function runConnectorHealthCheck() {
  try {
    const { rows } = await pool.query(
      `SELECT con.connector_type, con.status, con.error_message, con.store_label,
              cl.name as client_name
       FROM connectors con
       JOIN clients cl ON cl.id = con.client_id
       WHERE cl.active = true
         AND con.status IN ('error', 'expired', 'disconnected')
       ORDER BY cl.name, con.connector_type`
    );

    if (!rows.length) {
      console.log('[Scheduler] Connector health check: all connectors healthy.');
      return;
    }

    const issues = rows.map(r => ({
      clientName: r.client_name,
      connectorType: r.store_label ? `${r.connector_type} (${r.store_label})` : r.connector_type,
      status: r.status,
      errorMessage: r.error_message,
    }));

    console.log(`[Scheduler] Connector health check: ${issues.length} issue(s) found. Sending alert.`);
    await emailService.sendConnectorHealthAlert(issues);
  } catch (err) {
    console.error('[Scheduler] Connector health check failed:', err.message);
  }
}

function getPeriodDates(reportType) {
  const now = new Date();
  if (reportType === 'monthly') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
    };
  }
  // Weekly: previous Mon–Sun
  const day = now.getDay();
  const lastMonday = new Date(now);
  lastMonday.setDate(now.getDate() - ((day + 6) % 7) - 7);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  return {
    start: lastMonday.toISOString().split('T')[0],
    end: lastSunday.toISOString().split('T')[0],
  };
}

module.exports = { runScheduledReports, runDailyRankChecks };
