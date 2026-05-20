const pool = require('../db');
const claudeService = require('./claude');
const pdfService = require('./pdfService');
const emailService = require('./emailService');
const dataCollector = require('./dataCollector');

async function generateReport(reportId) {
  const { rows } = await pool.query(
    'SELECT r.*, c.name as client_name, c.monthly_focus, c.report_recipients FROM reports r JOIN clients c ON c.id = r.client_id WHERE r.id = $1',
    [reportId]
  );
  if (!rows.length) throw new Error(`Report ${reportId} not found`);
  const report = rows[0];

  await setStatus(reportId, 'generating');

  try {
    const periodStart = report.period_start.toISOString().split('T')[0];
    const periodEnd = report.period_end.toISOString().split('T')[0];
    const period = formatPeriod(report.report_type, periodStart, periodEnd);

    // Collect data from all connectors
    const collectedData = await dataCollector.collectClientData(
      report.client_id, periodStart, periodEnd
    );

    const sections = dataCollector.buildReportSections(collectedData);

    if (report.report_type === 'monthly') {
      await generateMonthlyReport(report, period, periodStart, periodEnd, sections, collectedData.data);
    } else {
      await generateWeeklyReport(report, period, periodStart, periodEnd, sections, collectedData.data);
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

async function generateMonthlyReport(report, period, periodStart, periodEnd, sections, rawData) {
  const clientRow = await pool.query('SELECT * FROM clients WHERE id = $1', [report.client_id]);
  const client = clientRow.rows[0];

  // Generate AI content
  const [executiveSummary, recommendations] = await Promise.all([
    claudeService.generateExecutiveSummary({
      clientName: client.name,
      period,
      monthlyFocus: client.monthly_focus,
      data: rawData,
    }),
    claudeService.generateRecommendations({
      monthlyFocus: client.monthly_focus,
      data: rawData,
    }),
  ]);

  // Build HTML
  const htmlContent = pdfService.buildMonthlyReportHtml({
    client,
    period,
    executiveSummary,
    sections,
    recommendations,
  });

  // Generate PDF
  const pdfPath = await pdfService.generatePDF(report.id, htmlContent);

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

async function generateWeeklyReport(report, period, periodStart, periodEnd, sections, rawData) {
  const clientRow = await pool.query('SELECT * FROM clients WHERE id = $1', [report.client_id]);
  const client = clientRow.rows[0];

  // Build weekly metrics summary
  const metrics = extractTopMetrics(rawData);
  const weekLabel = new Date(periodStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

  const summaryText = await claudeService.generateWeeklySummary({
    clientName: client.name,
    week: period,
    monthlyFocus: client.monthly_focus,
    metrics,
  });

  const htmlContent = buildWeeklyHtmlPreview({ client, period, summaryText, metrics });

  await pool.query(
    'UPDATE reports SET status = $1, generated_at = NOW(), html_content = $2, summary = $3 WHERE id = $4',
    ['generated', htmlContent, JSON.stringify({ summaryText, metrics, weekLabel }), report.id]
  );

  await sendReport(report.id, { summaryText, metrics, weekLabel });
}

async function sendReport(reportId, overrides = {}) {
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

function buildWeeklyHtmlPreview({ client, period, summaryText, metrics }) {
  const metricsHtml = metrics.length ? `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:24px 0;">
      ${metrics.map(m => `
        <div style="border:1px solid #e0e0e0;border-radius:6px;padding:16px;">
          <div style="font-size:22px;font-weight:700;color:#1a1a1a;">${m.value}</div>
          <div style="font-size:11px;color:#888;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;">${m.label}</div>
        </div>`).join('')}
    </div>` : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f5f5; color: #1a1a1a; }
    .wrap { max-width: 680px; margin: 0 auto; background: white; }
    .header { background: #1a1a1a; color: white; padding: 32px 40px; }
    .header .agency { font-size: 11px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.6; margin-bottom: 8px; }
    .header h1 { font-size: 22px; font-weight: 700; }
    .header .period { font-size: 13px; opacity: 0.7; margin-top: 4px; }
    .body { padding: 32px 40px; }
    .summary { font-size: 15px; line-height: 1.7; color: #333; }
    .footer { background: #f9f9f9; border-top: 1px solid #e8e8e8; padding: 20px 40px; font-size: 11px; color: #aaa; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="agency">October Communications</div>
      <h1>${client.name} — Weekly Snapshot</h1>
      <div class="period">${period}</div>
    </div>
    <div class="body">
      ${metricsHtml}
      <div class="summary">${summaryText.split('\n').filter(p => p.trim()).map(p => `<p style="margin-bottom:12px;">${p}</p>`).join('')}</div>
    </div>
    <div class="footer">October Communications · Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
  </div>
</body>
</html>`;
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
