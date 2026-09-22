// Out-of-office contact-change suggestions from MailFlow.
//
// MailFlow does the detection + extraction and POSTs suggestions; OMI owns the
// queue, the classification, and the approve-and-apply. This service is the OMI
// side: idempotent ingest, matching the sender to an existing contact, applying
// OMI's own taxonomy, and applying an approved change to the contact record.
// Nothing here writes to a contact until a person calls apply().

const pool = require('../db');

// Which OMI taxonomy bucket a matched contact falls in. The press/media list is
// journalists; a `kind` of 'prospect'/'industry'/'supplier' (private business
// contacts) maps across. Unmatched senders are 'unknown' — the reviewer decides.
function classify(contact) {
  if (!contact) return 'unknown';
  const kind = (contact.kind || '').toLowerCase();
  const type = (contact.contact_type || '').toLowerCase();
  if (kind === 'media' || /journalist|editor|reporter|writer|press|correspondent/.test(type)) return 'journalist';
  if (kind === 'prospect' || /prospect|lead/.test(type)) return 'prospect';
  if (kind === 'client' || /client/.test(type)) return 'client';
  if (kind === 'supplier' || /supplier|vendor|contractor|freelance/.test(type)) return 'supplier';
  return 'general';
}

// A relative importance for the review queue — a journalist's new masthead or a
// client's new firm matters more than a general contact's away note.
const CLASS_WEIGHT = { journalist: 5, client: 5, prospect: 3, supplier: 2, general: 1, unknown: 1 };
function classWeight(cls) { return CLASS_WEIGHT[cls] || 1; }

// Find the contact OMI already holds for a sender address, so a suggestion can
// be tied to a real record and classified. Case-insensitive; prefers the most
// engaged row when the same address exists on several (legacy per-client rows).
async function matchContact(email) {
  if (!email) return null;
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.email, c.company, c.role, c.contact_type, c.kind,
            (SELECT COUNT(*)::int FROM outreach_sends s WHERE s.contact_id = c.id) AS sends
       FROM outreach_contacts c
      WHERE lower(c.email) = lower($1)
      ORDER BY sends DESC
      LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

// Idempotent upsert of one MailFlow suggestion. On first insert we match +
// classify the sender; a re-POST refreshes MailFlow's own fields but preserves
// OMI's review state (status / applied) — a retried push never resurrects a row
// a reviewer already handled, and never duplicates.
async function upsertSuggestion(item, mailflowUser) {
  if (!item || !item.id) throw new Error('suggestion.id required');
  const category = item.category === 'mentions_alt_contact' ? 'mentions_alt_contact' : 'left_or_moved';
  const person = item.person || null;
  const altContacts = Array.isArray(item.alt_contacts) ? item.alt_contacts : [];
  const source = item.source || null;
  const confidence = typeof item.confidence === 'number' ? item.confidence : null;
  const detectedAt = item.detected_at || null;

  // Match on the address OMI already holds for the person.
  const matchEmail = person?.current_email || source?.from_email || null;
  const matched = await matchContact(matchEmail);
  const contactClass = classify(matched);

  await pool.query(
    `INSERT INTO ooo_suggestions
       (id, mailflow_user, category, person, alt_contacts, source, confidence,
        detected_at, matched_contact_id, contact_class, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10, NOW())
     ON CONFLICT (id) DO UPDATE SET
        mailflow_user = EXCLUDED.mailflow_user,
        category      = EXCLUDED.category,
        person        = EXCLUDED.person,
        alt_contacts  = EXCLUDED.alt_contacts,
        source        = EXCLUDED.source,
        confidence    = EXCLUDED.confidence,
        detected_at   = EXCLUDED.detected_at,
        -- refresh the match only while still pending; never touch an applied/
        -- dismissed row's OMI state.
        matched_contact_id = CASE WHEN ooo_suggestions.status = 'pending'
                                  THEN EXCLUDED.matched_contact_id ELSE ooo_suggestions.matched_contact_id END,
        contact_class      = CASE WHEN ooo_suggestions.status = 'pending'
                                  THEN EXCLUDED.contact_class ELSE ooo_suggestions.contact_class END,
        updated_at    = NOW()`,
    [
      item.id, mailflowUser || null, category,
      person ? JSON.stringify(person) : null,
      JSON.stringify(altContacts),
      source ? JSON.stringify(source) : null,
      confidence, detectedAt, matched?.id || null, contactClass,
    ]
  );
  return { id: item.id, accepted: true };
}

// The review queue, pending-first, ordered by (class weight, confidence). Joins
// the live matched-contact details so the reviewer sees what would change.
async function listSuggestions({ status = 'pending', limit = 300 } = {}) {
  const { rows } = await pool.query(
    `SELECT s.*,
            mc.name AS matched_name, mc.email AS matched_email,
            mc.company AS matched_company, mc.role AS matched_role
       FROM ooo_suggestions s
       LEFT JOIN outreach_contacts mc ON mc.id = s.matched_contact_id
      WHERE ($1::text IS NULL OR s.status = $1)
      ORDER BY (s.status = 'pending') DESC,
               ${'CASE s.contact_class ' + Object.entries(CLASS_WEIGHT).map(([k, v]) => `WHEN '${k}' THEN ${v}`).join(' ') + ' ELSE 1 END'} DESC,
               s.confidence DESC NULLS LAST, s.received_at DESC
      LIMIT $2`,
    [status || null, Math.min(1000, Math.max(1, limit))]
  );
  return rows.map(r => ({ ...r, class_weight: classWeight(r.contact_class) }));
}

// Create a library contact (no client attachment) from an extracted person/alt.
async function createLibraryContact({ name, email, company, role, contactType, source }) {
  const { rows } = await pool.query(
    `INSERT INTO outreach_contacts (name, email, company, role, contact_type, source, status)
     VALUES ($1,$2,$3,$4,$5,$6,'new') RETURNING id`,
    [name || null, email || null, company || null, role || null, contactType || null, source || 'mailflow-ooo']
  );
  return rows[0].id;
}

// Apply an approved suggestion to the contact record and mark it applied.
// - left_or_moved: update the matched contact's email/company/role (whichever
//   the suggestion carries); if nothing matched, create a new library contact.
// - mentions_alt_contact: create a library contact for each chosen alt entry.
// `opts.altIndexes` limits which alt_contacts get created (default: all).
async function applySuggestion(id, opts = {}) {
  const { rows } = await pool.query('SELECT * FROM ooo_suggestions WHERE id = $1', [id]);
  if (!rows.length) { const e = new Error('Suggestion not found'); e.status = 404; throw e; }
  const s = rows[0];
  if (s.status === 'applied') return { id, status: 'applied', note: s.applied_note };

  let note = '';
  if (s.category === 'left_or_moved') {
    const p = s.person || {};
    if (s.matched_contact_id) {
      await pool.query(
        `UPDATE outreach_contacts
            SET email   = COALESCE($2, email),
                company = COALESCE($3, company),
                role    = COALESCE($4, role),
                updated_at = NOW()
          WHERE id = $1`,
        [s.matched_contact_id, p.new_email || null, p.new_company || null, p.role || null]
      );
      const bits = [p.new_email && `email → ${p.new_email}`, p.new_company && `company → ${p.new_company}`, p.role && `role → ${p.role}`].filter(Boolean);
      note = `Updated ${p.name || 'contact'}: ${bits.join(', ') || 'no field changes'}`;
    } else {
      const newId = await createLibraryContact({
        name: p.name, email: p.new_email || p.current_email, company: p.new_company, role: p.role, source: 'mailflow-ooo',
      });
      note = `Created new contact ${p.name || p.new_email || ''} (no existing match)`;
      await pool.query('UPDATE ooo_suggestions SET matched_contact_id = $2 WHERE id = $1', [id, newId]);
    }
  } else {
    const alts = Array.isArray(s.alt_contacts) ? s.alt_contacts : [];
    const pick = Array.isArray(opts.altIndexes) ? opts.altIndexes : alts.map((_, i) => i);
    const created = [];
    for (const i of pick) {
      const a = alts[i];
      if (!a || !(a.email || a.name)) continue;
      await createLibraryContact({ name: a.name, email: a.email, company: a.company, role: a.role, source: 'mailflow-ooo' });
      created.push(a.name || a.email);
    }
    note = created.length ? `Added ${created.length} alternate contact(s): ${created.join(', ')}` : 'No alternate contacts added';
  }

  await pool.query(
    "UPDATE ooo_suggestions SET status = 'applied', applied_at = NOW(), applied_note = $2, updated_at = NOW() WHERE id = $1",
    [id, note]
  );
  return { id, status: 'applied', note };
}

async function dismissSuggestion(id) {
  const { rowCount } = await pool.query(
    "UPDATE ooo_suggestions SET status = 'dismissed', updated_at = NOW() WHERE id = $1 AND status <> 'applied'",
    [id]
  );
  if (!rowCount) { const e = new Error('Suggestion not found or already applied'); e.status = 404; throw e; }
  return { id, status: 'dismissed' };
}

// Counts for the queue badge.
async function counts() {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS n FROM ooo_suggestions GROUP BY status`
  );
  const out = { pending: 0, applied: 0, dismissed: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

module.exports = {
  classify, classWeight, matchContact, upsertSuggestion,
  listSuggestions, applySuggestion, dismissSuggestion, counts,
};
