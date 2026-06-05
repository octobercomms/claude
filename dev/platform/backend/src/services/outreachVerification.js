// Outreach contact verification. Wraps the underlying verifier
// (currently Hunter.io, swappable later) and persists the result on
// the outreach_contacts row so downstream consumers — the sender, the
// UI badge, the contact import flow — can read the cached state
// without re-hitting the API.

const { pool } = require('../utils/db');
const hunter = require('./hunter');

// How long a verification is considered "fresh" before we'd re-verify
// on the next send. 30 days matches Hunter's caching guidance and
// keeps the credit spend predictable.
const FRESH_TTL_MS = 30 * 24 * 3600 * 1000;

// Verify a single contact and persist the result. Returns the
// verification record. If the contact has a recent verification
// (within FRESH_TTL_MS) we skip the API call and return the cached
// result, unless force=true.
async function verifyContact(contactId, { force = false } = {}) {
  const { rows } = await pool.query(
    'SELECT id, email, verification_status, verification_score, verification_provider, last_verified_at FROM outreach_contacts WHERE id = $1',
    [contactId]
  );
  const contact = rows[0];
  if (!contact) throw new Error('Contact not found');
  if (!contact.email) throw new Error('Contact has no email');

  // Cache hit
  if (!force && contact.last_verified_at) {
    const age = Date.now() - new Date(contact.last_verified_at).getTime();
    if (age < FRESH_TTL_MS) {
      return {
        contact_id: contactId,
        status: contact.verification_status,
        score: contact.verification_score,
        provider: contact.verification_provider,
        cached: true,
      };
    }
  }

  const result = await hunter.verifyEmail(contact.email);

  await pool.query(
    `UPDATE outreach_contacts SET
       verification_status   = $1,
       verification_score    = $2,
       verification_provider = $3,
       verification_detail   = $4,
       last_verified_at      = NOW()
     WHERE id = $5`,
    [result.status, result.score, result.provider, JSON.stringify(result.detail), contactId]
  );

  return { contact_id: contactId, ...result, cached: false };
}

// Bulk verify all unverified or stale contacts for a client. Used
// from the Contacts tab "Verify all" button. Returns counts.
async function verifyClient(clientId, { force = false } = {}) {
  const cutoff = new Date(Date.now() - FRESH_TTL_MS).toISOString();
  const filter = force
    ? 'WHERE client_id = $1 AND email IS NOT NULL'
    : 'WHERE client_id = $1 AND email IS NOT NULL AND (last_verified_at IS NULL OR last_verified_at < $2)';
  const params = force ? [clientId] : [clientId, cutoff];

  const { rows } = await pool.query(
    `SELECT DISTINCT c.id
       FROM outreach_contacts c
       JOIN outreach_campaign_contacts cc ON cc.contact_id = c.id
       JOIN outreach_campaigns cmp        ON cmp.id = cc.campaign_id
       ${filter.replace('client_id', 'cmp.client_id')}`,
    params
  );

  const counts = { valid: 0, risky: 0, invalid: 0, unknown: 0, errored: 0 };
  for (const row of rows) {
    try {
      const r = await verifyContact(row.id, { force });
      counts[r.status] = (counts[r.status] || 0) + 1;
    } catch (e) {
      counts.errored += 1;
    }
  }
  return { checked: rows.length, ...counts };
}

// Should we send to this contact right now? The sender calls this
// just before composing the message. Returns { ok, reason } where
// reason is human-readable for the AM if we block.
async function shouldSend(contactId) {
  const { rows } = await pool.query(
    'SELECT verification_status, last_verified_at, email FROM outreach_contacts WHERE id = $1',
    [contactId]
  );
  const c = rows[0];
  if (!c) return { ok: false, reason: 'contact not found' };
  if (!c.email) return { ok: false, reason: 'no email address' };

  // Re-verify on the fly if stale or pending — the credit is cheap
  // vs. damaging the sender domain reputation by hitting a known-bad
  // address.
  const stale = !c.last_verified_at || (Date.now() - new Date(c.last_verified_at).getTime() > FRESH_TTL_MS);
  if (stale || c.verification_status === 'pending') {
    try {
      const r = await verifyContact(contactId);
      if (r.status === 'invalid') return { ok: false, reason: 'failed verification (invalid)' };
      return { ok: true, status: r.status };
    } catch (e) {
      // Verifier offline — allow send but log; better than blocking
      // the whole campaign on a transient error.
      return { ok: true, status: 'unknown', warning: `verifier error: ${e.message}` };
    }
  }

  if (c.verification_status === 'invalid') return { ok: false, reason: 'last verification: invalid' };
  return { ok: true, status: c.verification_status };
}

module.exports = { verifyContact, verifyClient, shouldSend, FRESH_TTL_MS };
