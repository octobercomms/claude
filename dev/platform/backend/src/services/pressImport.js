// Paste-and-sort import — Daniel dumps ANY messy list (a spreadsheet paste,
// pasted email signatures, "Jane Doe, arts editor, The Times, jane@…") and
// Claude (Opus) turns it into clean media-database rows: it extracts the
// contacts, fuzzy-matches each against the existing library, UPDATES the record
// it already has (enriching, never duplicating) or CREATES a new one, and
// attaches them all to the client + campaign. Speed and ease: one paste, sorted.

const pool = require('../db');
const claude = require('./claude');

function parseArray(text) {
  if (!text) return [];
  const fence = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*(\[[\s\S]*?\])\s*```/);
  const tryParse = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; } };
  if (fence) { const v = tryParse(fence[1].trim()); if (v) return v; }
  const a = text.indexOf('['); const b = text.lastIndexOf(']');
  if (a !== -1 && b > a) { const v = tryParse(text.slice(a, b + 1)); if (v) return v; }
  return [];
}

const norm = (s) => String(s || '').trim();
const lc = (s) => norm(s).toLowerCase();

// Ask Claude to extract structured journalist contacts from whatever was pasted.
async function extract(text, clientId) {
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
${String(text).slice(0, 12000)}
"""`;
  const out = await claude.callClaude({ max_tokens: 3000, system, user, feature: 'press_import_sort', clientId });
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
  const extracted = await extract(text, clientId);
  const result = { added: 0, updated: 0, skipped: 0, items: [] };

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

module.exports = { smartImport, extract, findExisting };
