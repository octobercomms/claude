// Export an AI Data Analyst chat message as a downloadable PDF or
// DOCX. The assistant already returns markdown (headings, GFM tables,
// lists, code blocks, blockquotes, etc.), so the conversion is:
//
//   markdown ─marked─► HTML ─puppeteer─► PDF
//                          └─html-to-docx─► DOCX
//
// PDF reuses the same puppeteer + footer config as the scheduled
// reports, just without the multi-section masthead. DOCX is produced
// in-memory and streamed back — no disk persistence.

const { marked } = require('marked');
const htmlToDocx = require('html-to-docx');
const pdfService = require('./pdfService');

marked.setOptions({ gfm: true, breaks: false });

function escapeHtml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Wrap the rendered markdown in a self-contained HTML doc with a
// branded masthead, period/title line, and the same body typography as
// the scheduled reports. Used as input for both puppeteer (PDF) and
// html-to-docx (DOCX).
function buildExportHtml({ title, clientName, body, generatedAt }) {
  const dateStr = (generatedAt || new Date()).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 18mm 18mm 22mm 18mm; }
  body { font-family: Arial, sans-serif; color: #111; font-size: 11pt; line-height: 1.5; margin: 0; }
  .masthead { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1pt solid #000; padding-bottom: 8pt; margin-bottom: 16pt; }
  .masthead .logo { font-size: 14pt; font-weight: 700; letter-spacing: 0.5px; }
  .masthead .logo .sub { font-size: 7pt; font-weight: 400; color: #808080; text-transform: uppercase; letter-spacing: 2px; display: block; margin-top: 2pt; }
  .masthead .meta { text-align: right; }
  .masthead .meta .title { font-size: 14pt; font-weight: 700; }
  .masthead .meta .when { font-size: 9pt; color: #808080; margin-top: 2pt; }
  h1 { font-size: 16pt; margin: 18pt 0 8pt; }
  h2 { font-size: 13pt; margin: 14pt 0 6pt; }
  h3 { font-size: 11pt; margin: 12pt 0 4pt; }
  p { margin: 6pt 0; }
  ul, ol { margin: 6pt 0; padding-left: 20pt; }
  li { margin: 2pt 0; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 10pt; }
  th { background: #f3f3f3; padding: 5pt 8pt; border: 0.5pt solid #ccc; text-align: left; font-weight: 700; }
  td { padding: 5pt 8pt; border: 0.5pt solid #eee; vertical-align: top; }
  code { background: #f6f6f6; padding: 1px 5px; border-radius: 3px; font-family: monospace; font-size: 10pt; }
  pre { background: #f6f6f6; padding: 10pt; border-radius: 4px; overflow: auto; font-family: monospace; font-size: 10pt; }
  blockquote { border-left: 3pt solid #E7CD41; padding: 2pt 10pt; margin: 6pt 0; color: #555; font-style: italic; }
  hr { border: none; border-top: 1pt solid #eee; margin: 10pt 0; }
  a { color: #1a56db; text-decoration: underline; }
</style></head>
<body>
  <div class="masthead">
    <div class="logo">OCTOBER<span class="sub">Communications</span></div>
    <div class="meta">
      <div class="title">${escapeHtml(title || 'AI Data Analyst — Report')}</div>
      <div class="when">${escapeHtml(clientName ? `${clientName} · ` : '')}${escapeHtml(dateStr)}</div>
    </div>
  </div>
  ${body}
</body></html>`;
}

async function markdownToPdfBuffer(markdown, opts = {}) {
  const body = marked.parse(markdown || '');
  const html = buildExportHtml({ ...opts, body });
  return pdfService.generatePDFBuffer(html);
}

async function markdownToDocxBuffer(markdown, opts = {}) {
  const body = marked.parse(markdown || '');
  const html = buildExportHtml({ ...opts, body });
  // html-to-docx accepts a UA-style HTML string and returns a Buffer.
  // orientation/margins below mirror the PDF page setup.
  return htmlToDocx(html, null, {
    margins: { top: 1100, right: 1100, bottom: 1300, left: 1100 },
    pageNumber: false,
    table: { row: { cantSplit: true } },
  });
}

module.exports = { markdownToPdfBuffer, markdownToDocxBuffer };
