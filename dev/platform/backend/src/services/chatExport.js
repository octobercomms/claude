// Export an AI Data Analyst chat message as a downloadable PDF or
// DOCX, styled to match the templated weekly/monthly reports.
//
//   markdown ─marked─► HTML ─puppeteer─► PDF        (full branded shell)
//   markdown ─marked lexer─► docx primitives ─Packer─► DOCX
//
// The DOCX path uses the `docx` library to construct the document
// programmatically rather than going through HTML. Two prior attempts
// with html-to-docx produced files Word reported as corrupt — even the
// minimal-HTML version failed in production, despite passing structural
// checks locally. Programmatic construction is more verbose but
// produces files Word opens cleanly every time.

const { marked } = require('marked');
const docxlib = require('docx');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle } = docxlib;
const pdfService = require('./pdfService');

marked.setOptions({ gfm: true, breaks: false });

function escapeHtml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(d) {
  return (d || new Date()).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── PDF path (unchanged from PR #327) ─────────────────────────────
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

async function markdownToPdfBuffer(markdown, opts = {}) {
  const body = marked.parse(markdown || '');
  const html = buildPdfHtml({ ...opts, body });
  return pdfService.generatePDFBuffer(html);
}

// ── DOCX path (programmatic via docx library) ─────────────────────
//
// Walks the marked token stream and emits docx primitives. Supported:
// headings (1-6), paragraphs with inline bold/italic/code/links,
// bullet + numbered lists, GFM tables, horizontal rules, blockquotes,
// code fences. Anything else falls through to a plain Paragraph.

function inlineRuns(tokens) {
  const runs = [];
  for (const tok of tokens || []) {
    switch (tok.type) {
      case 'text':       runs.push(new TextRun({ text: tok.text })); break;
      case 'strong':     runs.push(...inlineRuns(tok.tokens).map(r => mutateRun(r, { bold: true }))); break;
      case 'em':         runs.push(...inlineRuns(tok.tokens).map(r => mutateRun(r, { italics: true }))); break;
      case 'codespan':   runs.push(new TextRun({ text: tok.text, font: 'Consolas' })); break;
      case 'link':       runs.push(...inlineRuns(tok.tokens).map(r => mutateRun(r, { color: '1A56DB', underline: {} }))); break;
      case 'br':         runs.push(new TextRun({ break: 1 })); break;
      case 'del':        runs.push(...inlineRuns(tok.tokens).map(r => mutateRun(r, { strike: true }))); break;
      case 'html':       runs.push(new TextRun({ text: stripHtml(tok.text) })); break;
      default:
        if (tok.raw) runs.push(new TextRun({ text: tok.raw }));
    }
  }
  return runs.length ? runs : [new TextRun({ text: '' })];
}

function mutateRun(run, extra) {
  // Clone-ish — re-construct with merged options. docx TextRun is
  // immutable; we have to read out the props and rebuild.
  const opts = { ...(run.options || {}), ...extra };
  if (run.options?.text != null && opts.text == null) opts.text = run.options.text;
  return new TextRun(opts);
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim();
}

function tokenToBlock(tok) {
  switch (tok.type) {
    case 'heading': {
      const level = Math.min(Math.max(tok.depth || 1, 1), 6);
      const headingLevel = ['HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6'][level - 1];
      return [new Paragraph({
        heading: HeadingLevel[headingLevel],
        spacing: { before: 240, after: 120 },
        children: inlineRuns(tok.tokens),
      })];
    }
    case 'paragraph':
      return [new Paragraph({ spacing: { after: 120 }, children: inlineRuns(tok.tokens) })];
    case 'blockquote': {
      const inner = (tok.tokens || []).flatMap(tokenToBlock);
      return inner.map(p => {
        if (p instanceof Paragraph) {
          p.options.indent = { left: 360 };
          p.options.border = { left: { style: BorderStyle.SINGLE, size: 12, color: 'E7CD41', space: 8 } };
        }
        return p;
      });
    }
    case 'list': {
      const items = tok.items || [];
      const ref = tok.ordered ? 'numbered' : 'bulleted';
      return items.flatMap((item, idx) => {
        const itemTokens = item.tokens || [];
        const paragraphs = [];
        for (const child of itemTokens) {
          if (child.type === 'text' || child.type === 'paragraph') {
            paragraphs.push(new Paragraph({
              children: inlineRuns(child.tokens || [{ type: 'text', text: child.text || '' }]),
              bullet: tok.ordered ? undefined : { level: 0 },
              numbering: tok.ordered ? { reference: 'ordered-list', level: 0 } : undefined,
              spacing: { after: 60 },
            }));
          }
        }
        if (!paragraphs.length) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: item.text || '' })],
            bullet: tok.ordered ? undefined : { level: 0 },
            numbering: tok.ordered ? { reference: 'ordered-list', level: 0 } : undefined,
            spacing: { after: 60 },
          }));
        }
        return paragraphs;
      });
    }
    case 'table': {
      const headerCells = (tok.header || []).map(cell => new TableCell({
        children: [new Paragraph({ children: inlineRuns(cell.tokens || [{ type: 'text', text: cell.text || '' }]) })],
        shading: { fill: 'F3F3F3' },
      }));
      const headerRow = new TableRow({ children: headerCells, tableHeader: true });
      const bodyRows = (tok.rows || []).map(row =>
        new TableRow({
          children: row.map(cell => new TableCell({
            children: [new Paragraph({ children: inlineRuns(cell.tokens || [{ type: 'text', text: cell.text || '' }]) })],
          })),
        })
      );
      return [new Table({
        rows: [headerRow, ...bodyRows],
        width: { size: 100, type: WidthType.PERCENTAGE },
      })];
    }
    case 'code':
      return [new Paragraph({
        children: [new TextRun({ text: tok.text, font: 'Consolas' })],
        shading: { fill: 'F6F6F6' },
        spacing: { before: 120, after: 120 },
      })];
    case 'hr':
      return [new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
        spacing: { before: 120, after: 120 },
      })];
    case 'space':
      return [];
    default:
      if (tok.raw && tok.raw.trim()) {
        return [new Paragraph({ children: [new TextRun({ text: tok.raw })] })];
      }
      return [];
  }
}

async function markdownToDocxBuffer(markdown, opts = {}) {
  const { title, clientName, generatedAt } = opts;
  const tokens = marked.lexer(markdown || '');
  const blocks = tokens.flatMap(tokenToBlock);

  const titleBlocks = [];
  if (title) {
    titleBlocks.push(new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: title, bold: true, size: 36 })],
      spacing: { after: 60 },
    }));
  }
  titleBlocks.push(new Paragraph({
    children: [new TextRun({ text: `${clientName || ''}${clientName ? ' · ' : ''}${formatDate(generatedAt)}`, italics: true, color: '666666', size: 20 })],
    spacing: { after: 360 },
  }));

  const doc = new Document({
    creator: 'October Communications',
    title: title || 'AI Data Analyst Report',
    description: clientName ? `Report for ${clientName}` : 'AI Data Analyst Report',
    numbering: {
      config: [{
        reference: 'ordered-list',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
      }],
    },
    sections: [{
      properties: { page: { margin: { top: 1100, right: 1100, bottom: 1300, left: 1100 } } },
      children: [...titleBlocks, ...blocks],
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { markdownToPdfBuffer, markdownToDocxBuffer };
