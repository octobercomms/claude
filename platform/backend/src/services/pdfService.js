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

// Header rendered by puppeteer at the top of every page — October logo + the
// report identifier. Inline styles because the print engine renders header /
// footer templates in their own context (no shared CSS).
function buildPrintHeaderTemplate(clientName, period) {
  const logo = getLogoDataUri();
  return `<div style="width:100%;padding:6mm 15mm 0;font-family:Arial,sans-serif;box-sizing:border-box;-webkit-print-color-adjust:exact;">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:4pt;border-bottom:0.5pt solid #000;">
      <div style="flex:0 0 auto;">${logo ? `<img src="${logo}" style="height:28px;display:block;">` : ''}</div>
      <div style="text-align:right;">
        <div style="font-size:11pt;font-weight:700;color:#000;">Report for ${escapeForTemplate(clientName)}</div>
        <div style="font-size:9pt;color:#808080;margin-top:2pt;">${escapeForTemplate(period)}</div>
      </div>
    </div>
  </div>`;
}

// Footer rendered by puppeteer on every page. `footerLines` lets the platform
// admin override the company-details strip from Settings → Report Appearance;
// page numbering is always on the first line.
function buildPrintFooterTemplate(footerLines = []) {
  const lines = footerLines.filter(Boolean);
  const defaults = [
    'Private & Confidential · October Communications Ltd.',
    'Company No. 8816416 · VAT Registration No. GB 176 6335 82 · Registered in England and Wales',
    '85 Great Portland Street, First Floor, London W1W 7LT · www.octobercomms.com',
  ];
  const [first, ...rest] = lines.length ? lines : defaults;
  return `<div style="width:100%;font-size:6.5pt;color:#808080;text-align:center;font-family:Arial,sans-serif;padding:0 15mm;line-height:1.5;-webkit-print-color-adjust:exact;box-sizing:border-box;">
    <div style="border-top:0.5pt solid #ccc;padding-top:5pt;">
      Page <span class="pageNumber"></span> of <span class="totalPages"></span>
      ${first ? `&middot; ${escapeForTemplate(first)}` : ''}
    </div>
    ${rest.map(l => `<div>${escapeForTemplate(l)}</div>`).join('')}
  </div>`;
}

function escapeForTemplate(str) {
  return String(str ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

async function generatePDF(reportId, htmlContent, options = {}) {
  // Header lives inline in the body — puppeteer just handles the footer strip
  // (Page X of Y + configurable company lines). Trying to render the header
  // via puppeteer's headerTemplate left the body content overlapping the
  // logo because the print-engine margin and inline content layout systems
  // didn't agree on heights.
  const { printFooter = false, footerLines = [] } = options;
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
      displayHeaderFooter: printFooter,
      headerTemplate: printFooter ? '<div></div>' : undefined,
      footerTemplate: printFooter ? buildPrintFooterTemplate(footerLines) : undefined,
      margin: printFooter
        // 30mm bottom strip — wider than the footer's intrinsic 19mm so that
        // section content can't bleed into the footer area when Chrome's
        // break-inside hint can't find a clean place to cut. Earlier we used
        // 22mm and tall sections (e.g. the Sessions-by-Channel table) still
        // overlapped the company-details lines.
        ? { top: '0', right: '0', bottom: '30mm', left: '0' }
        : { top: '0', right: '0', bottom: '0', left: '0' },
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
/* When generated with puppeteer's displayHeaderFooter, the print engine
   reserves a strip at the bottom of the physical page for its own footer —
   so we use a slimmer min-height and bottom padding to fit inside it. */
.page.with-print-footer { padding-bottom: 12pt; min-height: calc(297mm - 19mm); }

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
.pg-head { display: flex; justify-content: space-between; align-items: flex-start; }
.pg-head-l { flex: 0 0 auto; }
.pg-head-r { text-align: right; }
.pg-head-title { font-size: 13pt; font-weight: 700; line-height: 1.1; }
.pg-head-period { font-size: 10pt; color: #808080; margin-top: 3pt; }
.pg-hr { border: none; border-top: 1pt solid #000; margin: 10pt 0 18pt; }

/* ---- Section title ---- */
.section-title { font-size: 13pt; font-weight: 700; margin-bottom: 4pt; }
.sub-title { font-size: 9pt; font-weight: 700; margin: 12pt 0 5pt; }
.store-sub { font-size: 11pt; font-weight: 700; color: #1a1a1a; margin: 16pt 0 8pt; padding-bottom: 3pt; border-bottom: 0.5pt solid #ccc; }
.store-sub:first-of-type { margin-top: 0; }

/* ---- Flowing template-driven layout ---- */
.report-content { padding: 12mm 15mm 60pt; }
.report-head { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 6pt; border-bottom: 1pt solid #000; margin-bottom: 18pt; }
.report-head-l { flex: 0 0 auto; }
.report-head-r { text-align: right; }
.report-head-title { font-size: 14pt; font-weight: 700; line-height: 1.1; }
.report-head-period { font-size: 10pt; color: #808080; margin-top: 3pt; }
/* Atomic blocks — small, self-contained things that should never split
   mid-element: a row of KPI cells, a single chart, a single table row.
   Larger containers (.section, table, tbody) are deliberately allowed to
   break across pages — forbidding it on a table taller than the page
   forces Chrome to overflow into the footer margin (the bug fixed here). */
.section { display: block; margin-bottom: 22pt; }
.metrics-row, .chart-block, tr { page-break-inside: avoid; break-inside: avoid-page; }
.section-title { page-break-after: avoid; break-after: avoid-page; }
thead { display: table-header-group; } /* repeat table headers on each page */
.metrics-table th, .metrics-table td { padding: 4pt 8pt; }
.section-insight {
  font-size: 9pt;
  color: #555;
  font-style: italic;
  line-height: 1.45;
  margin: 0 0 10pt;
  padding-left: 8pt;
  border-left: 2pt solid #E7CD41;
}
.metrics-table th { background: #f3f3f3; font-weight: 700; padding: 5pt 8pt; border: 0.5pt solid #ccc; font-size: 8pt; }
.metrics-table td { padding: 5pt 8pt; border: 0.5pt solid #eee; }

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
.metric-cell .delta { font-size: 8pt; font-weight: 600; margin-top: 3pt; }
.metric-cell .delta.up { color: #2e7d32; }
.metric-cell .delta.down { color: #c62828; }
.metric-cell .delta.flat { color: #808080; }
.metric-cell .delta-prev { font-size: 7pt; color: #808080; margin-top: 1pt; }

/* Charts */
.chart-block { margin-bottom: 18pt; }
.chart-block svg { display: block; width: 100%; max-width: 460pt; }

/* Position distribution */
.pos-dist { display: flex; gap: 0; margin-bottom: 16pt; border: 1pt solid #000; }
.pos-dist-cell { flex: 1; padding: 6pt 8pt; border-right: 1pt solid #000; text-align: center; }
.pos-dist-cell:last-child { border-right: none; }
.pos-dist-cell .val { font-size: 16pt; font-weight: 700; }
.pos-dist-cell .lbl { font-size: 7pt; color: #808080; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2pt; }

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
  bottom: 16pt;
  left: 42pt;
  right: 42pt;
  border-top: 0.5pt solid #ccc;
  padding-top: 5pt;
  font-size: 6.5pt;
  color: #808080;
  text-align: center;
  line-height: 1.5;
}
.pg-footer div { margin: 0; }
`;}

function pageHeader(clientName, period) {
  return `
  <div class="pg-head">
    <div class="pg-head-l">${logoImg(36)}</div>
    <div class="pg-head-r">
      <div class="pg-head-title">Report for ${clientName}</div>
      <div class="pg-head-period">${period}</div>
    </div>
  </div>
  <hr class="pg-hr">`;
}

function pageFooter() {
  return `
  <div class="pg-footer">
    <div>Private &amp; Confidential &middot; October Communications Ltd.</div>
    <div>Company No. 8816416 &middot; VAT Registration No. GB 176 6335 82 &middot; Registered in England and Wales</div>
    <div>85 Great Portland Street, First Floor, London W1W 7LT &middot; www.octobercomms.com</div>
  </div>`;
}

function buildMonthlyReportHtml({ client, period, executiveSummary, sections, seoData = {} }) {
  // Group sections by connector type so that all stores of a single connector
  // (e.g. multiple Shopify stores) render in one combined section, with each
  // store as a sub-block within. Avoids the old one-page-per-store sprawl.
  const sectionsByType = {};
  const typeOrder = [];
  for (const s of sections) {
    if (!sectionsByType[s.type]) {
      sectionsByType[s.type] = [];
      typeOrder.push(s.type);
    }
    sectionsByType[s.type].push(s);
  }
  const sectionGroups = typeOrder.map(type => ({
    type,
    title: sectionsByType[type][0].title,
    sections: sectionsByType[type],
  }));

  const sectionHtml = sectionGroups.map(g => buildSectionGroupHtml(g, client, period)).join('');
  const seoSectionsHtml = buildSEOSectionsHtml(seoData, client, period);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${getPageCSS()}</style>
</head>
<body>

<!-- Executive Summary -->
<div class="page with-print-footer">
  ${pageHeader(client.name, period)}
  <div class="section-title">Executive Summary</div>
  ${executiveSummary.split('\n').filter(p => p.trim()).map(p => `<p>${p}</p>`).join('')}
</div>

<!-- Data Sections (grouped by connector type) -->
${sectionHtml}

<!-- SEO Sections -->
${seoSectionsHtml}

</body>
</html>`;
}

function buildSectionGroupHtml(group, client = {}, period = '') {
  const clientName = client.name || '';
  const hasMultipleStores = group.sections.length > 1
    || (group.sections.length === 1 && group.sections[0].storeLabel);

  const blocks = group.sections.map(s => buildSectionBlock(s, hasMultipleStores)).join('');

  return `
  <div class="page with-print-footer">
    ${pageHeader(clientName, period)}
    <div class="section-title">${group.title}</div>
    ${blocks}
  </div>`;
}

function buildSectionBlock(section, showStoreLabel) {
  const subHeading = showStoreLabel && section.storeLabel
    ? `<div class="store-sub">${section.storeLabel}</div>`
    : '';

  if (!section.data || section.unavailable) {
    return `
    ${subHeading}
    <div class="unavail">${section.errorMessage || 'Data unavailable — connector not configured or token expired.'}</div>`;
  }

  const metrics = section.metrics || [];
  const metricsHtml = metrics.length ? `
    <div class="metrics-row">
      ${metrics.map(m => `
        <div class="metric-cell">
          <div class="val">${m.value}</div>
          <div class="lbl">${m.label}</div>
          ${m.delta ? `<div class="delta ${m.deltaDirection || ''}">${m.deltaDirection === 'up' ? '↑' : m.deltaDirection === 'down' ? '↓' : ''} ${m.delta}</div>` : ''}
          ${m.previous ? `<div class="delta-prev">vs ${m.previous}</div>` : ''}
        </div>`).join('')}
    </div>` : '';

  const charts = section.charts || [];
  const chartsHtml = charts.map(c => buildChartHtml(c)).join('');

  const tables = section.tables || [];
  const tablesHtml = tables.map(t => buildTableHtml(t)).join('');

  return `
    ${subHeading}
    ${metricsHtml}
    ${chartsHtml}
    ${tablesHtml}`;
}

function escapeXml(str) {
  return String(str ?? '').replace(/[<>&'"]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

// Inline SVG horizontal bar chart — no external charting library. Sized to
// the page content width (about 460pt at A4 with 42pt side padding).
function buildChartHtml(chart) {
  if (chart.type !== 'hbar' || !chart.data?.length) return '';

  const total = chart.data.reduce((s, d) => s + (d.value || 0), 0);
  const max = Math.max(...chart.data.map(d => d.value || 0));
  if (max <= 0) return '';

  const width = 460;
  const rowHeight = 18;
  const labelWidth = 130;
  const valueWidth = 110;
  const barAreaWidth = width - labelWidth - valueWidth - 8;
  const height = chart.data.length * rowHeight + 8;

  const valueX = labelWidth + barAreaWidth + 6;
  const bars = chart.data.map((d, i) => {
    const y = i * rowHeight + 4;
    const bw = (d.value / max) * barAreaWidth;
    const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0.0';
    return `
      <text x="0" y="${y + 11}" font-size="8" fill="#1a1a1a">${escapeXml(d.label)}</text>
      <rect x="${labelWidth}" y="${y + 3}" width="${bw}" height="${rowHeight - 8}" fill="#E7CD41" />
      <text x="${valueX}" y="${y + 11}" font-size="8" fill="#1a1a1a">${d.value.toLocaleString()} (${pct}%)</text>
    `;
  }).join('');

  return `
    <div class="chart-block">
      <div class="sub-title">${escapeXml(chart.title)}</div>
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin meet">
        ${bars}
      </svg>
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
    <div class="page with-print-footer">
      ${pageHeader(clientName, period)}
      <div class="section-title">Organic Rankings</div>
      ${buildPositionDistributionHtml(rankings)}
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
    </div>`);
  }

  return parts.join('');
}

// Distribution of tracked keywords across SERP position buckets — the
// standard "Top 3 / 4-10 / 11-20 / 21-50 / 51-100" view rank-tracking
// platforms (SEMRush, Ahrefs) lead with.
function buildPositionDistributionHtml(rankings) {
  const buckets = [
    { label: 'Top 3', min: 1, max: 3 },
    { label: '4 — 10', min: 4, max: 10 },
    { label: '11 — 20', min: 11, max: 20 },
    { label: '21 — 50', min: 21, max: 50 },
    { label: '51 — 100', min: 51, max: 100 },
    { label: '100+', min: 101, max: Infinity },
  ];
  const counts = buckets.map(b => rankings.filter(k => {
    const p = parseInt(k.current_position);
    return p >= b.min && p <= b.max;
  }).length);

  return `
    <div class="sub-title">Positions in Search Results</div>
    <div class="pos-dist">
      ${buckets.map((b, i) => `
        <div class="pos-dist-cell">
          <div class="val">${counts[i]}</div>
          <div class="lbl">${b.label}</div>
        </div>`).join('')}
    </div>`;
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

  ${pageFooter()}
</div>

</body>
</html>`;
}

// Template-driven HTML builder. Sections flow on a continuous content area
// with `page-break-inside: avoid` on each block, so the printer packs as many
// sections per physical page as fit. The October header is rendered inline
// once at the top; puppeteer's footer template puts Page X of Y on every page.
function buildTemplateReportHtml({ client = {}, period = '', sections }) {
  const blocks = sections.map(renderResolvedSection).filter(Boolean).join('\n');
  const logo = getLogoDataUri();
  const headerHtml = `<div class="report-head">
    <div class="report-head-l">${logo ? `<img src="${logo}" style="height:36px;display:block;">` : ''}</div>
    <div class="report-head-r">
      <div class="report-head-title">Report for ${escapeXml(client.name || '')}</div>
      <div class="report-head-period">${escapeXml(period)}</div>
    </div>
  </div>`;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${getPageCSS()}</style>
</head>
<body>
<div class="report-content">
${headerHtml}
${blocks}
</div>
</body>
</html>`;
}

function renderResolvedSection(s) {
  const title = `<div class="section-title">${escapeXml(s.title || '')}</div>`;
  const insight = s.insight
    ? `<div class="section-insight">${escapeXml(s.insight)}</div>`
    : '';
  const open = `<div class="section">`;
  const close = `</div>`;

  switch (s.type) {
    case 'narrative': {
      const paragraphs = (s.text || '').split('\n').filter(p => p.trim()).map(p => `<p>${escapeXml(p)}</p>`).join('');
      return `${open}${title}${paragraphs}${close}`;
    }
    case 'metrics_grid': {
      if (s.layout === 'table' && s.rows?.length) {
        return `${open}${title}${insight}${buildMetricsTableHtml(s.metricLabels || [], s.rows)}${close}`;
      }
      const cells = s.cells || [];
      if (!cells.length) return '';
      // Chunk single-row grids at 4 cells per row; above that labels and
      // values cramp at A4 width.
      const PER_ROW = 4;
      const rows = [];
      for (let i = 0; i < cells.length; i += PER_ROW) rows.push(cells.slice(i, i + PER_ROW));
      const rowsHtml = rows.map(row => `<div class="metrics-row">${row.map(c => `<div class="metric-cell"><div class="val">${escapeXml(c.value)}</div><div class="lbl">${escapeXml(c.label)}</div></div>`).join('')}</div>`).join('');
      return `${open}${title}${insight}${rowsHtml}${close}`;
    }
    case 'tables': {
      if (!s.tables || !s.tables.length) return '';
      return `${open}${title}${insight}${s.tables.map(t => buildTableHtml(t)).join('')}${close}`;
    }
    case 'bar_chart': {
      if (!s.chart) return '';
      return `${open}${title}${insight}${buildChartHtml(s.chart)}${close}`;
    }
    case 'position_distribution': {
      const rankings = (s.rankings || []).filter(k => k.current_position);
      if (!rankings.length) return '';
      return `${open}${title}${insight}${buildPositionDistributionHtml(rankings)}${close}`;
    }
    case 'error':
      return `${open}${title}<div class="unavail">${escapeXml(s.message || 'Section failed to render.')}</div>${close}`;
    default:
      return '';
  }
}

// Multi-source list rendering: rows = stores / accounts, cols = metrics.
// Replaces the old "chunk 9 cells into rows of 4" approach which mixed
// stores across rows and made the breakdown unreadable.
function buildMetricsTableHtml(metricLabels, rows) {
  return `
    <table class="w-full metrics-table">
      <thead><tr><th></th>${metricLabels.map(l => `<th style="text-align:right;">${escapeXml(l)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr${i % 2 === 1 ? ' class="alt"' : ''}>
        <td style="font-weight:700;">${escapeXml(r.source)}</td>
        ${(r.values || []).map(v => `<td style="text-align:right;">${escapeXml(v)}</td>`).join('')}
      </tr>`).join('')}</tbody>
    </table>`;
}

module.exports = { generatePDF, buildMonthlyReportHtml, buildWeeklyReportHtml, buildTemplateReportHtml };
