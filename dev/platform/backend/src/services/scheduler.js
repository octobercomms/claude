const cron = require('node-cron');
const pool = require('../db');
const { decrypt } = require('../utils/encryption');
const reportService = require('./reportService');
const dataForSEO = require('../connectors/dataforseo');
const emailService = require('./emailService');
const outreachSender = require('./outreachSender');
const outreachReplies = require('./outreachReplies');
const social = require('./social');
const socialPublisher = require('./socialPublisher');
const usageTracking = require('./usageTracking');
const strategistReport = require('./strategistReport');

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

// Backlinks refresh: every Monday at 07:30 UTC, after the AIO check.
// Gated on DataForSEO availability — until 1 July 2026 the Backlinks
// API requires a $100/mo commitment we don't hold, so this job no-ops
// until isUnlocked() flips. Once unlocked, walks every active client
// with a domain and refreshes their backlink profile so the Organic
// → Backlinks tab shows fresh numbers without a manual click.
cron.schedule('30 7 * * 1', async () => {
  const { isUnlocked } = require('./dfsAvailability');
  if (!isUnlocked()) return;
  console.log('[Scheduler] Running weekly backlinks refresh…');
  try {
    const pool = require('../db');
    const dataforseo = require('../connectors/dataforseo');
    const { rows } = await pool.query(
      "SELECT id, domain FROM clients WHERE active = TRUE AND domain IS NOT NULL AND domain != ''"
    );
    for (const c of rows) {
      try { await dataforseo.fetchBacklinkData(c.domain); }
      catch (err) {
        console.warn(`[Backlinks] ${c.domain}: ${err.message}`);
      }
    }
  } catch (err) { console.error('[Backlinks] weekly refresh failed:', err.message); }
});

// Usage snapshots: 02:00 daily. Polls each pay-per-use provider's
// balance/usage endpoint and writes a row to usage_snapshots so the
// Settings "Costs this month" panel has fresh numbers.
cron.schedule('0 2 * * *', async () => {
  console.log('[Scheduler] Polling provider usage…');
  try { await usageTracking.runAllPollers(); }
  catch (err) { console.error('[Usage] poll failed:', err.message); }
});

// Social engagement refresh: 07:00 daily. Pulls a fresh snapshot for
// every published post < 30 days old so the Winners panel and the
// "what's worked" prompt input stay current without per-request lag.
cron.schedule('0 7 * * *', async () => {
  console.log('[Scheduler] Refreshing social engagement…');
  await runSocialEngagementRefresh();
});

// Social autopilot publisher: every 5 minutes. Picks up any plan whose
// scheduled_at has passed and pushes it to its target platforms (Meta
// today, LinkedIn in Phase 4). Idempotent — re-runs just retry failed
// rows, completed ones are skipped.
cron.schedule('*/5 * * * *', async () => {
  try {
    const result = await socialPublisher.publishDuePlans();
    if (result.processed) {
      console.log(`[Autopilot] published ${result.ok}/${result.processed} due plans (failed: ${result.failed})`);
    }
  } catch (err) {
    console.error('[Autopilot] publishDuePlans failed:', err.message);
  }
});

// Social autopilot daily digest: 08:00. Rolls up yesterday's
// publications across every client into one email so the AM can scan
// successes + failures in one place without opening each plan.
cron.schedule('0 8 * * *', async () => {
  try {
    await runAutopilotDigest();
  } catch (err) {
    console.error('[Autopilot] digest failed:', err.message);
  }
});

// OAuth used-state cleanup: hourly. Removes nonce rows older than 1
// hour (well past the 30-min state lifetime) so the replay-protection
// table stays small. Without this, every OAuth start leaves a row
// behind forever.
cron.schedule('30 * * * *', async () => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM oauth_used_states WHERE used_at < NOW() - INTERVAL '1 hour'`
    );
    if (rowCount) console.log(`[OAuth] cleaned ${rowCount} expired state nonces`);
  } catch (err) {
    console.error('[OAuth] state cleanup failed:', err.message);
  }
});

// AI Visibility (AEO): Monday 05:00. Runs every active prompt across
// every supported engine for every client that has prompts configured.
// Builds a moving weekly share-of-voice trend per client without
// touching the AM's morning workflow.
cron.schedule('0 5 * * 1', async () => {
  try {
    const aiVisibility = require('./aiVisibility');
    const summary = await aiVisibility.runAllClients();
    console.log(`[AEO] weekly run across ${summary.length} clients`);
  } catch (err) {
    console.error('[AEO] weekly run failed:', err.message);
  }
});

// Competitor page diff: Sunday 06:30. Sibling to the social
// competitor scrape — walks every configured competitor_pages URL,
// fetches the HTML, extracts semantic blocks, stores a diff vs the
// previous snapshot. Cheap (HTTP fetch + cheerio parse, no third-
// party APIs). Surfaces 'Nike rewrote their hero this week' on the
// AM's Monday morning planner.
cron.schedule('30 6 * * 0', async () => {
  try {
    const competitorPages = require('./competitorPages');
    const summary = await competitorPages.scrapeAllClients();
    const changed = summary.filter(s => s.changed).length;
    console.log(`[CompetitorPages] weekly scrape: ${changed} pages changed across ${summary.length} watched`);
  } catch (err) {
    console.error('[CompetitorPages] weekly scrape failed:', err.message);
  }
});

// Competitor tracker: Sunday 06:00. For every client with at least
// one entry in social_competitors, ask Apify for their top recent
// reels and store them. Same rows are fed into next-batch generation
// alongside the brand's own Winners — so each Monday morning brainstorm
// is grounded in what the competitive set shipped over the last week.
cron.schedule('0 6 * * 0', async () => {
  try {
    const competitorTracker = require('./competitorTracker');
    const summary = await competitorTracker.scrapeAllClients();
    const total = summary.reduce((n, s) => n + s.posts, 0);
    console.log(`[Competitor] weekly scrape: ${total} posts across ${summary.length} clients`);
  } catch (err) {
    console.error('[Competitor] weekly scrape failed:', err.message);
  }
});

// Error digest: 09:00 daily. Rolls up the last 24h of error_log into
// one fingerprint-grouped email so the operator sees what broke
// without grepping logs. Skips silently when there are zero errors.
// Also prunes rows older than 30 days to bound table growth.
cron.schedule('0 9 * * *', async () => {
  try {
    const errorTracker = require('./errorTracker');
    const summary = await errorTracker.recentSummary({ hours: 24 });
    const to = (process.env.ALERT_EMAIL || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    if (to.length && summary.groups.length) {
      await emailService.sendErrorDigest({ to, hours: 24, summary });
    }
    const pruned = await errorTracker.prune({ olderThanDays: 30 });
    if (pruned) console.log(`[errors] pruned ${pruned} rows older than 30 days`);
  } catch (err) {
    console.error('[errors] digest failed:', err.message);
  }
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
    // Proactively re-check LinkedIn tokens — they expire after ~60 days
    // with no refresh, and we only learn from the publisher otherwise
    // (which fails noisily mid-publish). Flip status to 'expired' so the
    // generic alert below picks it up and the AM gets a reconnect prompt
    // before the next scheduled post.
    try {
      const linkedinConnector = require('../connectors/linkedin');
      const { rows: liRows } = await pool.query(
        `SELECT id, client_id, credentials FROM connectors
          WHERE connector_type = 'linkedin_organic' AND status = 'active'
            AND credentials IS NOT NULL AND credentials != '{}'`
      );
      for (const row of liRows) {
        try {
          const creds = decrypt(row.credentials);
          // Treat expires_at in the past as instant fail without an API
          // round-trip — the token's already dead.
          if (creds?.expires_at && Date.now() > creds.expires_at) {
            throw new Error('Token expired (60-day lifetime reached). Reconnect LinkedIn.');
          }
          await linkedinConnector.checkTokenValidity(creds);
        } catch (tokenErr) {
          await pool.query(
            `UPDATE connectors SET status = 'expired', error_message = $1 WHERE id = $2`,
            [tokenErr.message, row.id]
          );
        }
      }
    } catch (err) {
      console.error('[Scheduler] LinkedIn token check failed:', err.message);
    }

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

// Strategist — auto-generate a 7-day ads briefing for every active
// client every Monday at 07:00 so the AM walks into a punchlist.
// Each client runs serially to avoid bursting the Claude API rate limit.
cron.schedule('0 7 * * 1', async () => {
  try {
    const { rows: clients } = await pool.query(
      `SELECT id, name, strategist_recipients FROM clients
        WHERE active = true
          AND EXISTS (
            SELECT 1 FROM connectors c
             WHERE c.client_id = clients.id
               AND c.status = 'active'
               AND c.connector_type IN ('meta_ads', 'google_ads')
          )`
    );
    const emailService = require('./emailService');
    const platformUrl = process.env.PLATFORM_URL || '';
    const envRecipients = (process.env.STRATEGIST_RECIPIENTS || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    for (const cl of clients) {
      try {
        const reportId = await strategistReport.generate({ clientId: cl.id, periodDays: 7, trigger: 'weekly' });
        // Pull the parsed recommendations + the row's markdown so we can
        // email them as a punchlist at the top. Both can be empty in
        // edge cases — the email still goes out as the briefing alone.
        const { rows: rows1 } = await pool.query(
          `SELECT period_start, period_end, markdown FROM strategist_reports WHERE id = $1`,
          [reportId]
        );
        const r = rows1[0] || {};
        const { rows: actionRows } = await pool.query(
          `SELECT text FROM strategist_recommendations WHERE report_id = $1 ORDER BY position ASC`,
          [reportId]
        );
        const recipients = (cl.strategist_recipients || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        const to = recipients.length ? recipients : envRecipients;
        if (!to.length) {
          console.warn(`[strategist] no recipients for ${cl.name} — set strategist_recipients on the client or STRATEGIST_RECIPIENTS env var`);
          continue;
        }
        const period = r.period_start && r.period_end ? `${r.period_start} – ${r.period_end}` : '';
        const reportUrl = platformUrl ? `${platformUrl}/clients/${cl.id}/ads?tab=strategist&report=${reportId}` : null;
        await emailService.sendStrategistBriefing({
          to, clientName: cl.name, period,
          markdown: r.markdown || '_Briefing was generated but had no content._',
          recommendations: actionRows.map(a => a.text),
          reportUrl,
        });
      } catch (err) {
        console.error(`[strategist] weekly generation/email failed for ${cl.name}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[strategist] weekly job failed:', err.message);
  }
});

async function runOutreachSends() {
  const { rows: due } = await pool.query(
    `SELECT s.id AS send_id, s.contact_id, s.campaign_id,
            seq.subject, seq.body,
            con.id AS con_id, con.name, con.email, con.company,
            con.bounced_at, con.status AS contact_status,
            cam.client_id,
            cl.outreach_sending,
            m.unsubscribed_at
       FROM outreach_sends s
       JOIN outreach_sequences seq ON seq.id = s.sequence_id
       JOIN outreach_contacts con ON con.id = s.contact_id
       JOIN outreach_campaigns cam ON cam.id = s.campaign_id
       JOIN clients cl ON cl.id = cam.client_id
       LEFT JOIN outreach_contact_clients m
         ON m.contact_id = s.contact_id AND m.client_id = cam.client_id
      WHERE s.status = 'pending'
        AND s.scheduled_at <= NOW()
        AND cam.status = 'active'
      ORDER BY s.scheduled_at
      LIMIT 25`
  );

  for (const row of due) {
    // Stop the sequence if the contact has been globally hard-bounced
    // since the queue was built — the email address is dead, every
    // future send to it would just deepen the bounce.
    if (row.bounced_at || row.contact_status === 'bounced') {
      await pool.query("UPDATE outreach_sends SET status = 'cancelled' WHERE id = $1", [row.send_id]);
      continue;
    }
    // Stop the sequence if the contact has already replied to this campaign,
    // or has unsubscribed from this specific client since the queue was built.
    if (row.unsubscribed_at) {
      await pool.query("UPDATE outreach_sends SET status = 'cancelled' WHERE id = $1", [row.send_id]);
      continue;
    }
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
      const result = await outreachSender.sendOutreachEmail({
        send: { id: row.send_id, campaign_id: row.campaign_id },
        contact: { id: row.con_id, name: row.name, email: row.email, company: row.company },
        step: { subject: row.subject, body: row.body },
        sending: row.outreach_sending,
        clientId: row.client_id,
      });
      // Stash the SES message id so the SNS bounce webhook can map an
      // async bounce notification back to the originating send + contact.
      await pool.query(
        "UPDATE outreach_sends SET status = 'sent', sent_at = NOW(), provider_message_id = $2 WHERE id = $1",
        [row.send_id, result?.providerMessageId || null]
      );
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

// Roll up yesterday's autopilot publications across every active client
// into a single email. Yesterday = the 24h window ending at the cron
// time so daily 08:00 captures everything posted the previous calendar
// day in the platform's timezone.
async function runAutopilotDigest() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { rows } = await pool.query(
    `SELECT cl.id AS client_id, cl.name AS client_name,
            pub.platform, pub.status, pub.posted_url, pub.error_message,
            p.title AS plan_title
       FROM social_post_publications pub
       JOIN social_post_plans p ON p.id = pub.plan_id
       JOIN clients cl ON cl.id = pub.client_id
      WHERE cl.active = true
        AND pub.updated_at >= $1
        AND pub.status IN ('posted', 'failed')
      ORDER BY cl.name, pub.updated_at`,
    [since]
  );
  if (!rows.length) {
    console.log('[Autopilot] digest: nothing to report.');
    return;
  }
  const byClient = new Map();
  for (const r of rows) {
    if (!byClient.has(r.client_id)) {
      byClient.set(r.client_id, { clientName: r.client_name, posted: [], failed: [] });
    }
    const entry = byClient.get(r.client_id);
    const row = { platform: r.platform, title: r.plan_title, posted_url: r.posted_url, error_message: r.error_message };
    if (r.status === 'posted') entry.posted.push(row);
    else entry.failed.push(row);
  }
  const perClient = [...byClient.values()];
  const dateLabel = since.toLocaleDateString('en-GB', { dateStyle: 'medium' });
  const to = (process.env.ALERT_EMAIL || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  if (!to.length) {
    console.warn('[Autopilot] digest: ALERT_EMAIL not set — skipping send.');
    return;
  }
  await emailService.sendAutopilotDigest({ to, dateLabel, perClient });
  console.log(`[Autopilot] digest sent for ${perClient.length} clients.`);
}

module.exports = { runScheduledReports, runDailyRankChecks, runWeeklyAIOChecks, runSocialEngagementRefresh, runReportReminderCheck, runOutreachSends, runAutopilotDigest };
