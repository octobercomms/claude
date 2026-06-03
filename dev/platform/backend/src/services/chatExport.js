// Export an AI Data Analyst chat message as a downloadable PDF or
// DOCX, styled to match the templated weekly/monthly reports.
//
//   markdown ─marked─► HTML ─puppeteer─► PDF
//                          └─html-to-docx─► DOCX
//
// Both render the same branded HTML — October masthead with logo,
// "Report for <client>" title block, the same Brockmann typography
// and 12pt/9pt body/table sizes that the scheduled reports use.
// Streaming output only — nothing persisted to disk.

const { marked } = require('marked');
const htmlToDocx = require('html-to-docx');
const pdfService = require('./pdfService');

marked.setOptions({ gfm: true, breaks: false });

function escapeHtml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Self-contained branded HTML doc — same shell as
// pdfService.buildTemplateReportHtml so PDF and DOCX exports inherit
// the platform's masthead + typography. The body is the marked-
// rendered markdown from the assistant's reply.
function buildBrandedHtml({ title, clientName, body, generatedAt }) {
  const dateStr = (generatedAt || new Date()).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const logo = pdfService.getLogoDataUri();
  const headerHtml = `<div class="report-head">
    <div class="report-head-l">${logo ? `<img src="${logo}" style="height:36px;display:block;">` : ''}</div>
    <div class="report-head-r">
      <div class="report-head-title">${escapeHtml(title || 'AI Data Analyst Report')}</div>
      <div class="report-head-period">${escapeHtml(clientName || '')} · ${escapeHtml(dateStr)}</div>
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

async function markdownToPdfBuffer(markdown, opts = {}) {
  const body = marked.parse(markdown || '');
  const html = buildBrandedHtml({ ...opts, body });
  return pdfService.generatePDFBuffer(html);
}

async function markdownToDocxBuffer(markdown, opts = {}) {
  const body = marked.parse(markdown || '');
  const html = buildBrandedHtml({ ...opts, body });
  // html-to-docx returns Buffer in Node when invoked without browser
  // globals, BUT some versions return ArrayBuffer that Express then
  // serialises wrongly — Word opens the result as corrupt. Wrap
  // defensively: if we get something that isn't a Buffer already,
  // copy the bytes into one.
  const out = await htmlToDocx(html, null, {
    orientation: 'portrait',
    margins: { top: 1100, right: 1100, bottom: 1300, left: 1100 },
    pageNumber: false,
    table: { row: { cantSplit: true } },
  });
  if (Buffer.isBuffer(out)) return out;
  if (out instanceof ArrayBuffer) return Buffer.from(out);
  if (out && typeof out.arrayBuffer === 'function') return Buffer.from(await out.arrayBuffer());
  if (out && out.byteLength != null) return Buffer.from(out);
  throw new Error('html-to-docx returned unexpected type: ' + (out && out.constructor?.name));
}

module.exports = { markdownToPdfBuffer, markdownToDocxBuffer };
