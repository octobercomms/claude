// Extract file attachments from a raw RFC822 message.
//
// Sibling to mimeText.js, which walks the same MIME tree but collects body
// text. This module collects PDF and image parts instead, returning them as
// Buffers ready to attach to a Xero transaction or file into Google Drive.

const {
  headerValue, parseContentType, splitSection, splitOnBoundary,
  decodeBase64, decodeQuotedPrintable,
} = require('./mimeText');

const INVOICE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
]);

const MAX_DEPTH = 8;

function unfold(headers) {
  return String(headers || '').replace(/\r?\n[ \t]+/g, ' ');
}

function extractFilename(headers) {
  const unfolded = unfold(headers);

  const disp = headerValue(unfolded, 'content-disposition');
  const dispMatch = /filename\*?=\s*(?:"([^"]+)"|([^\s;]+))/i.exec(disp);
  if (dispMatch) return (dispMatch[1] || dispMatch[2] || '').trim();

  const ct = headerValue(unfolded, 'content-type');
  const nameMatch = /name\s*=\s*(?:"([^"]+)"|([^\s;]+))/i.exec(ct);
  if (nameMatch) return (nameMatch[1] || nameMatch[2] || '').trim();

  return null;
}

function decodeBody(body, transferEncoding) {
  const enc = String(transferEncoding || '').trim().toLowerCase().split(';')[0];
  if (enc === 'base64') return decodeBase64(body);
  if (enc === 'quoted-printable') return decodeQuotedPrintable(body);
  return Buffer.from(String(body || ''), 'latin1');
}

function collectAttachments(section, depth, results) {
  if (depth > MAX_DEPTH) return;
  const { headers, body } = splitSection(section);
  const unfolded = unfold(headers);
  const ct = parseContentType(headerValue(unfolded, 'content-type'));

  if (ct.type.startsWith('multipart/') && ct.params.boundary) {
    const parts = splitOnBoundary(body, ct.params.boundary);
    for (const part of parts) {
      collectAttachments(part, depth + 1, results);
    }
    return;
  }

  if (ct.type.startsWith('message/')) {
    collectAttachments(body, depth + 1, results);
    return;
  }

  if (!INVOICE_MIME_TYPES.has(ct.type)) return;

  const disposition = headerValue(unfolded, 'content-disposition');
  const isAttachment = /^\s*attachment\b/i.test(disposition);
  const isInlineWithName = /^\s*inline\b/i.test(disposition) && extractFilename(headers);
  const hasFilename = !!extractFilename(headers);

  if (!isAttachment && !isInlineWithName && !hasFilename) return;

  const filename = extractFilename(headers) || `attachment.${ct.type.split('/')[1] || 'bin'}`;
  const data = decodeBody(body, headerValue(unfolded, 'content-transfer-encoding'));

  if (data.length === 0) return;

  results.push({ filename, contentType: ct.type, data });
}

function extractAttachments(source) {
  const latin1 = Buffer.isBuffer(source)
    ? source.toString('latin1')
    : Buffer.from(String(source || ''), 'utf8').toString('latin1');
  if (!latin1) return [];
  const results = [];
  collectAttachments(latin1, 0, results);
  return results;
}

module.exports = { extractAttachments };
