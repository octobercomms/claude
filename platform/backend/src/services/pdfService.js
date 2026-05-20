const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const PDF_DIR = path.join(__dirname, '../../pdfs');
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });

async function generatePDF(reportId, htmlContent) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    const filename = `report-${reportId}.pdf`;
    const outputPath = path.join(PDF_DIR, filename);

    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    return outputPath;
  } finally {
    await browser.close();
  }
}

function buildMonthlyReportHtml({ client, period, executiveSummary, sections, recommendations, seoData = {} }) {
  const sectionHtml = sections.map(s => buildSectionHtml(s)).join('');
  const seoSectionsHtml = buildSEOSectionsHtml(seoData);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; font-size: 11pt; line-height: 1.6; }

    .page { page-break-after: always; min-height: 297mm; padding: 0; }
    .page:last-child { page-break-after: avoid; }

    /* Cover page */
    .cover { background: #1a1a1a; color: white; display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 297mm; text-align: center; padding: 60px; }
    .cover .agency { font-size: 13pt; letter-spacing: 4px; text-transform: uppercase; opacity: 0.7; margin-bottom: 80px; }
    .cover .client-name { font-size: 36pt; font-weight: 700; margin-bottom: 16px; }
    .cover .report-type { font-size: 14pt; opacity: 0.8; margin-bottom: 8px; }
    .cover .period { font-size: 18pt; font-weight: 300; letter-spacing: 1px; }
    .cover .generated { position: absolute; bottom: 40px; font-size: 9pt; opacity: 0.4; }

    /* Content pages */
    .content-page { padding: 40px 50px; }
    .page-header { border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 32px; display: flex; justify-content: space-between; align-items: baseline; }
    .page-header .section-title { font-size: 16pt; font-weight: 700; }
    .page-header .client-label { font-size: 9pt; color: #888; text-transform: uppercase; letter-spacing: 1px; }

    /* Executive summary */
    .executive-summary p { margin-bottom: 12px; }

    /* Data sections */
    .section { margin-bottom: 40px; }
    .section h3 { font-size: 12pt; font-weight: 700; margin-bottom: 16px; padding-bottom: 6px; border-bottom: 1px solid #e0e0e0; color: #333; }

    /* Metrics grid */
    .metrics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
    .metric-card { border: 1px solid #e0e0e0; border-radius: 4px; padding: 16px; }
    .metric-card .value { font-size: 20pt; font-weight: 700; }
    .metric-card .label { font-size: 9pt; color: #888; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-card .change { font-size: 10pt; margin-top: 6px; }
    .metric-card .change.up { color: #2e7d32; }
    .metric-card .change.down { color: #c62828; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 20px; }
    th { background: #1a1a1a; color: white; padding: 8px 10px; text-align: left; font-weight: 600; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 7px 10px; border-bottom: 1px solid #f0f0f0; }
    tr:nth-child(even) td { background: #fafafa; }

    /* Recommendations */
    .recommendations ol { padding-left: 20px; }
    .recommendations li { margin-bottom: 12px; padding-left: 8px; }
    .recommendations li strong { display: block; margin-bottom: 4px; }

    /* Unavailable notice */
    .unavailable-notice { background: #fff8e1; border: 1px solid #ffc107; border-radius: 4px; padding: 12px 16px; font-size: 10pt; color: #795548; }
  </style>
</head>
<body>

<!-- Cover Page -->
<div class="page cover">
  <div class="agency">October Communications</div>
  <div class="client-name">${client.name}</div>
  <div class="report-type">Monthly Performance Report</div>
  <div class="period">${period}</div>
  <div class="generated">Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
</div>

<!-- Executive Summary -->
<div class="page content-page">
  <div class="page-header">
    <span class="section-title">Executive Summary</span>
    <span class="client-label">${client.name} · ${period}</span>
  </div>
  <div class="executive-summary">
    ${executiveSummary.split('\n').filter(p => p.trim()).map(p => `<p>${p}</p>`).join('')}
  </div>
</div>

<!-- Data Sections -->
${sectionHtml}

<!-- SEO Sections -->
${seoSectionsHtml}

<!-- Recommendations -->
<div class="page content-page">
  <div class="page-header">
    <span class="section-title">Recommendations</span>
    <span class="client-label">${client.name} · ${period}</span>
  </div>
  <div class="recommendations">
    ${formatRecommendations(recommendations)}
  </div>
</div>

</body>
</html>`;
}

function buildSectionHtml(section) {
  if (!section.data || section.unavailable) {
    return `
    <div class="page content-page">
      <div class="page-header">
        <span class="section-title">${section.title}</span>
        <span class="client-label">${section.storeLabel || ''}</span>
      </div>
      <div class="unavailable-notice">
        Data unavailable for this section. ${section.errorMessage || 'Connector not configured or token expired.'}
      </div>
    </div>`;
  }

  const metrics = section.metrics || [];
  const metricsHtml = metrics.length ? `
    <div class="metrics-grid">
      ${metrics.map(m => `
        <div class="metric-card">
          <div class="value">${m.value}</div>
          <div class="label">${m.label}</div>
          ${m.change !== undefined ? `<div class="change ${m.change >= 0 ? 'up' : 'down'}">${m.change >= 0 ? '↑' : '↓'} ${Math.abs(m.change)}% vs prior period</div>` : ''}
        </div>
      `).join('')}
    </div>
  ` : '';

  const tables = section.tables || [];
  const tablesHtml = tables.map(t => buildTableHtml(t)).join('');

  return `
  <div class="page content-page">
    <div class="page-header">
      <span class="section-title">${section.title}</span>
      <span class="client-label">${section.storeLabel || ''}</span>
    </div>
    ${metricsHtml}
    ${tablesHtml}
  </div>`;
}

function buildTableHtml({ heading, headers, rows }) {
  if (!rows || !rows.length) return '';
  return `
    <div class="section">
      ${heading ? `<h3>${heading}</h3>` : ''}
      <table>
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function formatRecommendations(text) {
  if (!text) return '<p>No recommendations generated.</p>';
  // Parse numbered list from Claude output
  const lines = text.split('\n').filter(l => l.trim());
  const items = lines.filter(l => /^\d+\./.test(l.trim()) || l.startsWith('-') || l.startsWith('•'));
  if (items.length) {
    return `<ol>${items.map(item => {
      const clean = item.replace(/^[\d]+\.\s*|-\s*|•\s*/, '').trim();
      const parts = clean.split(':');
      if (parts.length > 1) {
        return `<li><strong>${parts[0].trim()}:</strong>${parts.slice(1).join(':')}</li>`;
      }
      return `<li>${clean}</li>`;
    }).join('')}</ol>`;
  }
  return `<div>${text.split('\n').map(p => `<p>${p}</p>`).join('')}</div>`;
}

function buildSEOSectionsHtml(seoData) {
  const parts = [];

  // Rankings section
  const rankings = (seoData.rankings || []).filter(k => k.current_position);
  if (rankings.length) {
    const improved = rankings.filter(k => {
      const curr = parseInt(k.current_position);
      const prev = parseInt(k.position_30d_ago);
      return prev && curr && prev - curr >= 3;
    }).sort((a, b) => (parseInt(b.position_30d_ago) - parseInt(b.current_position)) - (parseInt(a.position_30d_ago) - parseInt(a.current_position)));

    const declined = rankings.filter(k => {
      const curr = parseInt(k.current_position);
      const prev = parseInt(k.position_30d_ago);
      return prev && curr && curr - prev >= 3;
    });

    const top10 = [...rankings].sort((a, b) => (a.current_position || 999) - (b.current_position || 999)).slice(0, 10);

    parts.push(`
    <div class="page content-page">
      <div class="page-header">
        <span class="section-title">Organic Rankings</span>
        <span class="client-label">${rankings.length} keywords tracked</span>
      </div>
      ${top10.length ? buildTableHtml({
        heading: 'Top 10 Ranking Keywords',
        headers: ['Keyword', 'Location', 'Position', '30d Ago', 'Best Ever'],
        rows: top10.map(k => [
          k.keyword,
          k.location_name || 'UK',
          k.current_position || '—',
          k.position_30d_ago || '—',
          k.best_position || '—',
        ]),
      }) : ''}
      ${improved.length ? buildTableHtml({
        heading: 'Biggest Improvements This Month',
        headers: ['Keyword', 'Now', '30d Ago', 'Change'],
        rows: improved.slice(0, 10).map(k => {
          const change = parseInt(k.position_30d_ago) - parseInt(k.current_position);
          return [k.keyword, k.current_position, k.position_30d_ago, `↑${change}`];
        }),
      }) : ''}
      ${declined.length ? buildTableHtml({
        heading: 'Declined This Month',
        headers: ['Keyword', 'Now', '30d Ago', 'Change'],
        rows: declined.slice(0, 10).map(k => {
          const change = parseInt(k.current_position) - parseInt(k.position_30d_ago);
          return [k.keyword, k.current_position, k.position_30d_ago, `↓${change}`];
        }),
      }) : ''}
    </div>`);
  }

  // Backlinks + Domain Rank section
  const bl = seoData.backlinks;
  if (bl) {
    parts.push(`
    <div class="page content-page">
      <div class="page-header">
        <span class="section-title">Domain Authority &amp; Backlinks</span>
        <span class="client-label">DataForSEO Domain Rank</span>
      </div>
      <div class="metrics-grid">
        <div class="metric-card"><div class="value">${bl.domain_rank ?? '—'}</div><div class="label">Domain Rank (0–100)</div></div>
        <div class="metric-card"><div class="value">${(bl.backlinks_total || 0).toLocaleString()}</div><div class="label">Total Backlinks</div></div>
        <div class="metric-card"><div class="value">${(bl.referring_domains || 0).toLocaleString()}</div><div class="label">Referring Domains</div></div>
        ${bl.new_backlinks != null ? `<div class="metric-card"><div class="value" style="color:#2e7d32;">+${bl.new_backlinks}</div><div class="label">New This Month</div></div>` : ''}
        ${bl.lost_backlinks != null ? `<div class="metric-card"><div class="value" style="color:#c62828;">-${bl.lost_backlinks}</div><div class="label">Lost This Month</div></div>` : ''}
      </div>
    </div>`);
  }

  // LLM Visibility section
  const llm = seoData.llm_visibility;
  if (llm) {
    parts.push(`
    <div class="page content-page">
      <div class="page-header">
        <span class="section-title">AI Brand Visibility</span>
        <span class="client-label">Google AI Overview presence</span>
      </div>
      <div class="metrics-grid">
        <div class="metric-card"><div class="value">${llm.keywords_checked}</div><div class="label">Keywords Checked</div></div>
        <div class="metric-card"><div class="value">${llm.ai_overview_present}</div><div class="label">Triggered AI Overview</div></div>
        <div class="metric-card"><div class="value">${llm.brand_visible}</div><div class="label">Brand Mentioned</div></div>
      </div>
      ${llm.details?.length ? buildTableHtml({
        heading: 'Keyword-Level Breakdown',
        headers: ['Keyword', 'AI Overview', 'Brand Visible', 'Snippet'],
        rows: llm.details.map(d => [
          d.keyword,
          d.has_ai_overview ? 'Yes' : 'No',
          d.brand_mentioned ? '✓ Yes' : '✗ No',
          d.snippet ? d.snippet.slice(0, 80) + '…' : '—',
        ]),
      }) : ''}
    </div>`);
  }

  return parts.join('');
}

module.exports = { generatePDF, buildMonthlyReportHtml };
