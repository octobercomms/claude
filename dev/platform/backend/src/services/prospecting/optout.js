// Opt-out — the genuine, instant, permanent "don't email me again" path. Backs
// both the natural-language line in every message and the invisible
// List-Unsubscribe one-click header. An easy opt-out is what PREVENTS spam
// complaints (which is what actually destroys a sending domain), so this is a
// first-class control, not an afterthought.
//
// The token is the credential: a random, unguessable id stored per prospect. No
// auth on the public endpoint — holding the link is proof enough, and the worst
// case (someone opts a prospect out early) is fail-safe: we never email again.

const crypto = require('crypto');
const pool = require('../../db');
const suppression = require('./suppression');

function platformUrl() {
  return (process.env.PLATFORM_URL || 'https://platform.octobercomms.com').replace(/\/$/, '');
}

// Get (or mint) the stable opt-out token for a prospect. One token per prospect,
// reused across every message so a link in an old email keeps working.
async function tokenFor(prospectId) {
  const { rows } = await pool.query(
    'SELECT token FROM prospecting_optout_tokens WHERE prospect_id = $1 LIMIT 1',
    [prospectId]
  );
  if (rows[0]) return rows[0].token;
  const token = crypto.randomBytes(24).toString('hex');
  await pool.query(
    'INSERT INTO prospecting_optout_tokens (token, prospect_id) VALUES ($1, $2)',
    [token, prospectId]
  );
  return token;
}

function optOutUrl(token) {
  return `${platformUrl()}/api/prospecting-optout?t=${encodeURIComponent(token)}`;
}

// Resolve a token → the prospect + its client, or null if unknown.
async function resolveToken(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const { rows } = await pool.query(
    `SELECT p.id AS prospect_id, p.email, p.company, c.client_id
       FROM prospecting_optout_tokens o
       JOIN prospecting_prospects p ON p.id = o.prospect_id
       JOIN prospecting_campaigns c ON c.id = p.campaign_id
      WHERE o.token = $1 LIMIT 1`,
    [t]
  );
  return rows[0] || null;
}

// Honour an opt-out: suppress the address permanently, mark the prospect, and
// cancel anything still queued for them. Idempotent — safe to call twice.
async function optOut(token, { actor = 'recipient' } = {}) {
  const who = await resolveToken(token);
  if (!who) return { ok: false, reason: 'unknown-token' };
  if (who.email) {
    await suppression.add(who.client_id, who.email, { kind: 'email', reason: 'opted_out' });
  }
  await pool.query(
    `UPDATE prospecting_prospects SET state = 'opted_out', updated_at = NOW() WHERE id = $1`,
    [who.prospect_id]
  );
  // Nothing further sends: kill every not-yet-sent message for this prospect.
  await pool.query(
    `UPDATE prospecting_messages SET state = 'skipped'
      WHERE prospect_id = $1 AND state IN ('pending', 'approved')`,
    [who.prospect_id]
  );
  await pool.query(
    `INSERT INTO prospecting_audit (client_id, actor, action, entity, entity_id, detail)
     VALUES ($1, $2, 'opt_out', 'prospect', $3, $4)`,
    [who.client_id, actor, who.prospect_id, JSON.stringify({ email: who.email })]
  );
  return { ok: true, email: who.email, company: who.company };
}

module.exports = { tokenFor, optOutUrl, resolveToken, optOut, platformUrl };
