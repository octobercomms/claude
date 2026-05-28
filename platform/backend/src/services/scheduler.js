const cron = require('node-cron');
const pool = require('../db');
const reportService = require('./reportService');
const dataForSEO = require('../connectors/dataforseo');
const emailService = require('./emailService');
const outreachSender = require('./outreachSender');
const outreachReplies = require('./outreachReplies');
const social = require('./social');

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
// SEO rank checks: every 3 days at 06:00. Daily was overkill and burned API
// spend without meaningful detail; every-3-days still surfaces movements in
// the report period while cutting cost by roughly two thirds.
cron.schedule('0 6 */3 * *', async () => {
  console.log('[Scheduler] Running tri-daily SEO rank checks...');
  await runDailyRankChecks();
});

// AI Overview tracking: weekly on Mondays at 06:30. Pay-per-call and AIO
// doesn't churn day-to-day, so weekly is enough to spot trend changes.
cron.schedule('30 6 * * 1', async () => {
  console.log('[Scheduler] Running weekly AI Overview check...');
  await runWeeklyAIOChecks();
});

// Social engagement refresh: 07:00 daily. Pulls a fresh snapshot for
// every published post < 30 days old so the Winners panel and the
// "what's worked" prompt input stay current without per-request lag.
cron.schedule('0 7 * * *', async () => {
  console.log('[Scheduler] Refreshing social engagement…');
  await runSocialEngagementRefresh();
});

// Daily connector health check: 07:30 AM
cron.schedule('30 7 * * *', async () => {
  console.log('[Scheduler] Running connector health check...');
  await runConnectorHealthCheck();
});

// Daily report reminder: 08:00 AM — check if any client's monthly report is due in 48 hours
cron.schedule('0 8 * * *', async () => {
  console.log('[Scheduler] Checking for report reminders...');
  await runReportReminderCheck();
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
          `INSERT INTO seo_rank_history (keyword_id, checked_at, position, url, serp_features)
           VALUES ($1, CURRENT_DATE, $2, $3, $4)
           ON CONFLICT (keyword_id, checked_at) DO UPDATE
             SET position = EXCLUDED.position, url = EXCLUDED.url, serp_features = EXCLUDED.serp_features`,
          [kw.id, result.position, result.url, JSON.stringify(result.serp_features || [])]
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

// Walk every active keyword once per week, query AIO for it, store the
// presence + brand-citation flags. Cheap enough at weekly cadence and
// gives a real trend rather than a snapshot.
async function runWeeklyAIOChecks() {
  try {
    const { rows: keywords } = await pool.query(
      `SELECT k.*, c.domain AS client_domain FROM seo_keywords k
       JOIN clients c ON c.id = k.client_id
       WHERE k.active = true AND c.active = true`
    );
    let ok = 0;
    for (const kw of keywords) {
      try {
        const result = await dataForSEO.checkAIOverview(kw, kw.client_domain);
        await pool.query(
          `INSERT INTO aio_history (keyword_id, checked_at, present, brand_cited, snippet)
           VALUES ($1, CURRENT_DATE, $2, $3, $4)
           ON CONFLICT (keyword_id, checked_at) DO UPDATE
             SET present = EXCLUDED.present, brand_cited = EXCLUDED.brand_cited, snippet = EXCLUDED.snippet`,
          [kw.id, result.present, result.brand_cited, result.snippet]
        );
        ok++;
      } catch (err) {
        console.error(`[AIO] Check failed for "${kw.keyword}":`, err.message);
      }
    }
    console.log(`[AIO] Weekly checks complete (${ok}/${keywords.length})`);
  } catch (err) {
    console.error('[AIO] Fatal error in runWeeklyAIOChecks:', err.message);
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

async function runReportReminderCheck() {
  try {
    const { rows: clients } = await pool.query(
      'SELECT * FROM clients WHERE active = true'
    );

    const now = new Date();
    const twoDaysFromNow = new Date(now);
    twoDaysFromNow.setDate(now.getDate() + 2);
    const targetDay = twoDaysFromNow.getDate();
    const targetMonth = twoDaysFromNow.getMonth();
    const targetYear = twoDaysFromNow.getFullYear();

    for (const client of clients) {
      const schedule = client.report_schedule || {};
      if (!schedule.monthly_day) continue;

      const monthlyDay = schedule.monthly_day;

      // Calculate next report date from today
      let nextReportDate = new Date(now.getFullYear(), now.getMonth(), monthlyDay);
      if (nextReportDate <= now) {
        nextReportDate = new Date(now.getFullYear(), now.getMonth() + 1, monthlyDay);
      }

      // Check if next report date is exactly 2 days from now
      if (
        nextReportDate.getDate() === targetDay &&
        nextReportDate.getMonth() === targetMonth &&
        nextReportDate.getFullYear() === targetYear
      ) {
        try {
          console.log(`[Scheduler] Sending report reminder for ${client.name}`);
          await emailService.sendReportReminderEmail(client);
        } catch (err) {
          console.error(`[Scheduler] Failed to send reminder for ${client.name}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('[Scheduler] Fatal error in runReportReminderCheck:', err.message);
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

// Outreach — send due campaign emails every 3 minutes, in small batches.
cron.schedule('*/3 * * * *', async () => {
  try { await runOutreachSends(); }
  catch (err) { console.error('Outreach send job failed:', err.message); }
});

// Outreach — poll the reply inbox every 15 minutes.
cron.schedule('*/15 * * * *', async () => {
  try { await outreachReplies.pollReplies(); }
  catch (err) { console.error('Outreach reply poll failed:', err.message); }
});

async function runOutreachSends() {
  const { rows: due } = await pool.query(
    `SELECT s.id AS send_id, s.contact_id, s.campaign_id,
            seq.subject, seq.body,
            con.name, con.email, con.company,
            cl.outreach_sending
       FROM outreach_sends s
       JOIN outreach_sequences seq ON seq.id = s.sequence_id
       JOIN outreach_contacts con ON con.id = s.contact_id
       JOIN outreach_campaigns cam ON cam.id = s.campaign_id
       JOIN clients cl ON cl.id = cam.client_id
      WHERE s.status = 'pending'
        AND s.scheduled_at <= NOW()
        AND cam.status = 'active'
      ORDER BY s.scheduled_at
      LIMIT 25`
  );

  for (const row of due) {
    // Stop the sequence if the contact has already replied to this campaign.
    const { rows: replied } = await pool.query(
      'SELECT 1 FROM outreach_sends WHERE campaign_id = $1 AND contact_id = $2 AND replied_at IS NOT NULL LIMIT 1',
      [row.campaign_id, row.contact_id]
    );
    if (replied.length) {
      await pool.query("UPDATE outreach_sends SET status = 'cancelled' WHERE id = $1", [row.send_id]);
      continue;
    }
    // Claim the row so overlapping runs can't double-send it.
    const claim = await pool.query(
      "UPDATE outreach_sends SET status = 'sending' WHERE id = $1 AND status = 'pending'",
      [row.send_id]
    );
    if (claim.rowCount === 0) continue;
    try {
      await outreachSender.sendOutreachEmail({
        send: { id: row.send_id },
        contact: { name: row.name, email: row.email, company: row.company },
        step: { subject: row.subject, body: row.body },
        sending: row.outreach_sending,
      });
      await pool.query("UPDATE outreach_sends SET status = 'sent', sent_at = NOW() WHERE id = $1", [row.send_id]);
    } catch (err) {
      console.error(`Outreach send ${row.send_id} failed:`, err.message);
      await pool.query("UPDATE outreach_sends SET status = 'failed' WHERE id = $1", [row.send_id]);
    }
  }
}

async function runSocialEngagementRefresh() {
  try {
    const { rows: posts } = await pool.query(
      `SELECT * FROM social_posts
       WHERE status = 'published' AND published_at IS NOT NULL
         AND published_at >= NOW() - INTERVAL '30 days'`
    );
    let ok = 0, skipped = 0;
    for (const post of posts) {
      try {
        const r = await social.refreshEngagement(post);
        if (r.ok) ok++; else skipped++;
      } catch (err) {
        console.error(`[Social] engagement refresh failed for post ${post.id}:`, err.message);
      }
    }
    console.log(`[Social] engagement refresh complete (${ok} updated, ${skipped} skipped, ${posts.length} total)`);
  } catch (err) {
    console.error('[Social] runSocialEngagementRefresh fatal:', err.message);
  }
}

module.exports = { runScheduledReports, runDailyRankChecks, runWeeklyAIOChecks, runSocialEngagementRefresh, runReportReminderCheck, runOutreachSends };
