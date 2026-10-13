// Importing a MailFlow "contact updates" CSV export.
//
// The stopgap door, and the one that proves the pipeline: MailFlow exports what
// it read out of the auto-replies, and this turns those rows into review-queue
// suggestions. The automatic IMAP feed (services/outreachReplies.js) produces
// the same shape without the export step; both derive their ids the same way
// (services/oooExtract.js suggestionId), so a file uploaded after the poll has
// already seen those replies updates the existing rows rather than duplicating.
//
// Expected header, as MailFlow writes it:
//   name,email,company,role,change_type,source_sender,source_subject,
//   source_date,confidence,quote

const extract = require('./oooExtract');
const ooo = require('./oooSuggestions');

const REQUIRED = ['email', 'change_type', 'source_sender', 'source_date'];

// RFC 4180 enough for the real file: quoted fields, doubled quotes inside them,
// CRLF or LF. A BOM on the first header cell is stripped, because the export
// has one and without this every lookup of `name` silently misses.
function parseCsv(text) {
  const t = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function toObjects(rows) {
  if (!rows.length) return { header: [], items: [] };
  const header = rows[0].map((h) => String(h || '').trim().toLowerCase());
  const items = rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
  return { header, items };
}

// "moved / new address" means the sender themselves has gone; anything else is
// a stand-in they named. Unknown values are treated as the latter, which is the
// safer reading: it proposes adding someone rather than editing a live record.
function isMove(changeType) {
  return /\bmoved\b|\bnew address\b|\bleft\b|\bchanged\b/i.test(String(changeType || ''));
}

/**
 * Turn the parsed rows into suggestions, grouped by the reply they came from.
 *
 * One auto-reply can carry both kinds at once — Anna Highfield's reply says she
 * has left the Architects' Journal AND names Richard Waite as the news editor.
 * Those become two suggestions against the same source so the employer change
 * can be approved separately from adding the stand-in; merging them would force
 * one decision on two unrelated facts.
 */
function buildSuggestions(items, opts = {}) {
  const staleMonths = opts.staleMonths ?? extract.STALE_MONTHS_DEFAULT;
  const groups = new Map();

  for (const r of items) {
    const sender = r.source_sender || '';
    const subject = r.source_subject || '';
    const date = r.source_date || '';
    const base = extract.suggestionId({ sender, subject, date });
    const kind = isMove(r.change_type) ? 'moved' : 'alts';
    const key = `${base}:${kind}`;
    if (!groups.has(key)) {
      groups.set(key, { id: key, kind, sender, subject, date, rows: [] });
    }
    groups.get(key).rows.push(r);
  }

  const out = [];
  for (const g of groups.values()) {
    const confidence = Math.max(...g.rows.map((r) => parseFloat(r.confidence) || 0)) || null;
    const source = {
      from_email: g.sender,
      subject: g.subject,
      message_date: g.date || null,
      // Each row's own sentence, kept so the card shows the evidence per
      // contact rather than one quote for the whole group.
      quote: g.rows[0]?.quote || null,
    };

    if (g.kind === 'moved') {
      // One row per person; a reply almost always carries a single move. The
      // direction matters and is easy to get backwards: source_sender is the
      // address OMI already holds, and `email` is the new one. Reversed, an
      // apply overwrites the wrong record.
      for (const [i, r] of g.rows.entries()) {
        const flags = extract.gate({ email: r.email, name: r.name, quote: r.quote, sourceDate: g.date }, { staleMonths });
        const sameAddress = r.email && g.sender && r.email.toLowerCase() === g.sender.toLowerCase();
        if (sameAddress) {
          flags.push({
            code: 'no_new_address',
            detail: 'The reply gives no new address, so only the employer and role change here.',
          });
        }
        out.push({
          suggestion: {
            id: g.rows.length > 1 ? `${g.id}:${i}` : g.id,
            category: 'left_or_moved',
            confidence,
            detected_at: g.date || null,
            person: {
              name: r.name || null,
              current_email: g.sender || null,
              new_email: sameAddress ? null : (r.email || null),
              new_company: r.company || null,
              role: r.role || null,
            },
            alt_contacts: [],
            source: { ...source, quote: r.quote || null },
          },
          flags,
        });
      }
    } else {
      const alts = [];
      const flags = [];
      for (const r of g.rows) {
        const rowFlags = extract.gate({ email: r.email, name: r.name, quote: r.quote, sourceDate: g.date }, { staleMonths });
        alts.push({
          name: r.name || null,
          email: r.email || null,
          company: r.company || null,
          role: r.role || null,
          quote: r.quote || null,
          // Per-entry flags, so one bad address in a reply that named five
          // people does not hold back the other four.
          flags: rowFlags,
        });
        for (const f of rowFlags) if (!flags.some((x) => x.code === f.code)) flags.push(f);
      }
      out.push({
        suggestion: {
          id: g.id,
          category: 'mentions_alt_contact',
          confidence,
          detected_at: g.date || null,
          person: null,
          alt_contacts: alts,
          source,
        },
        flags,
      });
    }
  }
  return out;
}

/**
 * Parse, validate, group and queue a CSV.
 *
 * Nothing is applied. The return value is the report the upload screen shows:
 * how many suggestions were queued, how many are from a sender OMI recognises,
 * and the flag tally — the numbers the reviewer needs before pressing go.
 */
async function importCsv(text, opts = {}) {
  const rows = parseCsv(text);
  if (!rows.length) throw Object.assign(new Error('That file is empty.'), { status: 400 });
  const { header, items } = toObjects(rows);

  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) {
    throw Object.assign(
      new Error(`This does not look like a MailFlow contact-updates export: missing column(s) ${missing.join(', ')}. Found: ${header.join(', ')}.`),
      { status: 400 }
    );
  }
  if (items.length > 5000) {
    throw Object.assign(new Error(`That file has ${items.length} rows; the importer takes 5000 at a time.`), { status: 413 });
  }

  const built = buildSuggestions(items, opts);
  const flagTally = {};
  let known = 0;
  let queued = 0;
  const errors = [];

  for (const b of built) {
    try {
      const res = await ooo.upsertSuggestion(b.suggestion, opts.user || null, { origin: 'csv', flags: b.flags });
      queued += 1;
      if (res.sender_known) known += 1;
      for (const f of b.flags) flagTally[f.code] = (flagTally[f.code] || 0) + 1;
    } catch (err) {
      errors.push({ id: b.suggestion.id, error: err.message });
    }
  }

  return {
    rows_read: items.length,
    suggestions_queued: queued,
    from_known_sender: known,
    from_unknown_sender: queued - known,
    flagged: flagTally,
    errors,
  };
}

module.exports = { parseCsv, toObjects, buildSuggestions, importCsv, isMove };
