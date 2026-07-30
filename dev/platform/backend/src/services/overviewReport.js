// Shared branding + render shell for the pillar "Overview" PDFs (Owned, Earned,
// Paid). Each pillar has its own reportData + section builders; they all render
// through renderShell() here so the masthead, footer, fonts (Brockmann), October
// logo, colours and base CSS stay identical to the AI Visibility report.

const pool = require('../db');
const pdfService = require('./pdfService');
const { buildFontCSS, getLogoDataUri } = require('./pdfService');
const claudeService = require('./claude');

const ACCENT = '#e7cd41';
const GREEN = '#1e8449';
const AMBER = '#c77f0a';
const RED = '#c0392b';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return ''; }
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function fmtInt(v) { return num(v).toLocaleString('en-GB'); }
function gbp(v) { return `£${Math.round(num(v)).toLocaleString('en-GB')}`; }
function pct(v) { return `${Math.round(num(v))}%`; }

// A KPI card. colour is optional (applied to the big number).
function metric(label, value, colour, sub) {
  return `<div class="metric">
    <div class="metric-value"${colour ? ` style="color:${colour}"` : ''}>${esc(value)}</div>
    <div class="metric-label">${esc(label)}</div>
    ${sub ? `<div class="metric-sub">${esc(sub)}</div>` : ''}
  </div>`;
}

// A simple horizontal bar row (label · value · proportional bar).
function barRow(label, value, maxValue, colour = ACCENT) {
  const w = maxValue > 0 ? Math.max(2, Math.round((num(value) / maxValue) * 100)) : 0;
  return `<div class="bar">
    <div class="bar-label">${esc(label)}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${colour}"></div></div>
    <div class="bar-val">${esc(value)}</div>
  </div>`;
}

// Wrap arbitrary section HTML in the branded page shell. `wordmark` is the
// small uppercase pillar label top-right; `metaBits` is an array of subtitle
// fragments joined with · under the H1.
function renderShell({ client, wordmark, title, metaBits = [], aiSummary = null, bodyHtml = '' }) {
  const logo = getLogoDataUri();
  const sub = metaBits.filter(Boolean).map(esc).join(' · ');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    ${buildFontCSS()}
    * { box-sizing: border-box; }
    body { font-family: 'Brockmann', Arial, sans-serif; color: #111; margin: 0; padding: 0; font-size: 10.5pt; line-height: 1.45; }
    .page { padding: 18mm 15mm; }
    .masthead { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 22px; }
    .masthead .wordmark { font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #111; }
    h1 { font-size: 26pt; font-weight: 700; margin: 0 0 2px; letter-spacing: -0.5px; }
    .sub { color: #555; font-size: 11pt; margin-bottom: 22px; }
    .metrics { display: flex; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
    .metric { flex: 1; min-width: 90px; border: 1.5px solid #e5e5e5; border-radius: 10px; padding: 14px 12px; text-align: center; }
    .metric-value { font-size: 22pt; font-weight: 700; letter-spacing: -1px; }
    .metric-label { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.6px; color: #777; margin-top: 4px; }
    .metric-sub { font-size: 8pt; color: #999; margin-top: 3px; }
    .note { color: #555; font-size: 10pt; margin: 14px 0 22px; }
    .summary { background: #faf6df; border-left: 4px solid ${ACCENT}; border-radius: 8px; padding: 14px 16px; margin: 16px 0 6px; font-size: 11pt; line-height: 1.5; }
    .summary .lbl { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.6px; color: #9a8a2a; font-weight: 700; display: block; margin-bottom: 5px; }
    h2.sec { font-size: 13pt; font-weight: 700; margin: 26px 0 10px; }
    h2.sec .src { font-size: 8.5pt; font-weight: 400; color: #999; text-transform: none; letter-spacing: 0; margin-left: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    th { text-align: left; text-transform: uppercase; letter-spacing: 0.5px; font-size: 7.5pt; color: #888; border-bottom: 1.5px solid #e5e5e5; padding: 5px 8px; }
    td { border-bottom: 1px solid #f0f0f0; padding: 6px 8px; vertical-align: top; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; width: 78px; }
    td.rank { width: 28px; color: #888; font-weight: 700; }
    td.q { width: 44%; }
    .chip { color: #fff; font-size: 7.5pt; font-weight: 700; border-radius: 12px; padding: 2px 8px; white-space: nowrap; }
    .group { page-break-inside: avoid; margin-bottom: 20px; }
    .two { display: flex; gap: 18px; }
    .two > div { flex: 1; min-width: 0; }
    .bar { display: flex; align-items: center; gap: 10px; margin: 5px 0; font-size: 9.5pt; }
    .bar-label { width: 150px; color: #333; }
    .bar-track { flex: 1; height: 12px; background: #f0f0f0; border-radius: 6px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 6px; }
    .bar-val { width: 60px; text-align: right; font-variant-numeric: tabular-nums; color: #333; }
    .footer { margin-top: 26px; border-top: 1px solid #e5e5e5; padding-top: 10px; font-size: 8.5pt; color: #999; display: flex; justify-content: space-between; }
    .empty { color: #888; padding: 10px 0; }
  </style></head><body><div class="page">
    <div class="masthead">
      <div>${logo ? `<img src="${logo}" height="34" alt="October">` : '<div class="wordmark">October</div>'}</div>
      <div class="wordmark">${esc(wordmark)}</div>
    </div>
    <h1>${esc(title)}</h1>
    <div class="sub">${sub}</div>
    ${aiSummary ? `<div class="summary"><span class="lbl">Summary</span>${esc(aiSummary)}</div>` : ''}
    ${bodyHtml}
    <div class="footer">
      <span>Prepared by October Communications</span>
      <span>octobercomms.com</span>
    </div>
  </div></body></html>`;
}

// Shared route handler for a pillar's Overview report.pdf. `report` is one of the
// pillar report modules (ownedOverviewReport, earnedOverviewReport, …) exposing
// reportData / buildSummaryPrompt / buildHtml. Handles client lookup, the
// best-effort Claude summary, PDF render and the download headers.
async function sendReport(res, { clientId, report, days = 30, slugPrefix, feature, emptyMsg }) {
  const { rows } = await pool.query('SELECT id, name, domain FROM clients WHERE id = $1', [clientId]);
  const client = rows[0];
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const data = await report.reportData(clientId, { days });
  if (data.has_data === false) {
    return res.status(400).json({ error: emptyMsg || 'Nothing to report for this section yet — add some data first, then export.' });
  }

  // Best-effort consultant summary; the report renders fine without it.
  let aiSummary = null;
  try {
    const p = report.buildSummaryPrompt({ client, data });
    aiSummary = await claudeService.callClaude({ max_tokens: 400, system: p.system, user: p.user, feature, clientId });
  } catch (e) { console.error(`[${feature}] summary failed:`, e.message); }

  const html = report.buildHtml({ client, data, aiSummary });
  const pdf = await pdfService.generatePDFBuffer(html);
  const slug = String(client.name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'client';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${slugPrefix}-${slug}.pdf"`);
  res.send(pdf);
}

module.exports = {
  ACCENT, GREEN, AMBER, RED,
  esc, fmtDate, num, fmtInt, gbp, pct, metric, barRow, renderShell, sendReport,
};
