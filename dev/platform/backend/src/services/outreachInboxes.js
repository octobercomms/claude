// The mailboxes OMI reads.
//
// One inbox was always a bug waiting to surface, and it surfaced the expensive
// way: October sends press releases with a reply-to of press@ while the poll
// read hello@, so replies to press@ were invisible. Because unsubscribe
// detection lives inside that same poll, journalists who replied "remove me"
// went on receiving follow-ups. The dashboard figure was the symptom; the
// suppression failure was the cost.
//
// Credentials are encrypted at rest with utils/encryption, the same treatment
// outreach_mailboxes gives SMTP passwords, and are decrypted only to open the
// IMAP socket.

const pool = require('../db');
const { encrypt, decrypt } = require('../utils/encryption');
const { getSetting } = require('../utils/settings');

// Columns safe to hand to the UI. password_enc never leaves this module.
const PUBLIC_COLUMNS = `id, label, host, port, username, active, poll_replies,
  scan_ooo, known_senders_only, last_run_at, last_ok_at, last_match_at,
  last_error, scanned, matched, unsubscribed, ooo_queued, created_at, updated_at`;

/**
 * Turn an ImapFlow error into something an operator can act on.
 *
 * "Command failed" on its own is what hello@ reported after a scan read zero
 * messages, and it says nothing: not which mailbox, not why, not what to do.
 * ImapFlow carries the server's own words in `responseText` and a status code
 * in `serverResponseCode`; both get surfaced, and the two causes that account
 * for nearly every Gmail failure get named outright.
 */
function describeImapError(err, inbox) {
  const parts = [];
  const msg = String(err?.message || 'Unknown error');
  parts.push(msg);
  if (err?.responseText && err.responseText !== msg) parts.push(`— ${err.responseText}`);
  if (err?.serverResponseCode) parts.push(`[${err.serverResponseCode}]`);

  if (err?.authenticationFailed || /AUTHENTICATIONFAILED|invalid credentials/i.test(msg + (err?.responseText || ''))) {
    parts.push('The username or app password was rejected. Gmail needs an app password, and a revoked one fails exactly like this.');
  } else if (/command failed/i.test(msg)) {
    parts.push('The server rejected the command. On Gmail this is almost always IMAP being switched off for the account (Gmail → Settings → Forwarding and POP/IMAP → Enable IMAP), or an app password that has since been revoked. Press Test on this mailbox to confirm.');
  }

  const where = inbox ? `${inbox.label} (${inbox.username})` : 'mailbox';
  return `${where}: ${parts.join(' ')}`;
}

function normHost(v) { return String(v || '').trim(); }
function normUser(v) { return String(v || '').trim(); }

/**
 * Adopt the legacy single-inbox settings as a row, once.
 *
 * The OUTREACH_IMAP_* settings predate this table and are still what the
 * running deploy uses. Reading them as a fallback only while the table is empty
 * would silently drop that mailbox the moment a second one was added, which is
 * the exact failure this feature exists to stop. So the first call copies them
 * into a row and records a flag, and from then on the table is the only source.
 */
async function importLegacyOnce() {
  const done = await getSetting('OUTREACH_INBOX_IMPORTED').catch(() => null);
  if (done === '1') return null;

  const [host, port, user, pass] = await Promise.all([
    getSetting('OUTREACH_IMAP_HOST'), getSetting('OUTREACH_IMAP_PORT'),
    getSetting('OUTREACH_IMAP_USER'), getSetting('OUTREACH_IMAP_PASSWORD'),
  ]).catch(() => [null, null, null, null]);

  // Nothing configured: mark it done anyway so a fresh install does not retry
  // these four reads on every poll forever.
  if (!host || !user || !pass) { await markImported(); return null; }

  try {
    const { rows } = await pool.query(
      `INSERT INTO outreach_inboxes (label, host, port, username, password_enc)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (lower(username), lower(host)) DO NOTHING
       RETURNING ${PUBLIC_COLUMNS}`,
      [normUser(user), normHost(host), Number(port) || 993, normUser(user), JSON.stringify(encrypt(String(pass)))]
    );
    await markImported();
    if (rows[0]) console.log(`[Inboxes] imported the existing IMAP settings as "${rows[0].label}".`);
    return rows[0] || null;
  } catch (err) {
    // A failed import must not stop the poll — it would take reply and
    // unsubscribe handling down with it.
    console.warn('[Inboxes] could not import the legacy IMAP settings:', err.message);
    return null;
  }
}

async function markImported() {
  try {
    await pool.query(
      `INSERT INTO platform_settings (key, value) VALUES ('OUTREACH_INBOX_IMPORTED', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(encrypt('1'))]
    );
  } catch (err) {
    console.warn('[Inboxes] could not record the legacy import flag:', err.message);
  }
}

/** Every mailbox, or only the ones switched on. Imports the legacy one first. */
async function list({ activeOnly = false } = {}) {
  await importLegacyOnce();
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM outreach_inboxes
      ${activeOnly ? 'WHERE active' : ''}
      ORDER BY created_at`
  );
  return rows;
}

/** A mailbox with its password decrypted, for opening a connection. */
async function withCredentials(id) {
  const { rows } = await pool.query('SELECT * FROM outreach_inboxes WHERE id = $1', [id]);
  if (!rows.length) return null;
  const row = rows[0];
  let password = null;
  try {
    password = decrypt(row.password_enc);
  } catch (err) {
    throw new Error(`The stored password for "${row.label}" could not be decrypted (${err.message}). Re-enter it in Settings.`);
  }
  return { ...row, password };
}

/** Every active mailbox, credentials included, for the poll to work through. */
async function activeWithCredentials() {
  const rows = await list({ activeOnly: true });
  const out = [];
  for (const r of rows) {
    try {
      out.push(await withCredentials(r.id));
    } catch (err) {
      // Record it against the mailbox and carry on; one unreadable credential
      // must not stop the others being polled.
      await recordState(r.id, { last_run_at: new Date(), last_error: err.message });
      console.warn('[Inboxes]', r.label, err.message);
    }
  }
  return out;
}

function assertFields({ label, host, username, password }, { requirePassword = true } = {}) {
  const missing = [];
  if (!String(label || '').trim()) missing.push('a label');
  if (!normHost(host)) missing.push('a host');
  if (!normUser(username)) missing.push('a username');
  if (requirePassword && !String(password || '')) missing.push('a password');
  if (missing.length) {
    const e = new Error(`That mailbox needs ${missing.join(', ')}.`);
    e.status = 400;
    throw e;
  }
}

async function create(input = {}) {
  assertFields(input);
  try {
    const { rows } = await pool.query(
      `INSERT INTO outreach_inboxes
         (label, host, port, username, password_enc, active, poll_replies, scan_ooo, known_senders_only)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
       RETURNING ${PUBLIC_COLUMNS}`,
      [
        String(input.label).trim(), normHost(input.host), Number(input.port) || 993,
        normUser(input.username), JSON.stringify(encrypt(String(input.password))),
        input.active !== false, input.poll_replies !== false, input.scan_ooo !== false,
        Boolean(input.known_senders_only),
      ]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const e = new Error('That mailbox is already on the list. Adding it twice would double every reply it carries.');
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

/** Patch a mailbox. A blank password leaves the stored one alone. */
async function update(id, input = {}) {
  const sets = [];
  const params = [id];
  const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  if (input.label !== undefined) push('label', String(input.label).trim());
  if (input.host !== undefined) push('host', normHost(input.host));
  if (input.port !== undefined) push('port', Number(input.port) || 993);
  if (input.username !== undefined) push('username', normUser(input.username));
  if (input.password) push('password_enc', JSON.stringify(encrypt(String(input.password))));
  for (const flag of ['active', 'poll_replies', 'scan_ooo', 'known_senders_only']) {
    if (input[flag] !== undefined) push(flag, Boolean(input[flag]));
  }
  if (!sets.length) { const e = new Error('Nothing to change.'); e.status = 400; throw e; }

  const { rows } = await pool.query(
    `UPDATE outreach_inboxes SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    params
  );
  if (!rows.length) { const e = new Error('Mailbox not found'); e.status = 404; throw e; }
  return rows[0];
}

async function remove(id) {
  const { rowCount } = await pool.query('DELETE FROM outreach_inboxes WHERE id = $1', [id]);
  if (!rowCount) { const e = new Error('Mailbox not found'); e.status = 404; throw e; }
  return { id, removed: true };
}

/** Write back what a poll did. Bookkeeping never throws into the poll. */
async function recordState(id, patch = {}) {
  const fields = ['last_run_at', 'last_ok_at', 'last_match_at', 'last_error',
    'scanned', 'matched', 'unsubscribed', 'ooo_queued'];
  const sets = [];
  const params = [id];
  for (const f of fields) {
    if (!(f in patch)) continue;
    params.push(patch[f]);
    sets.push(`${f} = $${params.length}`);
  }
  if (!sets.length) return;
  try {
    await pool.query(
      `UPDATE outreach_inboxes SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
      params
    );
  } catch (err) {
    console.warn('[Inboxes] could not record poll state:', err.message);
  }
}

/**
 * Open a connection and close it, so "Test" answers the only question that
 * matters before saving: will the poll be able to read this mailbox?
 *
 * Takes either an id (test what is stored) or raw fields (test before saving).
 */
async function testConnection(input = {}) {
  let host; let port; let username; let password; let label;
  if (input.id) {
    const row = await withCredentials(input.id);
    if (!row) { const e = new Error('Mailbox not found'); e.status = 404; throw e; }
    ({ host, port, username, password, label } = row);
  } else {
    assertFields(input);
    host = normHost(input.host); port = Number(input.port) || 993;
    username = normUser(input.username); password = String(input.password);
    label = input.label;
  }

  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({
    host, port, secure: port === 993, auth: { user: username, pass: password }, logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    let exists = 0;
    try { exists = client.mailbox?.exists ?? 0; } finally { lock.release(); }
    await client.logout().catch(() => {});
    return { ok: true, label, messages: exists };
  } catch (err) {
    await client.logout().catch(() => {});
    // Name the host, because "fetch failed" against an unnamed server is the
    // least useful error this platform has ever shown anyone.
    return { ok: false, label, error: `${describeImapError(err, { label, username })} (${host}:${port})` };
  }
}

module.exports = {
  list, create, update, remove, withCredentials, activeWithCredentials,
  recordState, testConnection, importLegacyOnce, describeImapError,
};
