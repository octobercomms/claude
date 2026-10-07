// Paste-and-sort import — Daniel dumps ANY messy list (a spreadsheet paste,
// pasted email signatures, "Jane Doe, arts editor, The Times, jane@…") and it
// becomes clean media-database rows: extract the contacts, fuzzy-match each
// against the existing library, UPDATE the record it already has (enriching,
// never duplicating) or CREATE a new one, and attach them all to the client +
// campaign. Speed and ease: one paste, sorted.
//
// Two extraction paths:
//
//   1. A real CSV/TSV with a header row goes through parseDelimited() — no AI
//      at all. Free, instant, lossless, and it cannot truncate. This is the
//      common case (exporting a media list from a spreadsheet).
//   2. Anything else goes to Claude, in chunks.
//
// The chunking matters. This used to be one call with the input cut at 12,000
// characters and max_tokens at 3,000, which meant a list over roughly 50
// contacts had its JSON reply truncated mid-object. parseArray() then found no
// closing bracket, returned [], and the import reported "0 added, 0 updated"
// as though the paste had simply contained nothing. A silent no-op on the
// operator's real list. Chunking keeps every reply far from the cap, and
// parseArray now salvages whole objects out of a truncated array instead of
// discarding the lot.

const pool = require('../db');
const claude = require('./claude');

function parseArray(text) {
  if (!text) return [];
  const fence = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*(\[[\s\S]*?\])\s*```/);
  const tryParse = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; } };
  if (fence) { const v = tryParse(fence[1].trim()); if (v) return v; }
  const a = text.indexOf('['); const b = text.lastIndexOf(']');
  if (a !== -1 && b > a) { const v = tryParse(text.slice(a, b + 1)); if (v) return v; }
  return salvageObjects(text);
}

// Last resort when the array as a whole will not parse — usually because the
// reply was cut off mid-object. Walk the text tracking brace depth (and string
// state, so a brace inside a value doesn't confuse the count), and keep every
// object that closed. An import of 60 of 62 contacts is worth having; silently
// importing none is not.
function salvageObjects(text) {
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try { const v = JSON.parse(text.slice(start, i + 1)); if (v && typeof v === 'object') out.push(v); }
        catch { /* skip the one bad object, keep the rest */ }
        start = -1;
      }
    }
  }
  return out;
}

// ── CSV / TSV fast path ──────────────────────────────────────────────────────

// Split one delimited line, honouring double-quoted fields (and "" escapes).
function splitLine(line, delim) {
  const out = []; let cur = ''; let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inStr = false; }
      else cur += ch;
    } else if (ch === '"') inStr = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(v => v.trim());
}

// Header name -> our field. Deliberately generous: these are the column names
// media lists actually ship with.
const HEADER_MAP = {
  email: 'email', 'e-mail': 'email', 'email address': 'email', mail: 'email',
  name: 'name', 'full name': 'name', contact: 'name', journalist: 'name',
  'first name': 'first_name', first: 'first_name', firstname: 'first_name', forename: 'first_name',
  'last name': 'last_name', last: 'last_name', surname: 'last_name', lastname: 'last_name',
  company: 'company', outlet: 'company', publication: 'company', organisation: 'company',
  organization: 'company', magazine: 'company', title_outlet: 'company', media: 'company',
  title: 'title', role: 'title', 'job title': 'title', position: 'title',
  beat: 'beat', topic: 'beat', section: 'beat', subject: 'beat', category: 'beat',
  location: 'location', city: 'location', country: 'location', region: 'location', based: 'location',
  tags: 'tags', tag: 'tags', keywords: 'tags',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Parse a pasted spreadsheet. Returns null (not []) when this does not look
// like a delimited contact list, so the caller knows to fall back to Claude.
// Requires a header row that names an email column — without one we cannot be
// confident enough to skip the AI, and a wrong column mapping is worse than
// paying for the model.
function parseDelimited(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;

  // Pick the delimiter that splits the header into the most columns.
  const delim = ['\t', ',', ';'].reduce((best, d) =>
    splitLine(lines[0], d).length > splitLine(lines[0], best).length ? d : best, ',');
  const header = splitLine(lines[0], delim).map(h => HEADER_MAP[lc(h)] || null);
  if (!header.includes('email')) return null;

  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, delim);
    const c = { tags: [] };
    header.forEach((field, i) => {
      if (!field) return;
      const v = norm(cells[i]);
      if (!v) return;
      if (field === 'tags') c.tags = v.split(/[;,|]/).map(norm).filter(Boolean).slice(0, 8);
      else if (field === 'email') c.email = lc(v);
      else c[field] = v;
    });
    if (c.email && !EMAIL_RE.test(c.email)) delete c.email;
    c.name = c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || null;
    if (!c.email && !c.name) continue;
    rows.push({
      name: c.name || null, first_name: c.first_name || null, last_name: c.last_name || null,
      email: c.email || null, company: c.company || null, title: c.title || null,
      beat: c.beat || null, location: c.location || null, tags: c.tags,
    });
  }
  return rows.length ? rows : null;
}

const norm = (s) => String(s || '').trim();
const lc = (s) => norm(s).toLowerCase();

// Split pasted text into chunks small enough that one reply cannot hit the
// output cap. Splits on line boundaries, so a row is never cut in half.
const CHUNK_CHARS = 6000;
const CHUNK_LINES = 40;
const MAX_CHUNKS = 40;       // ~1,600 rows per paste; beyond that, say so.

function chunkText(text) {
  const lines = String(text).split(/\r?\n/);
  const chunks = []; let cur = []; let len = 0;
  for (const line of lines) {
    // A single line longer than a whole chunk (one giant pasted blob with no
    // newlines) is hard-split rather than dropped.
    if (line.length > CHUNK_CHARS) {
      if (cur.length) { chunks.push(cur.join('\n')); cur = []; len = 0; }
      for (let i = 0; i < line.length; i += CHUNK_CHARS) chunks.push(line.slice(i, i + CHUNK_CHARS));
      continue;
    }
    if (cur.length && (len + line.length > CHUNK_CHARS || cur.length >= CHUNK_LINES)) {
      chunks.push(cur.join('\n')); cur = []; len = 0;
    }
    cur.push(line); len += line.length + 1;
  }
  if (cur.length) chunks.push(cur.join('\n'));
  return chunks.filter(c => c.trim());
}

// Ask Claude to extract structured journalist contacts from whatever was pasted.
// One call per chunk, deduped on email as we go so an overlapping paste does not
// produce two rows for one person.
async function extract(text, clientId) {
  const chunks = chunkText(text).slice(0, MAX_CHUNKS);
  const out = []; const seen = new Set();
  for (const chunk of chunks) {
    let batch = [];
    try { batch = await extractChunk(chunk, clientId); }
    catch (err) {
      // One failed chunk must not lose the chunks that worked. If every chunk
      // fails, smartImport's zero-guard turns that into a visible error.
      console.error('[press import] chunk failed:', err.message);
      continue;
    }
    for (const c of batch) {
      const key = c.email || `${lc(c.name)}|${lc(c.company)}`;
      if (seen.has(key)) continue;
      seen.add(key); out.push(c);
    }
  }
  return out;
}

async function extractChunk(text, clientId) {
  const system = 'You extract structured press/media contacts from messy pasted text (spreadsheet rows, email signatures, freeform lists). British English. Never invent data — only pull what is actually present.';
  const user = `Extract every distinct contact from the text below. For each, capture what's present (leave a field null if it isn't there — never guess an email):

Return ONLY a JSON array:
[{
  "name": "full name or null",
  "first_name": "or null",
  "last_name": "or null",
  "email": "a real email present in the text, or null",
  "company": "outlet / publication / organisation or null",
  "title": "job title or null",
  "beat": "their beat/topic area or null (e.g. arts, technology, property)",
  "location": "city/country or null",
  "tags": ["short topic tags you can infer from their beat/outlet, or omit"]
}]

Text:
"""
${text}
"""`;
  // Headroom over what a full chunk can possibly need, so a reply is never
  // truncated in normal use. salvageObjects() covers the abnormal case.
  const out = await claude.callClaude({ max_tokens: 8000, system, user, feature: 'press_import_sort', clientId });
  return parseArray(out).map(c => ({
    name: norm(c.name) || [norm(c.first_name), norm(c.last_name)].filter(Boolean).join(' ') || null,
    first_name: norm(c.first_name) || null,
    last_name: norm(c.last_name) || null,
    email: lc(c.email) || null,
    company: norm(c.company) || null,
    title: norm(c.title) || null,
    beat: norm(c.beat) || null,
    location: norm(c.location) || null,
    tags: Array.isArray(c.tags) ? c.tags.map(norm).filter(Boolean).slice(0, 8) : [],
  })).filter(c => c.email || c.name);
}

// Find the existing library row this contact IS, if any: email match first
// (the strong signal), else an exact name+outlet match. Deliberately
// conservative — a wrong merge is worse than a near-duplicate.
async function findExisting(c) {
  if (c.email) {
    const { rows } = await pool.query('SELECT * FROM outreach_contacts WHERE lower(email) = $1 LIMIT 1', [c.email]);
    if (rows[0]) return rows[0];
  }
  if (c.name && c.company) {
    const { rows } = await pool.query(
      'SELECT * FROM outreach_contacts WHERE lower(name) = $1 AND lower(coalesce(company,\'\')) = $2 LIMIT 1',
      [lc(c.name), lc(c.company)]
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

async function attach(contactId, clientId, campaignId) {
  await pool.query(
    `INSERT INTO outreach_contact_clients (contact_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [contactId, clientId]
  );
  if (campaignId) {
    await pool.query(
      `INSERT INTO outreach_campaign_contacts (campaign_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [campaignId, contactId]
    );
  }
}

// Main entry: extract → match → update-or-create → attach. Returns a summary the
// UI shows ("12 added, 3 updated, 1 skipped") and the per-row detail for undo.
async function smartImport({ text, clientId, campaignId = null }) {
  const csv = parseDelimited(text);
  const extracted = csv || await extract(text, clientId);
  const result = { added: 0, updated: 0, skipped: 0, items: [], source: csv ? 'csv' : 'ai' };

  // Never report a no-op as a success. The old code returned all-zeroes when
  // extraction produced nothing, and the UI showed "Sorted: 0 added, 0
  // updated" over a list the operator had just pasted. Fail loudly instead.
  if (!extracted.length) {
    const e = new Error('Could not read any contacts from that. If it is a spreadsheet, include a header row with an "email" column; otherwise check the text actually contains names or email addresses.');
    e.status = 422;
    throw e;
  }

  for (const c of extracted) {
    if (!c.email && !c.name) { result.skipped++; continue; }
    const existing = await findExisting(c);
    if (existing) {
      // Enrich only empty fields — never overwrite good data. Merge tags.
      const mergedTags = Array.from(new Set([...(existing.tags || []), ...(c.tags || [])]));
      await pool.query(
        `UPDATE outreach_contacts SET
            email = COALESCE(email, $2), company = COALESCE(company, $3), title = COALESCE(title, $4),
            first_name = COALESCE(first_name, $5), last_name = COALESCE(last_name, $6),
            contact_type = COALESCE(contact_type, $7), location = COALESCE(location, $8),
            tags = $9, kind = COALESCE(NULLIF(kind,''), 'media'), updated_at = NOW()
          WHERE id = $1`,
        [existing.id, c.email, c.company, c.title, c.first_name, c.last_name, c.beat, c.location, mergedTags]
      );
      await attach(existing.id, clientId, campaignId);
      result.updated++;
      result.items.push({ action: 'updated', id: existing.id, name: existing.name || c.name, email: c.email });
    } else {
      const { rows } = await pool.query(
        `INSERT INTO outreach_contacts (name, first_name, last_name, email, company, title, contact_type, location, tags, kind, source, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'media','paste_import','active') RETURNING id`,
        [c.name, c.first_name, c.last_name, c.email, c.company, c.title, c.beat, c.location, c.tags]
      );
      await attach(rows[0].id, clientId, campaignId);
      result.added++;
      result.items.push({ action: 'added', id: rows[0].id, name: c.name, email: c.email });
    }
  }
  return result;
}

module.exports = { smartImport, extract, findExisting, parseDelimited, parseArray, chunkText };
