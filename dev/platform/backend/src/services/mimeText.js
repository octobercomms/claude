// Readable text out of a raw RFC822 message.
//
// Why this exists. Both mail readers — the live poll (outreachReplies) and the
// backlog pass (replyCatchup) — used to take "the body" to be everything after
// the first blank line, strip HTML tags off it and collapse the whitespace.
// On a single-part plain-text mail that is roughly right. On anything else it
// is not, and almost nothing a journalist sends is single-part:
//
//   - A multipart message starts with its boundary line and the part's own
//     headers, so the "body" began "--000000000000092417065da49d69
//     Content-Type: text/plain; charset=UTF-8 ..." and that string was stored
//     in outreach_sends.reply_text as the journalist's words.
//   - A base64 part was never decoded, so the stored reply was a wall of
//     base64 and, worse, the opt-out keyword scan ran against that wall. A
//     "please remove me" typed into an Outlook message that happened to be
//     base64-encoded matched nothing and was never actioned. Subject-line
//     opt-outs still worked, which is why One-Click was caught and this was
//     not.
//   - A charset other than UTF-8 (gb2312 turned up in October's own mailbox)
//     was read as UTF-8 and came out as mojibake.
//
// So: walk the MIME tree properly, prefer the text/plain part, decode the
// transfer encoding and the charset, and only then reduce to text.
//
// Newlines survive on purpose. outreachReplies.replyBodyOnly drops quoted
// lines by looking for a leading ">" per line; against a body collapsed to one
// long line that filter could never match anything.

// ---------------------------------------------------------------------------
// Header parsing

/** Unfold continuation lines, so a folded Content-Type reads as one value. */
function unfold(headers) {
  return String(headers || '').replace(/\r?\n[ \t]+/g, ' ');
}

/** The last value for a header name, or ''. Case-insensitive. */
function headerValue(headers, name) {
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:[ \\t]*([^\\r\\n]*)$`, 'im');
  const m = re.exec(unfold(headers));
  return m ? m[1].trim() : '';
}

/** "multipart/alternative; boundary=abc" -> { type, params }. */
function parseContentType(value) {
  const s = String(value || '').trim();
  if (!s) return { type: 'text/plain', params: {} };
  const bits = s.split(';');
  const type = bits.shift().trim().toLowerCase();
  const params = {};
  for (const bit of bits) {
    const m = /^\s*([\w-]+)\s*=\s*(?:"([^"]*)"|([^;\s]*))/.exec(bit);
    if (m) params[m[1].toLowerCase()] = (m[2] !== undefined ? m[2] : m[3] || '').trim();
  }
  return { type: type || 'text/plain', params };
}

/**
 * Split a message or part into its header block and body.
 *
 * Operates on a latin1 string throughout: every byte maps to exactly one
 * character and back, so structural work (boundaries, headers — all ASCII) is
 * safe and the bytes survive intact for the decoder.
 */
function splitSection(section) {
  const text = String(section || '');
  const m = /\r?\n\r?\n/.exec(text);
  if (!m) return { headers: text, body: '' };
  return { headers: text.slice(0, m.index), body: text.slice(m.index + m[0].length) };
}

// ---------------------------------------------------------------------------
// Transfer encodings

function decodeQuotedPrintable(text) {
  const joined = String(text || '').replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < joined.length; i += 1) {
    if (joined[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(joined.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function decodeBase64(text) {
  // Mail folds base64 across lines and some senders pad it oddly; keep only
  // the alphabet and let Buffer deal with the length.
  return Buffer.from(String(text || '').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
}

// us-ascii and iso-8859-1 decode as windows-1252 on purpose, which is what
// the HTML5 spec requires of browsers and for the same reason: Outlook and
// Word emit curly quotes, en dashes and ellipses as windows-1252 bytes in the
// 0x80-0x9F range while labelling the part us-ascii. Decoded as UTF-8 those
// bytes are invalid and become U+FFFD, so "Harper's Bazaar" reached the review
// screen as "Harper<?>s Bazaar". windows-1252 is a strict superset of ASCII
// for the printable range, and 0x80-0x9F in iso-8859-1 are C1 control
// characters that no mail body legitimately contains, so nothing correct is
// lost by reading them this way.
const CHARSET_ALIASES = {
  'us-ascii': 'windows-1252',
  ascii: 'windows-1252',
  'ansi_x3.4-1968': 'windows-1252',
  'iso-8859-1': 'windows-1252',
  'iso8859-1': 'windows-1252',
  latin1: 'windows-1252',
  utf8: 'utf-8',
  'unicode-1-1-utf-8': 'utf-8',
  'cp-1252': 'windows-1252',
  cp1252: 'windows-1252',
};

/**
 * Bytes to a string in the part's declared charset.
 *
 * Node ships full ICU, so TextDecoder handles gb2312, Shift_JIS, KOI8-R and
 * the rest. An unknown or missing charset falls back to UTF-8, which is both
 * the modern default and a superset of ASCII, so plain English is never harmed
 * by a wrong declaration.
 */
function decodeCharset(buf, charset) {
  const raw = String(charset || '').trim().toLowerCase().replace(/^["']|["']$/g, '');
  const name = CHARSET_ALIASES[raw] || raw || 'utf-8';
  try {
    return new TextDecoder(name, { fatal: false }).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

function decodeContent(body, transferEncoding, charset) {
  const enc = String(transferEncoding || '').trim().toLowerCase().split(';')[0];
  let buf;
  if (enc === 'base64') buf = decodeBase64(body);
  else if (enc === 'quoted-printable') buf = decodeQuotedPrintable(body);
  else buf = Buffer.from(String(body || ''), 'latin1');
  return decodeCharset(buf, charset);
}

// ---------------------------------------------------------------------------
// Reduction to text

/** Tidy plain text without destroying its line structure. */
function tidy(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const ENTITIES = {
  nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
  '#34': '"', '#39': "'", '#160': ' ', '#8217': '’', '#8216': '‘',
  '#8220': '“', '#8221': '”', '#8211': '–', '#8212': '—',
};

/** HTML to text, keeping the breaks that carry meaning. */
function htmlToText(html) {
  return String(html || '')
    .replace(/<(?:style|script)\b[^>]*>[\s\S]*?<\/(?:style|script)>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([a-z]+|#\d+);/gi, (whole, name) => {
      const hit = ENTITIES[String(name).toLowerCase()];
      return hit !== undefined ? hit : whole;
    })
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    })
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// The MIME walk

/** Cut a multipart body into its parts, dropping preamble and epilogue. */
function splitOnBoundary(body, boundary) {
  const start = `--${boundary}`;
  const end = `--${boundary}--`;
  const parts = [];
  let current = null;
  for (const line of String(body || '').split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (trimmed === end) break;
    if (trimmed === start) {
      if (current) parts.push(current.join('\n'));
      current = [];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) parts.push(current.join('\n'));
  return parts;
}

const MAX_DEPTH = 8;

function sectionText(section, depth) {
  if (depth > MAX_DEPTH) return '';
  const { headers, body } = splitSection(section);
  const unfolded = unfold(headers);

  // An attachment is never the message. A PDF press kit decoded to text would
  // bury the two lines the journalist typed.
  if (/^\s*attachment\b/i.test(headerValue(unfolded, 'content-disposition'))) return '';

  const ct = parseContentType(headerValue(unfolded, 'content-type'));

  if (ct.type.startsWith('multipart/') && ct.params.boundary) {
    const parts = splitOnBoundary(body, ct.params.boundary);
    if (ct.type === 'multipart/alternative') {
      // The same message twice over. Take the plain copy; it is what the
      // sender typed, without the client's markup around it.
      for (const want of ['text/plain', 'text/html']) {
        for (const part of parts) {
          const partCt = parseContentType(headerValue(splitSection(part).headers, 'content-type'));
          if (partCt.type !== want) continue;
          const text = sectionText(part, depth + 1);
          if (text) return text;
        }
      }
      for (const part of parts) {
        const text = sectionText(part, depth + 1);
        if (text) return text;
      }
      return '';
    }
    // mixed / related / signed / report: the first part that yields text is
    // the message; the rest are attachments, images and signatures.
    for (const part of parts) {
      const text = sectionText(part, depth + 1);
      if (text) return text;
    }
    return '';
  }

  if (ct.type.startsWith('message/')) return sectionText(body, depth + 1);

  if (ct.type === 'text/html') {
    return htmlToText(decodeContent(body, headerValue(unfolded, 'content-transfer-encoding'), ct.params.charset));
  }
  if (ct.type === 'text/plain' || ct.type.startsWith('text/')) {
    return tidy(decodeContent(body, headerValue(unfolded, 'content-transfer-encoding'), ct.params.charset));
  }
  return '';
}

/**
 * The readable text of a whole RFC822 message.
 *
 * Accepts the Buffer imapflow hands back (preferred — the bytes are still
 * intact) or a string. A string is taken to be UTF-8, which is what every
 * caller that holds one decoded it as.
 */
function bodyText(source) {
  const latin1 = Buffer.isBuffer(source)
    ? source.toString('latin1')
    : Buffer.from(String(source || ''), 'utf8').toString('latin1');
  if (!latin1) return '';
  const text = sectionText(latin1, 0);
  if (text) return text;
  // Nothing claimed to be text. Fall back to the raw body rather than return
  // nothing: a malformed message is still better read than dropped.
  return tidy(splitSection(latin1).body.replace(/<[^>]+>/g, ' '));
}

module.exports = {
  bodyText,
  htmlToText,
  tidy,
  headerValue,
  parseContentType,
  splitSection,
  splitOnBoundary,
  decodeContent,
  decodeQuotedPrintable,
  decodeBase64,
  decodeCharset,
};
