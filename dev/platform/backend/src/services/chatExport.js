// Export an AI Data Analyst chat message as a downloadable PDF or
// DOCX, styled to match the templated weekly/monthly reports.
//
//   markdown ─marked─► HTML ─puppeteer─► PDF        (full branded shell)
//                          └─html-to-docx─► DOCX    (minimal inline-styled HTML)
//
// PDF and DOCX use DIFFERENT HTML on purpose. Puppeteer renders the
// scheduled-report shell perfectly — full CSS, masthead with logo,
// Brockmann font. html-to-docx is much more limited: it strips
// <style> blocks, can't handle data-URI <img> sources, and its
// underlying XML writer corrupts the .docx if you feed it complex
// layout. So DOCX gets a stripped-down HTML — title block as plain
// paragraphs, basic inline styles only — that html-to-docx can
// reliably serialise into a doc that Word will actually open.
// Streaming output only — nothing persisted to disk.

const { marked } = require('marked');
const htmlToDocx = require('html-to-docx');
const pdfService = require('./pdfService');

marked.setOptions({ gfm: true, breaks: false });

function escapeHtml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(d) {
  return (d || new Date()).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Full branded HTML for the PDF path — reuses the scheduled reports'
// CSS + masthead so the output is visually identical to a templated
// weekly/monthly report (logo top-left, title + client + date top-
// right, Brockmann typography, 12pt body / 9pt tables).
function buildPdfHtml({ title, clientName, body, generatedAt }) {
  const logo = pdfService.getLogoDataUri();
  const headerHtml = `<div class="report-head">
    <div class="report-head-l">${logo ? `<img src="${logo}" style="height:36px;display:block;">` : ''}</div>
    <div class="report-head-r">
      <div class="report-head-title">${escapeHtml(title || 'AI Data Analyst Report')}</div>
      <div class="report-head-period">${escapeHtml(clientName || '')} · ${escapeHtml(formatDate(generatedAt))}</div>
    </div>
  </div>`;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${pdfService.getPageCSS()}</style>
</head>
<body>
<div class="page">
<div class="report-content">
${headerHtml}
${body}
</div>
</div>
</body>
</html>`;
}

// Minimal HTML for the DOCX path. html-to-docx requires inline styles,
// no <style> block, no data URIs in <img>. Anything more elaborate
// produces a .docx that Word reports as corrupt (the user hit this
// twice with the report-shell version). Keep this dumb on purpose.
function buildDocxHtml({ title, clientName, body, generatedAt }) {
  const titleLine = title ? `<h1 style="font-size:18pt;font-weight:bold;margin:0 0 4pt;color:#000;">${escapeHtml(title)}</h1>` : '';
  const metaLine = `<p style="font-size:10pt;color:#666;margin:0 0 18pt;font-style:italic;">${escapeHtml(clientName || '')}${clientName ? ' · ' : ''}${escapeHtml(formatDate(generatedAt))}</p>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;font-size:11pt;color:#111;">${titleLine}${metaLine}${body}</body></html>`;
}

async function markdownToPdfBuffer(markdown, opts = {}) {
  const body = marked.parse(markdown || '');
  const html = buildPdfHtml({ ...opts, body });
  return pdfService.generatePDFBuffer(html);
}

async function markdownToDocxBuffer(markdown, opts = {}) {
  const body = marked.parse(markdown || '');
  const html = buildDocxHtml({ ...opts, body });
  const out = await htmlToDocx(html, null, {
    orientation: 'portrait',
    margins: { top: 1100, right: 1100, bottom: 1300, left: 1100 },
    pageNumber: false,
    table: { row: { cantSplit: true } },
  });
  // Defensive output handling — see PR #327. Some versions of
  // html-to-docx return ArrayBuffer / Blob instead of Buffer; coerce
  // explicitly so Express's res.send writes raw bytes.
  if (Buffer.isBuffer(out)) return out;
  if (out instanceof ArrayBuffer) return Buffer.from(out);
  if (out && typeof out.arrayBuffer === 'function') return Buffer.from(await out.arrayBuffer());
  if (out && out.byteLength != null) return Buffer.from(out);
  throw new Error('html-to-docx returned unexpected type: ' + (out && out.constructor?.name));
}

module.exports = { markdownToPdfBuffer, markdownToDocxBuffer };
