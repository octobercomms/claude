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
    'UPDATE reports SET status = $1, generated_at = NOW(), pdf_path = $2, html_content = $3 WHERE id = $4',
    ['generated', pdfPath, htmlContent, report.id]
  );

  // Send email
  const topMetrics = extractTopMetrics(rawData);
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
    'UPDATE reports SET status = $1, generated_at = NOW(), html_content = $2 WHERE id = $3',
    ['generated', htmlContent, report.id]
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
        { label: 'Orders', value: data.summary.total_orders || 0 },
        { label: 'AOV', value: `£${parseFloat(data.summary.avg_order_value || 0).toFixed(2)}` }
      );
    }
    if (type === 'meta_ads' && data.data) {
      const spend = data.data.reduce((s, r) => s + parseFloat(r.spend || 0), 0);
      metrics.push({ label: 'Meta Ad Spend', value: `£${spend.toFixed(2)}` });
    }
  }
  return metrics.slice(0, 8);
}

function buildWeeklyHtmlPreview({ client, period, summaryText, metrics }) {
  return `<html><body><h1>${client.name} Weekly Snapshot</h1><p>${period}</p><p>${summaryText}</p></body></html>`;
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
