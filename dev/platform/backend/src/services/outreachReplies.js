const pool = require('../db');
const { getSetting } = require('../utils/settings');
const outreachAi = require('./outreachAi');

// Statuses that should suppress the contact entirely going forward.
const SUPPRESSING = new Set(['unsubscribe', 'not_relevant']);

// Polls the outreach reply inbox over IMAP. When a message arrives from a
// contact we've emailed, that contact's outreach sends are marked replied
// and their pending follow-ups are cancelled.
async function pollReplies() {
  const host = await getSetting('OUTREACH_IMAP_HOST');
  const user = await getSetting('OUTREACH_IMAP_USER');
  const pass = await getSetting('OUTREACH_IMAP_PASSWORD');
  if (!host || !user || !pass) return { skipped: 'IMAP not configured' };
  const port = Number(await getSetting('OUTREACH_IMAP_PORT')) || 993;

  // Loaded lazily so a missing optional dependency cannot crash startup.
  const { ImapFlow } = require('imapflow');
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
        for await (const msg of client.fetch(uids, { envelope: true, source: true }, { uid: true })) {
          const from = msg.envelope && msg.envelope.from && msg.envelope.from[0];
          const email = from && from.address ? from.address.toLowerCase().trim() : '';
          if (!email) continue;

          // Strip the headers off so we only pass the body to the classifier.
          const raw = msg.source ? msg.source.toString('utf8') : '';
          const split = raw.indexOf('\r\n\r\n');
          const body = (split >= 0 ? raw.slice(split + 4) : raw)
            .replace(/=\r?\n/g, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 4000);

          const { rows } = await pool.query(
            `UPDATE outreach_sends s SET replied_at = NOW(), reply_text = $2
               FROM outreach_contacts c
              WHERE s.contact_id = c.id
                AND LOWER(c.email) = $1
                AND s.replied_at IS NULL
                AND s.sent_at IS NOT NULL
              RETURNING s.id, s.campaign_id, s.contact_id`,
            [email, body || null]
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

          // Phase 2: feed the reply into the per-prospect state
          // machine — auto-pauses the sequence so we don't keep
          // chasing someone who already responded.
          if (rows.length) {
            const prospectState = require('./outreachProspectState');
            for (const r of rows) {
              await prospectState.markEvent(r.campaign_id, r.contact_id, 'replied').catch(() => {});
            }
          }

          // Best-effort classify — never let it block the poll.
          if (rows.length && body) {
            try {
              const { rows: camp } = await pool.query(
                'SELECT name FROM outreach_campaigns WHERE id = $1',
                [rows[0].campaign_id]
              );
              const result = await outreachAi.classifyReply({ replyText: body, campaignName: camp[0]?.name });
              if (result) {
                await pool.query(
                  `UPDATE outreach_sends SET reply_classification = $1, reply_summary = $2
                    WHERE id = ANY($3::uuid[])`,
                  [result.classification, result.summary, rows.map(r => r.id)]
                );
                if (SUPPRESSING.has(result.classification)) {
                  // Per-client suppression — only mark this contact as
                  // unsubscribed for the client whose campaign they
                  // replied to. Other clients' lists are untouched.
                  const { rows: campRows } = await pool.query(
                    'SELECT client_id FROM outreach_campaigns WHERE id = $1',
                    [rows[0].campaign_id]
                  );
                  const clientId = campRows[0]?.client_id;
                  if (clientId) {
                    await pool.query(
                      `INSERT INTO outreach_contact_clients (contact_id, client_id, unsubscribed_at)
                         VALUES ($1, $2, NOW())
                       ON CONFLICT (contact_id, client_id)
                         DO UPDATE SET unsubscribed_at = COALESCE(outreach_contact_clients.unsubscribed_at, NOW())`,
                      [rows[0].contact_id, clientId]
                    );
                  }
                  if (result.classification === 'not_relevant') {
                    // Global do-not-contact for "wrong fit entirely" replies —
                    // unsubscribe is per-client but a definitive "not relevant"
                    // should suppress them everywhere as well.
                    await pool.query(
                      `UPDATE outreach_contacts SET status = 'do_not_contact', updated_at = NOW() WHERE id = $1`,
                      [rows[0].contact_id]
                    );
                  }
                }
              }
            } catch (classifyErr) {
              console.warn('[Outreach replies] classification failed:', classifyErr.message);
            }
          }
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
