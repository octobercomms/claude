const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const PDF_DIR = path.join(__dirname, '../../pdfs');
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });

const FONTS_DIR = path.join(__dirname, '../../../frontend/public/fonts');
const LOGO_SVG_PATH = path.join(__dirname, '../assets/october-logo.svg');

function fontFace(family, weight, style, file) {
  try {
    const b64 = fs.readFileSync(path.join(FONTS_DIR, file)).toString('base64');
    return `@font-face { font-family: '${family}'; font-weight: ${weight}; font-style: ${style}; src: url('data:font/woff2;base64,${b64}') format('woff2'); }`;
  } catch { return ''; }
}

function buildFontCSS() {
  return [
    fontFace('Brockmann', '400', 'normal', 'brockmann-regular-webfont.woff2'),
    fontFace('Brockmann', '400', 'italic', 'brockmann-regularitalic-webfont.woff2'),
    fontFace('Brockmann', '600', 'normal', 'brockmann-semibold-webfont.woff2'),
    fontFace('Brockmann', '600', 'italic', 'brockmann-semibolditalic-webfont.woff2'),
    fontFace('Brockmann', '700', 'normal', 'brockmann-bold-webfont.woff2'),
    fontFace('Brockmann', '700', 'italic', 'brockmann-bolditalic-webfont.woff2'),
  ].filter(Boolean).join('\n');
}

function getLogoDataUri() {
  try {
    const svg = fs.readFileSync(LOGO_SVG_PATH, 'utf8');
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  } catch {
    return null;
  }
}

function logoImg(height = 55) {
  const uri = getLogoDataUri();
  if (!uri) return '<div style="font-size:14pt;font-weight:700;letter-spacing:0.5px;">OCTOBER<span style="display:block;font-size:8pt;font-weight:400;color:#808080;text-transform:uppercase;letter-spacing:2px;">Communications</span></div>';
  return `<img src="${uri}" height="${height}" alt="October" style="display:block;">`;
}

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

function getPageCSS() {
  return `
${buildFontCSS()}
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Brockmann', Arial, sans-serif;
  color: #000000;
  font-size: 8pt;
  line-height: 1.4;
  background: white;
}

.page {
  page-break-after: always;
  width: 210mm;
  min-height: 297mm;
  padding: 40pt 42pt 56pt;
  position: relative;
}
.page:last-child { page-break-after: avoid; }

/* ---- Cover ---- */
.cover { padding: 40pt 42pt 40pt; display: flex; flex-direction: column; width: 210mm; min-height: 297mm; page-break-after: always; }
.cover-top { display: flex; justify-content: space-between; align-items: flex-start; }
.cover-logo { font-size: 14pt; font-weight: 700; letter-spacing: 0.5px; }
.cover-logo .sub { font-size: 8pt; font-weight: 400; color: #808080; text-transform: uppercase; letter-spacing: 2px; display: block; margin-top: 2pt; }
.cover-right { text-align: right; }
.cover-right .report-for { font-size: 16pt; font-weight: 700; }
.cover-right .period { font-size: 13pt; color: #808080; margin-top: 2pt; }
.cover-hr { border: none; border-top: 1pt solid #000; margin: 14pt 0; }
.cover-body { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 60pt 0 40pt; }
.cover-client { font-size: 34pt; font-weight: 700; line-height: 1.1; margin-bottom: 16pt; }
.cover-report-type { font-size: 13pt; color: #808080; }
.cover-date { font-size: 16pt; font-weight: 400; margin-top: 6pt; }

/* ---- Page header ---- */
.pg-head { display: flex; justify-content: space-between; align-items: baseline; }
.pg-head-l { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.pg-head-r { font-size: 8pt; color: #808080; }
.pg-hr { border: none; border-top: 1pt solid #000; margin: 8pt 0 20pt; }

/* ---- Section title ---- */
.section-title { font-size: 14pt; font-weight: 700; margin-bottom: 16pt; }
.sub-title { font-size: 9pt; font-weight: 700; margin: 16pt 0 6pt; }

/* ---- Tables ---- */
table { border-collapse: collapse; font-size: 8pt; margin-bottom: 16pt; }
th {
  background: #d9d9d9;
  font-weight: 700;
  padding: 5pt;
  border: 1pt solid #000;
  text-align: left;
  font-size: 8pt;
  white-space: nowrap;
}
td {
  padding: 5pt;
  border: 1pt solid #000;
  vertical-align: top;
}
.w-full { width: 100%; }
tr.current > td { background: #fff2cc; font-weight: 700; }
tr.current > td .big { font-size: 14pt; }
tr.alt > td { background: #f7f7f7; }

/* Metrics summary row */
.metrics-row { display: flex; gap: 0; margin-bottom: 16pt; border: 1pt solid #000; }
.metric-cell { flex: 1; padding: 8pt 10pt; border-right: 1pt solid #000; }
.metric-cell:last-child { border-right: none; }
.metric-cell .val { font-size: 14pt; font-weight: 700; }
.metric-cell .lbl { font-size: 7pt; color: #808080; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2pt; }

/* Text */
p { margin-bottom: 8pt; font-size: 8.5pt; line-height: 1.6; }
ol { padding-left: 14pt; margin-bottom: 8pt; }
li { margin-bottom: 8pt; font-size: 8.5pt; line-height: 1.6; }
li strong { display: block; margin-bottom: 2pt; }

/* Unavailable */
.unavail { background: #fff8e1; border: 1pt solid #e0c000; padding: 10pt 12pt; font-size: 8pt; color: #5d4000; }

/* Footer */
.pg-footer {
  position: absolute;
  bottom: 18pt;
  left: 42pt;
  right: 42pt;
  border-top: 0.5pt solid #ccc;
  padding-top: 4pt;
  display: flex;
  justify-content: space-between;
  font-size: 7pt;
  color: #808080;
}
`;}

function pageHeader(clientName, period) {
  return `
  <div class="pg-head">
    <span class="pg-head-l">${logoImg(28)}</span>
    <span class="pg-head-r">${clientName} &middot; ${period}</span>
  </div>
  <hr class="pg-hr">`;
}

function pageFooter(clientName, period) {
  return `
  <div class="pg-footer">
    <span>Private &amp; Confidential &middot; October Communications Ltd.</span>
    <span>${clientName} &middot; ${period}</span>
  </div>`;
}

function buildMonthlyReportHtml({ client, period, executiveSummary, sections, recommendations, seoData = {} }) {
  const sectionHtml = sections.map(s => buildSectionHtml(s, client, period)).join('');
  const seoSectionsHtml = buildSEOSectionsHtml(seoData, client, period);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${getPageCSS()}</style>
</head>
<body>

<!-- Cover Page -->
<div class="cover">
  <div class="cover-top">
    <div class="cover-logo">${logoImg(55)}</div>
    <div class="cover-right">
      <div class="report-for">Report for ${client.name}</div>
      <div class="period">${period}</div>
    </div>
  </div>
  <hr class="cover-hr">
  <div class="cover-body">
    <div class="cover-client">${client.name}</div>
    <div class="cover-report-type">Monthly Performance Report</div>
    <div class="cover-date">${period}</div>
  </div>
  <div style="border-top:0.5pt solid #ccc;padding-top:6pt;display:flex;justify-content:space-between;font-size:7pt;color:#808080;margin-top:auto;">
    <span>Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
    <span>Private &amp; Confidential. October Communications Ltd. Company No. 8816416. Registered in England and Wales.</span>
  </div>
</div>

<!-- Executive Summary -->
<div class="page">
  ${pageHeader(client.name, period)}
  <div class="section-title">Executive Summary</div>
  ${executiveSummary.split('\n').filter(p => p.trim()).map(p => `<p>${p}</p>`).join('')}
  ${pageFooter(client.name, period)}
</div>

<!-- Data Sections -->
${sectionHtml}

<!-- SEO Sections -->
${seoSectionsHtml}

<!-- Recommendations -->
<div class="page">
  ${pageHeader(client.name, period)}
  <div class="section-title">Recommendations</div>
  ${formatRecommendations(recommendations)}
  ${pageFooter(client.name, period)}
</div>

</body>
</html>`;
}

function buildSectionHtml(section, client = {}, period = '') {
  const clientName = client.name || '';

  if (!section.data || section.unavailable) {
    return `
    <div class="page">
      ${pageHeader(clientName, period)}
      <div class="section-title">${section.title}${section.storeLabel ? ` <span style="font-weight:400;font-size:11pt;color:#808080;">— ${section.storeLabel}</span>` : ''}</div>
      <div class="unavail">${section.errorMessage || 'Data unavailable — connector not configured or token expired.'}</div>
      ${pageFooter(clientName, period)}
    </div>`;
  }

  const metrics = section.metrics || [];
  const metricsHtml = metrics.length ? `
    <div class="metrics-row">
      ${metrics.map(m => `
        <div class="metric-cell">
          <div class="val">${m.value}</div>
          <div class="lbl">${m.label}</div>
        </div>`).join('')}
    </div>` : '';

  const tables = section.tables || [];
  const tablesHtml = tables.map(t => buildTableHtml(t)).join('');

  return `
  <div class="page">
    ${pageHeader(clientName, period)}
    <div class="section-title">${section.title}${section.storeLabel ? ` <span style="font-weight:400;font-size:11pt;color:#808080;">— ${section.storeLabel}</span>` : ''}</div>
    ${metricsHtml}
    ${tablesHtml}
    ${pageFooter(clientName, period)}
  </div>`;
}

function buildTableHtml({ heading, headers, rows, highlightFirst = false }) {
  if (!rows || !rows.length) return '';
  return `
    ${heading ? `<div class="sub-title">${heading}</div>` : ''}
    <table class="w-full">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row, i) => {
        const cls = (highlightFirst && i === 0) ? ' class="current"' : (i % 2 === 1 ? ' class="alt"' : '');
        return `<tr${cls}>${row.map(cell => `<td>${cell ?? ''}</td>`).join('')}</tr>`;
      }).join('')}</tbody>
    </table>`;
}

function formatRecommendations(text) {
  if (!text) return '<p>No recommendations generated.</p>';
  const lines = text.split('\n').filter(l => l.trim());
  const items = lines.filter(l => /^\d+\./.test(l.trim()) || l.startsWith('-') || l.startsWith('•'));
  if (items.length) {
    return `<ol>${items.map(item => {
      const clean = item.replace(/^[\d]+\.\s*|-\s*|•\s*/, '').trim();
      const colonIdx = clean.indexOf(':');
      if (colonIdx > 0 && colonIdx < 60) {
        return `<li><strong>${clean.slice(0, colonIdx)}:</strong>${clean.slice(colonIdx + 1)}</li>`;
      }
      return `<li>${clean}</li>`;
    }).join('')}</ol>`;
  }
  return `<div>${text.split('\n').map(p => `<p>${p}</p>`).join('')}</div>`;
}

function buildSEOSectionsHtml(seoData, client = {}, period = '') {
  const clientName = client.name || '';
  const parts = [];

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
    <div class="page">
      ${pageHeader(clientName, period)}
      <div class="section-title">Organic Rankings</div>
      ${top10.length ? buildTableHtml({
        heading: `Top 10 Ranking Keywords (${rankings.length} tracked total)`,
        headers: ['Keyword', 'Location', 'Position', '30d Ago', 'Best Ever'],
        rows: top10.map(k => [k.keyword, k.location_name || 'UK', k.current_position || '—', k.position_30d_ago || '—', k.best_position || '—']),
        highlightFirst: true,
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
      ${pageFooter(clientName, period)}
    </div>`);
  }

  return parts.join('');
}

function buildWeeklyReportHtml({ client, period, weekLabel, summaryText, metrics = [], rankMovers = [] }) {
  const clientName = client.name || '';

  const metricRows = metrics.slice(0, 8).map((m, i) => {
    const cls = i === 0 ? ' class="current"' : i % 2 === 1 ? ' class="alt"' : '';
    return `<tr${cls}><td>${m.label}</td><td style="text-align:right;">${m.value}</td></tr>`;
  }).join('');

  const rankRows = rankMovers.map(r => {
    const change = r.change;
    const chStr = change > 0 ? `&#8593;${change}` : change < 0 ? `&#8595;${Math.abs(change)}` : '&ndash;';
    const chStyle = change > 0 ? 'color:#2e7d32;' : change < 0 ? 'color:#c62828;' : '';
    return `<tr><td>${r.keyword}</td><td style="text-align:center;font-weight:700;">${r.current ?? '&mdash;'}</td><td style="text-align:center;color:#808080;">${r.previous ?? '&mdash;'}</td><td style="text-align:center;${chStyle}">${chStr}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${getPageCSS()}</style>
</head>
<body>

<!-- Page 1: header + content (no separate cover for weekly) -->
<div class="page">
  <div class="cover-top">
    <div class="cover-logo">${logoImg(55)}</div>
    <div class="cover-right">
      <div class="report-for">${clientName} &mdash; Weekly Snapshot</div>
      <div class="period">w/c ${weekLabel}</div>
    </div>
  </div>
  <hr class="cover-hr" style="margin-bottom:20pt;">

  ${summaryText.split('\n').filter(p => p.trim()).map(p => `<p>${p}</p>`).join('')}

  ${metrics.length ? `
  <div class="sub-title" style="margin-top:16pt;">Key Metrics</div>
  <table class="w-full">
    <thead><tr><th>Metric</th><th style="text-align:right;">This Week</th></tr></thead>
    <tbody>${metricRows}</tbody>
  </table>` : ''}

  ${rankMovers.length ? `
  <div class="sub-title">Keyword Movements</div>
  <table class="w-full">
    <thead><tr><th>Keyword</th><th style="text-align:center;">Now</th><th style="text-align:center;">7d Ago</th><th style="text-align:center;">Change</th></tr></thead>
    <tbody>${rankRows}</tbody>
  </table>` : ''}

  ${pageFooter(clientName, period)}
</div>

</body>
</html>`;
}

module.exports = { generatePDF, buildMonthlyReportHtml, buildWeeklyReportHtml };
