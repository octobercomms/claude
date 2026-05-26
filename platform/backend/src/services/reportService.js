const pool = require('../db');
const claudeService = require('./claude');
const pdfService = require('./pdfService');
const emailService = require('./emailService');
const dataCollector = require('./dataCollector');

async function generateReport(reportId) {
  const { rows } = await pool.query(
    'SELECT r.*, c.name as client_name, c.monthly_focus, c.report_recipients, c.report_sections FROM reports r JOIN clients c ON c.id = r.client_id WHERE r.id = $1',
    [reportId]
  );
  if (!rows.length) throw new Error(`Report ${reportId} not found`);
  const report = rows[0];

  await setStatus(reportId, 'generating');

  try {
    const periodStart = report.period_start.toISOString().split('T')[0];
    const periodEnd = report.period_end.toISOString().split('T')[0];
    const period = formatPeriod(report.report_type, periodStart, periodEnd);

    const [collectedData, seoData, chatHistory] = await Promise.all([
      dataCollector.collectClientData(report.client_id, periodStart, periodEnd),
      dataCollector.collectSEOData(report.client_id).catch(err => {
        console.error('[Report] SEO data collection failed:', err.message);
        return { rankings: [] };
      }),
      pool.query(
        `SELECT role, content FROM client_chat_messages
         WHERE client_id = $1 AND created_at >= NOW() - INTERVAL '90 days'
         ORDER BY created_at ASC`,
        [report.client_id]
      ).then(r => r.rows).catch(() => []),
    ]);

    // Per-client section toggles — a section is dropped only when explicitly
    // disabled for this report type; unset sections stay included.
    const sectionConfig = report.report_sections || {};
    const isEnabled = key => sectionConfig[key] == null || sectionConfig[key][report.report_type] !== false;

    const sections = dataCollector.buildReportSections(collectedData)
      .filter(sec => isEnabled(sec.type));
    const reportSeoData = isEnabled('seo') ? seoData : { rankings: [] };

    if (report.report_type === 'monthly') {
      await generateMonthlyReport(report, period, periodStart, periodEnd, sections, collectedData.data, reportSeoData, chatHistory);
    } else {
      await generateWeeklyReport(report, period, periodStart, periodEnd, sections, collectedData.data, reportSeoData, chatHistory);
    }
  } catch (err) {
    console.error(`Report generation failed for ${reportId}:`, err);
    await pool.query(
      'UPDATE reports SET status = $1, error_log = $2 WHERE id = $3',
      ['failed', err.message, reportId]
    );
    throw err;
  }
}

async function generateMonthlyReport(report, period, periodStart, periodEnd, sections, rawData, seoData = {}, chatHistory = []) {
  const clientRow = await pool.query('SELECT * FROM clients WHERE id = $1', [report.client_id]);
  const client = clientRow.rows[0];

  // Condense connector data for the AI prompt. The raw API responses (full
  // order lists, GA4 rows, etc.) can run past a million tokens and exceed the
  // model's limit — the section metrics and tables carry what the summary needs.
  // We also attach any per-section instruction the account manager has set so
  // Claude weights that section accordingly.
  const sectionInstructions = client.section_instructions || {};
  const condensed = sections.map(s => {
    const instruction = sectionInstructions[s.type];
    return {
      connector: s.title,
      store: s.storeLabel || undefined,
      unavailable: s.unavailable || undefined,
      error: s.errorMessage || undefined,
      instruction: instruction || undefined,
      metrics: s.metrics,
      tables: s.tables,
    };
  });

  const executiveSummary = await claudeService.generateExecutiveSummary({
    clientName: client.name,
    clientBriefing: client.briefing_field,
    period,
    monthlyFocus: client.monthly_focus,
    data: condensed,
    seoData,
    chatHistory,
  });

  // Build HTML
  const htmlContent = pdfService.buildMonthlyReportHtml({
    client,
    period,
    executiveSummary,
    sections,
    seoData,
  });

  // Generate PDF — monthly uses puppeteer's footer template so every page
  // shows "Page X of Y" + the company details automatically.
  const pdfPath = await pdfService.generatePDF(report.id, htmlContent, { printFooter: true });

  // Extract top metrics for email
  const topMetrics = extractTopMetrics(rawData);

  // Build email summary HTML
  const summaryHtml = `<p>${executiveSummary.split('\n')[0]}</p>`;

  await pool.query(
    'UPDATE reports SET status = $1, generated_at = NOW(), pdf_path = $2, html_content = $3, summary = $4 WHERE id = $5',
    ['generated', pdfPath, htmlContent, JSON.stringify({ summaryHtml: executiveSummary, metrics: topMetrics }), report.id]
  );

  // Send email
  await sendReport(report.id, { summaryHtml: `<p>${executiveSummary.replace(/\n/g, '<br>')}</p>`, metrics: topMetrics });
}

async function generateWeeklyReport(report, period, periodStart, periodEnd, sections, rawData, seoData = {}, chatHistory = []) {
  const clientRow = await pool.query('SELECT * FROM clients WHERE id = $1', [report.client_id]);
  const client = clientRow.rows[0];

  const metrics = extractTopMetrics(rawData);
  const rankMovers = extractRankMovers(seoData.rankings || [], 'weekly');
  const weekLabel = new Date(periodStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

  const summaryText = await claudeService.generateWeeklySummary({
    clientName: client.name,
    week: period,
    monthlyFocus: client.monthly_focus,
    metrics,
    rankMovers,
    chatHistory,
  });

  const htmlContent = buildWeeklyHtmlPreview({ client, period, summaryText, metrics, rankMovers });

  // Generate weekly PDF
  const weeklyPdfHtml = pdfService.buildWeeklyReportHtml({ client, period, weekLabel, summaryText, metrics, rankMovers });
  const pdfPath = await pdfService.generatePDF(`${report.id}-weekly`, weeklyPdfHtml);

  await pool.query(
    'UPDATE reports SET status = $1, generated_at = NOW(), pdf_path = $2, html_content = $3, summary = $4 WHERE id = $5',
    ['generated', pdfPath, htmlContent, JSON.stringify({ summaryText, metrics, weekLabel }), report.id]
  );

  await sendReport(report.id, { summaryText, metrics, weekLabel, pdfPath });
}

async function sendReport(reportId, overrides = {}) {
  // overrides.pdfPath can be passed directly (not stored in summary JSON)
  const { rows } = await pool.query(
    'SELECT r.*, c.name as client_name, c.report_recipients FROM reports r JOIN clients c ON c.id = r.client_id WHERE r.id = $1',
    [reportId]
  );
  if (!rows.length) throw new Error(`Report ${reportId} not found`);
  const report = rows[0];

  // Fall back to stored summary when resending
  const stored = report.summary || {};
  if (!overrides.summaryText && stored.summaryText) overrides.summaryText = stored.summaryText;
  if (!overrides.summaryHtml && stored.summaryHtml) overrides.summaryHtml = `<p>${stored.summaryHtml.replace(/\n/g, '<br>')}</p>`;
  if (!overrides.metrics && stored.metrics) overrides.metrics = stored.metrics;
  if (!overrides.weekLabel && stored.weekLabel) overrides.weekLabel = stored.weekLabel;

  await pool.query('UPDATE reports SET status = $1 WHERE id = $2', ['sending', reportId]);

  try {
    const recipients = report.report_recipients;
    const to = report.report_type === 'monthly'
      ? (recipients.monthly || [])
      : (recipients.weekly || []);

    if (!to.length) {
      console.warn(`No recipients configured for ${report.report_type} report ${reportId}`);
      await pool.query('UPDATE reports SET status = $1 WHERE id = $2', ['sent', reportId]);
      return;
    }

    const period = formatPeriod(
      report.report_type,
      report.period_start.toISOString().split('T')[0],
      report.period_end.toISOString().split('T')[0]
    );

    if (report.report_type === 'monthly') {
      await emailService.sendMonthlyReport({
        to,
        clientName: report.client_name,
        period,
        summaryHtml: overrides.summaryHtml || '<p>Please see the attached PDF for the full report.</p>',
        pdfPath: report.pdf_path,
        metrics: overrides.metrics || [],
      });
    } else {
      const weekLabel = overrides.weekLabel || new Date(report.period_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
      await emailService.sendWeeklyReport({
        to,
        clientName: report.client_name,
        weekLabel,
        summaryText: overrides.summaryText || 'Please see the weekly snapshot below.',
        metrics: overrides.metrics || [],
        pdfPath: overrides.pdfPath || report.pdf_path || null,
      });
    }

    await pool.query(
      'UPDATE reports SET status = $1, sent_at = NOW() WHERE id = $2',
      ['sent', reportId]
    );
  } catch (err) {
    await pool.query(
      'UPDATE reports SET status = $1, error_log = $2 WHERE id = $3',
      ['failed', err.message, reportId]
    );
    throw err;
  }
}

function extractTopMetrics(rawData) {
  const metrics = [];
  for (const [key, data] of Object.entries(rawData)) {
    if (!data) continue;
    const type = key.split(':')[0];

    if ((type === 'shopify' || type === 'woocommerce') && data.summary) {
      metrics.push(
        { label: 'Revenue', value: `£${parseFloat(data.summary.total_revenue || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` },
        { label: 'Orders', value: String(data.summary.total_orders || 0) },
        { label: 'AOV', value: `£${parseFloat(data.summary.avg_order_value || 0).toFixed(2)}` }
      );
    }
    if (type === 'meta_ads' && data.data) {
      const spend = data.data.reduce((s, r) => s + parseFloat(r.spend || 0), 0);
      metrics.push({ label: 'Meta Spend', value: `£${spend.toFixed(2)}` });
    }
    if (type === 'google_ads' && Array.isArray(data)) {
      let spend = 0;
      for (const batch of data) for (const r of (batch.results || [])) spend += parseInt(r.metrics?.costMicros || 0) / 1_000_000;
      if (spend > 0) metrics.push({ label: 'Google Ads Spend', value: `£${spend.toFixed(2)}` });
    }
    if (type === 'ga4' && data.rows?.length) {
      const metHeaders = (data.metricHeaders || []).map(h => h.name);
      const dimHeaders = (data.dimensionHeaders || []).map(h => h.name);
      const dateRangeIdx = dimHeaders.indexOf('dateRange');
      let sessions = 0;
      for (const row of data.rows) {
        if (dateRangeIdx >= 0 && row.dimensionValues?.[dateRangeIdx]?.value !== 'date_range_0') continue;
        sessions += parseFloat(row.metricValues?.[metHeaders.indexOf('sessions')]?.value || 0);
      }
      if (sessions > 0) metrics.push({ label: 'Sessions', value: Math.round(sessions).toLocaleString() });
    }
    if (type === 'google_search_console' && data.rows?.length) {
      const clicks = data.rows.reduce((s, r) => s + (r.clicks || 0), 0);
      if (clicks > 0) metrics.push({ label: 'Organic Clicks', value: clicks.toLocaleString() });
    }
  }
  return metrics.slice(0, 8);
}

function buildWeeklyHtmlPreview({ client, period, summaryText, metrics, rankMovers = [] }) {
  const metricRows = metrics.map((m, i) => `
    <tr style="${i === 0 ? 'background:#fff2cc;' : i % 2 === 1 ? 'background:#f7f7f7;' : ''}">
      <td style="padding:6px 10px;border:1px solid #000;font-size:13px;color:#333;">${m.label}</td>
      <td style="padding:6px 10px;border:1px solid #000;font-size:${i === 0 ? '16px' : '13px'};font-weight:${i === 0 ? '700' : '400'};text-align:right;">${m.value}</td>
    </tr>`).join('');

  const rankRows = rankMovers.map(r => {
    const change = r.change;
    const chStr = change > 0 ? `<span style="color:#2e7d32;">&#8593;${change}</span>` : change < 0 ? `<span style="color:#c62828;">&#8595;${Math.abs(change)}</span>` : '&ndash;';
    return `<tr>
      <td style="padding:5px 10px;border:1px solid #000;font-size:12px;">${r.keyword}</td>
      <td style="padding:5px 10px;border:1px solid #000;font-size:12px;text-align:center;font-weight:700;">${r.current ?? '&mdash;'}</td>
      <td style="padding:5px 10px;border:1px solid #000;font-size:12px;text-align:center;color:#808080;">${r.previous ?? '&mdash;'}</td>
      <td style="padding:5px 10px;border:1px solid #000;font-size:12px;text-align:center;">${chStr}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:Arial,sans-serif;">
  <div style="max-width:680px;margin:24px auto;background:white;padding:32px 40px;">

    <!-- Header -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
      <tr>
        <td style="vertical-align:bottom;width:120px;">
          <img src="https://raw.githubusercontent.com/octobercomms/claude/main/platform/backend/src/assets/october-logo.gif" height="50" alt="October" style="display:block;">
        </td>
        <td style="vertical-align:bottom;text-align:right;">
          <div style="font-size:15px;font-weight:700;color:#000;">${client.name} &mdash; Weekly Snapshot</div>
          <div style="font-size:13px;color:#808080;margin-top:2px;">${period}</div>
        </td>
      </tr>
    </table>
    <div style="border-top:1px solid #000;margin-bottom:24px;"></div>

    <!-- Summary -->
    <div style="font-size:13px;color:#333;line-height:1.7;margin-bottom:24px;">
      ${summaryText.split('\n').filter(p => p.trim()).map(p => `<p style="margin:0 0 10px;">${p}</p>`).join('')}
    </div>

    <!-- Metrics -->
    ${metrics.length ? `
    <div style="margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Key Metrics</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <th style="padding:6px 10px;border:1px solid #000;background:#d9d9d9;font-size:11px;text-align:left;">Metric</th>
          <th style="padding:6px 10px;border:1px solid #000;background:#d9d9d9;font-size:11px;text-align:right;">This Week</th>
        </tr>
        ${metricRows}
      </table>
    </div>` : ''}

    <!-- Rankings -->
    ${rankMovers.length ? `
    <div style="margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Keyword Movements</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <th style="padding:5px 10px;border:1px solid #000;background:#d9d9d9;font-size:11px;text-align:left;">Keyword</th>
          <th style="padding:5px 10px;border:1px solid #000;background:#d9d9d9;font-size:11px;text-align:center;">Now</th>
          <th style="padding:5px 10px;border:1px solid #000;background:#d9d9d9;font-size:11px;text-align:center;">7d Ago</th>
          <th style="padding:5px 10px;border:1px solid #000;background:#d9d9d9;font-size:11px;text-align:center;">Change</th>
        </tr>
        ${rankRows}
      </table>
    </div>` : ''}

    <!-- Footer -->
    <div style="border-top:1px solid #e0e0e0;padding-top:10px;font-size:10px;color:#808080;">
      Private &amp; Confidential &middot; October Communications Ltd. &middot; Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
    </div>

  </div>
</body>
</html>`;
}

function extractRankMovers(rankings, period = 'weekly') {
  if (!rankings.length) return [];
  return rankings
    .map(kw => {
      const current = kw.current_position ? parseInt(kw.current_position) : null;
      const previous = period === 'weekly'
        ? (kw.position_7d_ago ? parseInt(kw.position_7d_ago) : null)
        : (kw.position_30d_ago ? parseInt(kw.position_30d_ago) : null);
      const change = (current && previous) ? previous - current : null; // positive = improved
      return { keyword: kw.keyword, current, previous, change, tag: kw.tag };
    })
    .filter(r => r.current !== null)
    .sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0))
    .slice(0, 15);
}

function formatPeriod(reportType, start, end) {
  if (reportType === 'monthly') {
    return new Date(start).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }
  const s = new Date(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const e = new Date(end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${s} – ${e}`;
}

async function setStatus(reportId, status) {
  await pool.query('UPDATE reports SET status = $1 WHERE id = $2', [status, reportId]);
}

module.exports = { generateReport, sendReport };
