const Anthropic = require('@anthropic-ai/sdk');
const { getSetting } = require('../utils/settings');
const pool = require('../db');

const MODEL = 'claude-sonnet-4-6';
// Each Claude call gets a manageable bite of the catalogue. Smaller =
// more API calls but cheaper to retry; larger = fewer calls but a
// single timeout loses more work.
const BATCH = 40;
// Hard ceiling per analyse run so an "all contacts" sweep on a 21k
// library can't accidentally bill ~$20+ in one click. The caller can
// still filter narrower then re-run.
const MAX_CONTACTS = 500;

const TIDYABLE_FIELDS = ['name', 'first_name', 'last_name', 'email', 'company', 'title', 'role', 'contact_type', 'location', 'website', 'linkedin_url'];

// Build the same WHERE-clause used by the library list/delete endpoints.
// Duplicated here rather than imported from routes/outreach so the
// service doesn't pull the whole route file on require.
function buildLibraryFilter(visibleClientIds, q) {
  const where = [];
  const params = [];
  if (visibleClientIds !== null) {
    params.push(visibleClientIds);
    where.push(`(
      c.client_id = ANY($${params.length}::uuid[])
      OR EXISTS (
        SELECT 1 FROM outreach_contact_clients m
         WHERE m.contact_id = c.id AND m.client_id = ANY($${params.length}::uuid[])
      )
    )`);
  }
  if (q?.search) {
    params.push(`%${String(q.search).toLowerCase()}%`);
    where.push(`(LOWER(COALESCE(c.name, '')) LIKE $${params.length} OR LOWER(COALESCE(c.email, '')) LIKE $${params.length} OR LOWER(COALESCE(c.company, '')) LIKE $${params.length})`);
  }
  if (q?.tags_all) {
    const arr = Array.isArray(q.tags_all) ? q.tags_all : String(q.tags_all).split(',').map(t => t.trim()).filter(Boolean);
    if (arr.length) { params.push(arr); where.push(`c.tags @> $${params.length}::text[]`); }
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// Run Claude across a slice of contacts and return suggested field
// changes. Each suggestion includes the contact id, the field, the
// proposed new value, and a short rationale. The caller decides which
// to apply.
async function analyseContacts({ visibleClientIds, filterBody = {}, limit = MAX_CONTACTS }) {
  const apiKey = await getSetting('CLAUDE_API_KEY');
  if (!apiKey) throw new Error('Claude API key not configured — add it in Settings.');

  const contacts = await loadContacts({ visibleClientIds, filterBody, limit: Math.min(limit, MAX_CONTACTS) });
  if (!contacts.length) return { suggestions: [], analysed: 0, capped: false };
  const client = new Anthropic({ apiKey: apiKey.trim() });

  const byId = new Map(contacts.map(c => [c.id, c]));
  const allSuggestions = [];
  for (let i = 0; i < contacts.length; i += BATCH) {
    const batch = contacts.slice(i, i + BATCH);
    const batchSuggestions = await analyseBatch(client, batch);
    // Enrich each suggestion with the current value + a display label so
    // the UI can render a before/after diff and identify the row without
    // a second roundtrip. Skip suggestions where the "after" equals the
    // current value (Claude no-op).
    for (const s of batchSuggestions) {
      const c = byId.get(s.id);
      if (!c) continue;
      const before = c[s.field] ?? null;
      const after = String(s.new_value).trim();
      if ((before ?? '') === after) continue;
      allSuggestions.push({
        ...s,
        new_value: after,
        before,
        contact_email: c.email || null,
        contact_name: c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
      });
    }
  }
  return {
    suggestions: allSuggestions,
    analysed: contacts.length,
    capped: contacts.length >= MAX_CONTACTS,
  };
}

async function analyseBatch(client, contacts) {
  const system = 'You are a CRM data-quality assistant cleaning up B2B contact records. '
    + 'You only propose changes you are confident about. You never invent information '
    + '(no guessing a name from an email alone, no guessing a company from a vague domain). '
    + 'When the email domain clearly identifies a real company you may suggest filling '
    + 'a missing company field — but skip generic providers (gmail, hotmail, yahoo, etc).';

  const rowsForPrompt = contacts.map(c => ({
    id: c.id,
    email: c.email || null,
    name: c.name || null,
    first_name: c.first_name || null,
    last_name: c.last_name || null,
    company: c.company || null,
    title: c.title || null,
    role: c.role || null,
    contact_type: c.contact_type || null,
    location: c.location || null,
    website: c.website || null,
    linkedin_url: c.linkedin_url || null,
  }));

  const prompt = [
    'Look at these contact records and propose field-level cleanups. Output strictly valid JSON.',
    '',
    'Each suggestion describes one field change to one contact:',
    '{"id":"<contact id>","field":"<field name>","new_value":"<proposed value>","why":"<short reason>"}',
    '',
    'Fields you may propose changes to:',
    TIDYABLE_FIELDS.join(', '),
    '',
    'Rules:',
    '- Lowercase emails (joe@ACME.com → joe@acme.com).',
    '- Trim and normalise whitespace in all text fields.',
    '- Capitalise names properly ("john smith" → "John Smith", "JOHN SMITH" → "John Smith"). Leave correctly-cased names alone.',
    '- If first_name and last_name are missing but a single `name` exists, propose splitting it.',
    '- If company is missing and the email domain clearly identifies a real company (e.g. john@acmecorp.co.uk → "Acme Corp"), propose filling it. Skip generic providers (gmail, hotmail, yahoo, outlook, icloud, msn, aol, proton, hey, fastmail, etc).',
    '- If company is present but looks like a domain ("acmecorp.co.uk"), propose the human form ("Acme Corp").',
    '- If a URL field is missing https:// prefix, propose adding it.',
    '- Don\'t invent data the record doesn\'t support (no guessing a title or location from nothing).',
    '- Don\'t propose a change if the existing value is already correct.',
    '- Output ONLY a JSON object: {"suggestions": [...]}. No markdown, no commentary.',
    '',
    'Contacts:',
    JSON.stringify(rowsForPrompt),
  ].join('\n');

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = resp.content.find(b => b.type === 'text')?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch { return []; }
  return (Array.isArray(parsed.suggestions) ? parsed.suggestions : []).filter(validateSuggestion);
}

function validateSuggestion(s) {
  return s && typeof s === 'object'
    && typeof s.id === 'string'
    && typeof s.field === 'string'
    && TIDYABLE_FIELDS.includes(s.field)
    && typeof s.new_value === 'string';
}

// Apply a set of accepted suggestions. Writes one audit row per
// change so the AM can review history later. Rejects suggestions
// whose contact the caller can't see.
async function applyTidy({ user, visibleClientIds, suggestions }) {
  if (!Array.isArray(suggestions) || !suggestions.length) return { applied: 0 };

  // Group by contact for one UPDATE per contact, regardless of how
  // many fields changed.
  const byContact = new Map();
  for (const s of suggestions) {
    if (!validateSuggestion(s)) continue;
    if (!byContact.has(s.id)) byContact.set(s.id, []);
    byContact.get(s.id).push(s);
  }

  let applied = 0;
  for (const [contactId, changes] of byContact) {
    // Re-read the current row so the audit captures the true before
    // value and so we can skip a no-op (e.g. another AM already
    // applied the same fix between analyse and apply).
    const { rows } = await pool.query('SELECT * FROM outreach_contacts WHERE id = $1', [contactId]);
    const row = rows[0];
    if (!row) continue;
    if (visibleClientIds !== null) {
      const ok = await contactVisible(contactId, visibleClientIds);
      if (!ok) continue;
    }

    const sets = [];
    const params = [contactId];
    const audits = [];
    for (const c of changes) {
      const before = row[c.field] ?? null;
      const after = String(c.new_value).trim();
      if ((before ?? '') === after) continue;
      params.push(after);
      sets.push(`${c.field} = $${params.length}`);
      audits.push({ field: c.field, before, after, rationale: c.why || null });
    }
    if (!sets.length) continue;
    sets.push('updated_at = NOW()');
    await pool.query(`UPDATE outreach_contacts SET ${sets.join(', ')} WHERE id = $1`, params);

    for (const a of audits) {
      await pool.query(
        `INSERT INTO outreach_contact_audit (contact_id, field, before_value, after_value, source, rationale, applied_by)
         VALUES ($1, $2, $3, $4, 'claude_tidy', $5, $6)`,
        [contactId, a.field, a.before, a.after, a.rationale, user?.id || null]
      );
      applied++;
    }
  }
  return { applied };
}

async function contactVisible(contactId, visibleClientIds) {
  const { rows } = await pool.query(
    `SELECT 1
       FROM outreach_contacts c
      WHERE c.id = $1
        AND (
          c.client_id = ANY($2::uuid[])
          OR EXISTS (SELECT 1 FROM outreach_contact_clients m
                      WHERE m.contact_id = c.id AND m.client_id = ANY($2::uuid[]))
        )`,
    [contactId, visibleClientIds]
  );
  return !!rows.length;
}

async function loadContacts({ visibleClientIds, filterBody, limit }) {
  const { whereSql, params } = buildLibraryFilter(visibleClientIds, filterBody || {});
  const { rows } = await pool.query(
    `SELECT id, name, first_name, last_name, email, company, title, role, contact_type, location, website, linkedin_url
       FROM outreach_contacts c
       ${whereSql}
       ORDER BY c.created_at DESC
       LIMIT ${Math.max(1, Math.min(MAX_CONTACTS, Number(limit) || MAX_CONTACTS))}`,
    params
  );
  return rows;
}

module.exports = { analyseContacts, applyTidy, MAX_CONTACTS, TIDYABLE_FIELDS };
