const { ImapFlow } = require('imapflow');
const pool = require('../db');
const { getSetting } = require('../utils/settings');

// Polls the outreach reply inbox over IMAP. When a message arrives from a
// contact we've emailed, that contact's outreach sends are marked replied
// and their pending follow-ups are cancelled.
async function pollReplies() {
  const host = await getSetting('OUTREACH_IMAP_HOST');
  const user = await getSetting('OUTREACH_IMAP_USER');
  const pass = await getSetting('OUTREACH_IMAP_PASSWORD');
  if (!host || !user || !pass) return { skipped: 'IMAP not configured' };
  const port = Number(await getSetting('OUTREACH_IMAP_PORT')) || 993;

  const client = new ImapFlow({
    host: host.trim(),
    port,
    secure: port === 993,
    auth: { user: user.trim(), pass: pass.trim() },
    logger: false,
  });

  let matched = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const uids = await client.search({ since }, { uid: true });
      if (uids && uids.length) {
        for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
          const from = msg.envelope && msg.envelope.from && msg.envelope.from[0];
          const email = from && from.address ? from.address.toLowerCase().trim() : '';
          if (!email) continue;

          const { rows } = await pool.query(
            `UPDATE outreach_sends s SET replied_at = NOW()
               FROM outreach_contacts c
              WHERE s.contact_id = c.id
                AND LOWER(c.email) = $1
                AND s.replied_at IS NULL
                AND s.sent_at IS NOT NULL
              RETURNING s.id`,
            [email]
          );
          await pool.query(
            `UPDATE outreach_sends s SET status = 'cancelled'
               FROM outreach_contacts c
              WHERE s.contact_id = c.id
                AND LOWER(c.email) = $1
                AND s.status = 'pending'`,
            [email]
          );
          if (rows.length) matched += 1;
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return { matched };
}

module.exports = { pollReplies };
