// Suppression — the hard "never contact" list, checked at BOTH scoring and send.
// Opt-outs, existing clients, and disqualified entities live here permanently.

const pool = require('../../db');

function emailDomain(email) {
  const m = String(email || '').toLowerCase().match(/@([^@\s]+)$/);
  return m ? m[1] : null;
}

// Is this email (or its domain) suppressed for this client?
async function isSuppressed(clientId, email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return false;
  const dom = emailDomain(e);
  const { rows } = await pool.query(
    `SELECT 1 FROM prospecting_suppression
      WHERE client_id = $1 AND (
        (kind = 'email' AND value = $2) OR
        (kind = 'domain' AND value = $3)
      ) LIMIT 1`,
    [clientId, e, dom]
  );
  return rows.length > 0;
}

async function add(clientId, value, { kind, reason } = {}) {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return;
  const k = kind || (v.includes('@') ? 'email' : 'domain');
  await pool.query(
    `INSERT INTO prospecting_suppression (client_id, value, kind, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id, value) DO NOTHING`,
    [clientId, v, k, reason || 'manual']
  );
}

async function list(clientId) {
  const { rows } = await pool.query(
    'SELECT id, value, kind, reason, created_at FROM prospecting_suppression WHERE client_id = $1 ORDER BY created_at DESC',
    [clientId]
  );
  return rows;
}

async function remove(clientId, id) {
  await pool.query('DELETE FROM prospecting_suppression WHERE client_id = $1 AND id = $2', [clientId, id]);
}

module.exports = { isSuppressed, add, list, remove, emailDomain };
