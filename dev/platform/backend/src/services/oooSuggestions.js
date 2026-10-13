// Out-of-office contact-change suggestions.
//
// Three doors feed this queue and all three stop at the same gate: MailFlow's
// token-gated POST (routes/oooSuggestions.js), a CSV upload of a MailFlow
// export (services/oooCsv.js), and OMI's own IMAP reply poll
// (services/outreachReplies.js). Detection and extraction happen upstream; this
// service owns the queue, the classification, and the approve-and-apply.
//
// Two rules hold throughout. Nothing writes to a contact until a person calls
// applySuggestion(). And every apply records the prior values it overwrote so
// it can be put back -- the IMAP feed reads the whole inbox, not just press
// mail, so a wrong apply is a matter of when rather than if.

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

// Idempotent upsert of one suggestion, whichever door it arrived through. On
// first insert we match + classify the sender; a re-POST, re-upload or re-scan
// refreshes the upstream fields but preserves OMI's review state (status /
// applied) — a retry never resurrects a row a reviewer already handled, and
// never duplicates.
//
// `opts.origin` is 'mailflow' | 'csv' | 'imap'. `opts.flags` is the gate output
// from services/oooExtract.js: reasons the importer held the row back, carried
// so the review card can show them and the reviewer can overrule.
async function upsertSuggestion(item, mailflowUser, opts = {}) {
  if (!item || !item.id) throw new Error('suggestion.id required');
  const category = item.category === 'mentions_alt_contact' ? 'mentions_alt_contact' : 'left_or_moved';
  const person = item.person || null;
  const altContacts = Array.isArray(item.alt_contacts) ? item.alt_contacts : [];
  const source = item.source || null;
  const confidence = typeof item.confidence === 'number' ? item.confidence : null;
  const detectedAt = item.detected_at || null;
  const origin = ['mailflow', 'csv', 'imap'].includes(opts.origin) ? opts.origin : 'mailflow';
  const flags = Array.isArray(opts.flags) ? opts.flags : (Array.isArray(item.flags) ? item.flags : []);

  // Match on the address OMI already holds for the person.
  const matchEmail = person?.current_email || source?.from_email || null;
  const matched = await matchContact(matchEmail);
  const contactClass = classify(matched);

  await pool.query(
    `INSERT INTO ooo_suggestions
       (id, mailflow_user, category, person, alt_contacts, source, confidence,
        detected_at, matched_contact_id, contact_class, origin, sender_known,
        source_sender, flags, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
        mailflow_user = EXCLUDED.mailflow_user,
        category      = EXCLUDED.category,
        person        = EXCLUDED.person,
        alt_contacts  = EXCLUDED.alt_contacts,
        source        = EXCLUDED.source,
        confidence    = EXCLUDED.confidence,
        detected_at   = EXCLUDED.detected_at,
        source_sender = EXCLUDED.source_sender,
        -- Keep the door that first saw it; a CSV re-upload of a reply the IMAP
        -- poll already found should not relabel its provenance.
        origin        = ooo_suggestions.origin,
        -- refresh the match only while still pending; never touch an applied/
        -- dismissed row's OMI state.
        matched_contact_id = CASE WHEN ooo_suggestions.status = 'pending'
                                  THEN EXCLUDED.matched_contact_id ELSE ooo_suggestions.matched_contact_id END,
        contact_class      = CASE WHEN ooo_suggestions.status = 'pending'
                                  THEN EXCLUDED.contact_class ELSE ooo_suggestions.contact_class END,
        sender_known       = CASE WHEN ooo_suggestions.status = 'pending'
                                  THEN EXCLUDED.sender_known ELSE ooo_suggestions.sender_known END,
        flags              = CASE WHEN ooo_suggestions.status = 'pending'
                                  THEN EXCLUDED.flags ELSE ooo_suggestions.flags END,
        updated_at    = NOW()`,
    [
      item.id, mailflowUser || null, category,
      person ? JSON.stringify(person) : null,
      JSON.stringify(altContacts),
      source ? JSON.stringify(source) : null,
      confidence, detectedAt, matched?.id || null, contactClass,
      origin, Boolean(matched), matchEmail || null, JSON.stringify(flags),
    ]
  );
  return { id: item.id, accepted: true, sender_known: Boolean(matched), contact_class: contactClass };
}

/**
 * The review queue.
 *
 * `bucket` is the safety divide the automatic feed made necessary:
 *   'known'   — the sender is a contact OMI already holds. Press mail, in
 *               practice. Safe to work through in a batch.
 *   'unknown' — the sender is nobody OMI knows: a supplier, an accountant, a
 *               personal reply. Extracted just as cleanly and worth nothing, so
 *               these are listed separately, never pre-ticked, and each one is
 *               an explicit approve or decline.
 */
async function listSuggestions({ status = 'pending', bucket = 'all', limit = 300 } = {}) {
  const known = bucket === 'known' ? true : bucket === 'unknown' ? false : null;
  const { rows } = await pool.query(
    `SELECT s.*,
            mc.name AS matched_name, mc.email AS matched_email,
            mc.company AS matched_company, mc.role AS matched_role
       FROM ooo_suggestions s
       LEFT JOIN outreach_contacts mc ON mc.id = s.matched_contact_id
      WHERE ($1::text IS NULL OR s.status = $1)
        AND ($2::boolean IS NULL OR s.sender_known = $2)
      ORDER BY (s.status = 'pending') DESC,
               ${'CASE s.contact_class ' + Object.entries(CLASS_WEIGHT).map(([k, v]) => `WHEN '${k}' THEN ${v}`).join(' ') + ' ELSE 1 END'} DESC,
               s.confidence DESC NULLS LAST, s.received_at DESC
      LIMIT $3`,
    [status || null, known, Math.min(1000, Math.max(1, limit))]
  );
  return rows.map(r => ({ ...r, class_weight: classWeight(r.contact_class) }));
}

// Create a library contact (no client attachment) from an extracted person/alt.
async function createLibraryContact(client, { name, email, company, role, contactType, source }) {
  const { rows } = await client.query(
    `INSERT INTO outreach_contacts (name, email, company, role, contact_type, source, status)
     VALUES ($1,$2,$3,$4,$5,$6,'new') RETURNING id`,
    [name || null, email || null, company || null, role || null, contactType || null, source || 'mailflow-ooo']
  );
  return rows[0].id;
}

/**
 * Apply an approved suggestion to the contact record and mark it applied.
 *
 * - left_or_moved: update the matched contact's email/company/role (whichever
 *   the suggestion carries); if nothing matched, create a library contact.
 * - mentions_alt_contact: create a library contact for each chosen alt entry.
 *
 * `opts.altIndexes` limits which alt_contacts get created (default: all).
 * `opts.user` is recorded for audit.
 *
 * Everything runs in one transaction, and the prior values of each field it
 * overwrites are read inside that transaction and stored on the suggestion
 * before the write lands. That record is what makes undoSuggestion() possible;
 * without it an apply is irreversible, which is the entire risk of letting the
 * feed run unattended.
 */
async function applySuggestion(id, opts = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM ooo_suggestions WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) { const e = new Error('Suggestion not found'); e.status = 404; throw e; }
    const s = rows[0];
    if (s.status === 'applied') { await client.query('ROLLBACK'); return { id, status: 'applied', note: s.applied_note }; }

    let note = '';
    const before = { category: s.category };

    if (s.category === 'left_or_moved') {
      const p = s.person || {};
      if (s.matched_contact_id) {
        // Read the current values first — this is the undo record.
        const { rows: cur } = await client.query(
          'SELECT email, company, role FROM outreach_contacts WHERE id = $1 FOR UPDATE',
          [s.matched_contact_id]
        );
        if (!cur.length) { const e = new Error('Matched contact no longer exists'); e.status = 409; throw e; }
        before.contact_id = s.matched_contact_id;
        before.fields = { email: cur[0].email, company: cur[0].company, role: cur[0].role };

        // A "moved" row whose new address equals the one already on file is a
        // change of employer, not of address. Writing it back would be a no-op
        // that still looks like an edit in the audit trail, so skip it.
        const newEmail = p.new_email && p.new_email.toLowerCase() !== String(cur[0].email || '').toLowerCase()
          ? p.new_email : null;

        await client.query(
          `UPDATE outreach_contacts
              SET email   = COALESCE($2, email),
                  company = COALESCE($3, company),
                  role    = COALESCE($4, role),
                  updated_at = NOW()
            WHERE id = $1`,
          [s.matched_contact_id, newEmail, p.new_company || null, p.role || null]
        );
        const bits = [
          newEmail && `email → ${newEmail}`,
          p.new_company && `company → ${p.new_company}`,
          p.role && `role → ${p.role}`,
        ].filter(Boolean);
        note = `Updated ${p.name || 'contact'}: ${bits.join(', ') || 'no field changes'}`;
      } else {
        const newId = await createLibraryContact(client, {
          name: p.name, email: p.new_email || p.current_email, company: p.new_company, role: p.role,
          source: `ooo-${s.origin || 'mailflow'}`,
        });
        before.created_contact_ids = [newId];
        note = `Created new contact ${p.name || p.new_email || ''} (no existing match)`;
        await client.query('UPDATE ooo_suggestions SET matched_contact_id = $2 WHERE id = $1', [id, newId]);
      }
    } else {
      const alts = Array.isArray(s.alt_contacts) ? s.alt_contacts : [];
      const pick = Array.isArray(opts.altIndexes) ? opts.altIndexes : alts.map((_, i) => i);
      const created = [];
      const createdIds = [];
      for (const i of pick) {
        const a = alts[i];
        if (!a || !(a.email || a.name)) continue;
        // An address OMI already holds is not a new contact. Silently adding a
        // duplicate is how a 20k library becomes unworkable, and the Cleanup
        // Centre then has to undo it by hand.
        if (a.email) {
          const { rows: dupe } = await client.query(
            'SELECT id FROM outreach_contacts WHERE lower(email) = lower($1) LIMIT 1', [a.email]
          );
          if (dupe.length) continue;
        }
        const newId = await createLibraryContact(client, {
          name: a.name, email: a.email, company: a.company, role: a.role,
          source: `ooo-${s.origin || 'mailflow'}`,
        });
        createdIds.push(newId);
        created.push(a.name || a.email);
      }
      before.created_contact_ids = createdIds;
      const skipped = pick.length - createdIds.length;
      note = createdIds.length
        ? `Added ${createdIds.length} contact(s): ${created.join(', ')}${skipped ? ` (${skipped} already on file)` : ''}`
        : `No contacts added${skipped ? ` (${skipped} already on file)` : ''}`;
    }

    await client.query(
      `UPDATE ooo_suggestions
          SET status = 'applied', applied_at = NOW(), applied_note = $2,
              applied_by = $3, before_state = $4::jsonb,
              undone_at = NULL, undone_by = NULL, updated_at = NOW()
        WHERE id = $1`,
      [id, note, opts.user || null, JSON.stringify(before)]
    );
    await client.query('COMMIT');
    return { id, status: 'applied', note };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Put back what an apply changed, using the before_state it recorded.
 *
 * Field updates are restored exactly. Contacts the apply created are deleted
 * only when nothing has been sent to them since -- once a contact has an
 * outreach send, deleting the row would take the send history with it, so those
 * are left in place and named in the note. A partial undo reported honestly is
 * worth more than a clean-looking one that quietly destroys history.
 */
async function undoSuggestion(id, opts = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM ooo_suggestions WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) { const e = new Error('Suggestion not found'); e.status = 404; throw e; }
    const s = rows[0];
    if (s.status !== 'applied') { const e = new Error('Only an applied suggestion can be undone'); e.status = 409; throw e; }
    const b = s.before_state || null;
    if (!b) {
      const e = new Error('No before-state was recorded for this apply, so it cannot be undone automatically.');
      e.status = 409; throw e;
    }

    const parts = [];
    if (b.contact_id && b.fields) {
      await client.query(
        `UPDATE outreach_contacts SET email = $2, company = $3, role = $4, updated_at = NOW() WHERE id = $1`,
        [b.contact_id, b.fields.email ?? null, b.fields.company ?? null, b.fields.role ?? null]
      );
      parts.push('restored the contact’s previous email, company and role');
    }
    const ids = Array.isArray(b.created_contact_ids) ? b.created_contact_ids : [];
    if (ids.length) {
      const { rows: kept } = await client.query(
        `SELECT c.id, c.name, c.email
           FROM outreach_contacts c
          WHERE c.id = ANY($1::uuid[])
            AND EXISTS (SELECT 1 FROM outreach_sends s WHERE s.contact_id = c.id)`,
        [ids]
      );
      const keptIds = new Set(kept.map((k) => k.id));
      const removable = ids.filter((i) => !keptIds.has(i));
      if (removable.length) {
        await client.query('DELETE FROM outreach_contacts WHERE id = ANY($1::uuid[])', [removable]);
        parts.push(`removed ${removable.length} contact(s) this had added`);
      }
      if (kept.length) {
        parts.push(`left ${kept.length} in place because mail has since been sent to them (${kept.map((k) => k.email || k.name).join(', ')})`);
      }
    }

    await client.query(
      `UPDATE ooo_suggestions
          SET status = 'pending', applied_at = NULL, applied_note = NULL,
              undone_at = NOW(), undone_by = $2, updated_at = NOW()
        WHERE id = $1`,
      [id, opts.user || null]
    );
    await client.query('COMMIT');
    return { id, status: 'pending', note: parts.length ? `Undone: ${parts.join('; ')}.` : 'Undone: nothing needed reverting.' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Apply several suggestions in one press.
 *
 * Each one is its own transaction, so a failure part-way leaves the successful
 * ones applied and reports the rest rather than rolling back work the reviewer
 * already approved. This is the "click go once over a reviewed list" path; the
 * review happens in the UI, and only ids explicitly ticked arrive here.
 */
async function applyBatch(ids, opts = {}) {
  const list = (Array.isArray(ids) ? ids : []).slice(0, 500);
  const results = [];
  for (const id of list) {
    try {
      results.push({ ...(await applySuggestion(id, opts)), ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err.message });
    }
  }
  return {
    applied: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

async function dismissSuggestion(id, opts = {}) {
  const { rowCount } = await pool.query(
    "UPDATE ooo_suggestions SET status = 'dismissed', applied_by = $2, updated_at = NOW() WHERE id = $1 AND status <> 'applied'",
    [id, opts.user || null]
  );
  if (!rowCount) { const e = new Error('Suggestion not found or already applied'); e.status = 404; throw e; }
  return { id, status: 'dismissed' };
}

// Counts for the queue badges — by status, and the pending split between a
// sender OMI knows and one it does not, because those are two different jobs.
async function counts() {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS n FROM ooo_suggestions GROUP BY status`
  );
  const out = { pending: 0, applied: 0, dismissed: 0 };
  for (const r of rows) out[r.status] = r.n;
  const { rows: split } = await pool.query(
    `SELECT sender_known, COUNT(*)::int AS n
       FROM ooo_suggestions WHERE status = 'pending' GROUP BY sender_known`
  );
  out.pending_known = split.find((r) => r.sender_known === true)?.n || 0;
  out.pending_unknown = split.find((r) => r.sender_known === false)?.n || 0;
  return out;
}

module.exports = {
  classify, classWeight, matchContact, upsertSuggestion,
  listSuggestions, applySuggestion, undoSuggestion, applyBatch,
  dismissSuggestion, counts,
};
