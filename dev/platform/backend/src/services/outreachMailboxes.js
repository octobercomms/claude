// Per-client multi-mailbox rotation. Picks the next eligible mailbox
// for an outbound message — eligible = active, not in error, under
// today's cap, and not currently in warm-up cooldown.

const pool = require('../db');
const crypto = require('crypto');

// Reset the per-mailbox daily counter if the rolling 24h window has
// ticked over. Done lazily on read so we don't need a cron.
async function rollDayIfStale(mailboxId) {
  await pool.query(
    `UPDATE outreach_mailboxes
        SET daily_sent_count = 0,
            day_started_at   = NOW()
      WHERE id = $1
        AND day_started_at < NOW() - INTERVAL '24 hours'`,
    [mailboxId]
  );
}

// Current effective daily cap for a warming mailbox — climbs from
// 10/day on day 1 to target_daily_cap by warmup_days. Cold mailboxes
// start at the floor; warm mailboxes use target_daily_cap directly.
function effectiveCap(mailbox) {
  if (mailbox.warm_up_status === 'warm') return mailbox.target_daily_cap;
  if (mailbox.warm_up_status === 'paused' || mailbox.warm_up_status === 'error') return 0;
  if (!mailbox.warmup_started_at || !mailbox.warmup_days || mailbox.warmup_days <= 0) {
    return mailbox.daily_cap;
  }
  const start  = new Date(mailbox.warmup_started_at).getTime();
  const daysIn = Math.max(0, Math.floor((Date.now() - start) / 86400000));
  if (daysIn >= mailbox.warmup_days) return mailbox.target_daily_cap;
  const FLOOR = 10;
  const climb = FLOOR + (mailbox.target_daily_cap - FLOOR) * (daysIn / mailbox.warmup_days);
  return Math.floor(climb);
}

// Round-robin selection: of the eligible mailboxes for this client,
// pick the one with the oldest last_used_at (or never used). Returns
// null if no mailbox is eligible — caller should defer the send.
async function pickMailbox(clientId) {
  const { rows } = await pool.query(
    `SELECT *
       FROM outreach_mailboxes
      WHERE client_id = $1
        AND active = TRUE
        AND warm_up_status NOT IN ('paused', 'error')
      ORDER BY COALESCE(last_used_at, '1970-01-01'::timestamptz) ASC`,
    [clientId]
  );

  for (const mb of rows) {
    await rollDayIfStale(mb.id);
    const fresh = (await pool.query('SELECT * FROM outreach_mailboxes WHERE id = $1', [mb.id])).rows[0];
    if (fresh.daily_sent_count < effectiveCap(fresh)) return fresh;
  }
  return null;
}

// Record that a mailbox just sent a message — bumps the counter,
// stamps last_used_at, and is what makes the next pickMailbox call
// move on to the next sender in the rotation.
async function recordSend(mailboxId) {
  await pool.query(
    `UPDATE outreach_mailboxes
        SET daily_sent_count = daily_sent_count + 1,
            last_used_at     = NOW(),
            updated_at       = NOW()
      WHERE id = $1`,
    [mailboxId]
  );
}

// Mark a mailbox as errored — pulls it out of the rotation until the
// AM resets it. Called by the sender on SMTP 5xx / auth failure.
async function markError(mailboxId, message) {
  await pool.query(
    `UPDATE outreach_mailboxes
        SET warm_up_status = 'error',
            error_message  = $2,
            updated_at     = NOW()
      WHERE id = $1`,
    [mailboxId, message?.slice(0, 500) || 'SMTP error']
  );
}

// Encryption: SMTP passwords get encrypted at rest with the same
// AES-256-GCM key the rest of the platform uses for OAuth tokens.
function getEncryptKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY not configured');
  return crypto.scryptSync(raw, 'oc-outreach-mailbox', 32);
}
function encryptPassword(plaintext) {
  if (!plaintext) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}
function decryptPassword(encoded) {
  if (!encoded) return null;
  const buf = Buffer.from(encoded, 'base64');
  const iv  = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

module.exports = {
  pickMailbox, recordSend, markError, effectiveCap,
  encryptPassword, decryptPassword,
};
