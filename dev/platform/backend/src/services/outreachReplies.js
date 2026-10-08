const pool = require('../db');
const { getSetting } = require('../utils/settings');
const outreachAi = require('./outreachAi');

// Statuses that should suppress the contact entirely going forward.
const SUPPRESSING = new Set(['unsubscribe', 'not_relevant']);

// A reply that says "unsubscribe" and nothing else should not depend on an AI
// call. classifyReply needs a CLAUDE_API_KEY, costs a request, and can fail —
// and the whole classify block is wrapped in a catch that swallows the error,
// so a bad day there used to mean the opt-out was silently dropped and the
// journalist kept getting follow-ups. These phrases are unambiguous enough to
// act on directly; everything subtler still goes to the classifier.
const UNSUB_PHRASES = [
  'unsubscribe', 'unsub', 'opt out', 'opt-out', 'optout',
  'remove me', 'take me off', 'take me out of', 'delete me from',
  'stop emailing', 'stop e-mailing', 'stop sending', 'stop contacting',
  'no longer wish to receive', 'do not wish to receive', "don't wish to receive",
  'do not contact', "don't contact", 'please remove', 'remove from your list',
  'remove from the list', 'off your list', 'off this list', 'leave me alone',
];

/**
 * Does this reply plainly ask to be taken off the list?
 *
 * Deliberately checked against the part of the message the person actually
 * wrote. A quoted copy of our own email is appended to most replies, and ours
 * carries an unsubscribe link and the word "unsubscribe" in its footer — so
 * matching the whole body would mark every single reply as an opt-out,
 * including "yes, send me the images".
 */
function looksLikeUnsubscribe(body) {
  const own = replyBodyOnly(body).toLowerCase();
  if (!own) return false;
  return UNSUB_PHRASES.some((phrase) => own.includes(phrase));
}

/**
 * The part of a reply the sender typed, with the quoted original removed.
 * Handles the common markers: "On <date> X wrote:", a leading "> " quote block,
 * Gmail's divider, and the forwarded-message header.
 */
function replyBodyOnly(body) {
  let text = String(body || '');
  const cuts = [
    /\bOn\s.{0,120}?\bwrote:/i,
    /-{2,}\s*Original Message\s*-{2,}/i,
    /-{2,}\s*Forwarded message\s*-{2,}/i,
    /\bFrom:\s.{0,200}?\bSent:/i,
    /_{10,}/,
  ];
  for (const re of cuts) {
    const m = text.match(re);
    if (m && m.index > 0) text = text.slice(0, m.index);
  }
  return text.split(/\r?\n/).filter((l) => !l.trim().startsWith('>')).join(' ').trim();
}

/**
 * Unsubscribe a contact for the client whose campaign they replied to, and
 * cancel that client's pending sends to them. Per-client on purpose: a
 * journalist opting out of one client's press list is not opting out of every
 * client on the platform. Returns true only when this call was the one that
 * set the flag, so the poll's count is opt-outs rather than re-reads of an
 * inbox it already processed.
 */
async function suppressForCampaign(campaignId, contactId) {
  const { rows: camp } = await pool.query('SELECT client_id FROM outreach_campaigns WHERE id = $1', [campaignId]);
  const clientId = camp[0]?.client_id;
  if (!clientId) return false;
  const { rows } = await pool.query(
    `INSERT INTO outreach_contact_clients (contact_id, client_id, unsubscribed_at)
       VALUES ($1, $2, NOW())
     ON CONFLICT (contact_id, client_id)
       DO UPDATE SET unsubscribed_at = NOW()
       -- Only when they were not already unsubscribed. A conditional DO UPDATE
       -- returns no row when the WHERE fails, which is exactly "this call is
       -- what changed it" — and it keeps the original opt-out date rather than
       -- resetting it every time the inbox is re-read.
       WHERE outreach_contact_clients.unsubscribed_at IS NULL
     RETURNING 1`,
    [contactId, clientId]
  );
  const fresh = rows.length > 0;
  // Stop anything still queued for them on this client. The dispatch gate
  // re-checks unsubscribed_at anyway, but leaving the rows pending makes the
  // results screen claim emails are still going out to someone who opted out.
  await pool.query(
    `UPDATE outreach_sends s SET status = 'cancelled'
       FROM outreach_campaigns c
      WHERE s.campaign_id = c.id AND c.client_id = $1
        AND s.contact_id = $2 AND s.status = 'pending'`,
    [clientId, contactId]
  );
  return fresh;
}

/** Record what the poll did, so the UI can say whether it is working. */
async function recordPollState(patch) {
  const fields = ['last_run_at', 'last_ok_at', 'last_match_at', 'skipped_reason', 'last_error', 'scanned', 'matched', 'unsubscribed'];
  const sets = [];
  const params = [];
  for (const f of fields) {
    if (!(f in patch)) continue;
    params.push(patch[f]);
    sets.push(`${f} = $${params.length}`);
  }
  if (!sets.length) return;
  try {
    await pool.query(
      `INSERT INTO outreach_reply_poll_state (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING`);
    await pool.query(
      `UPDATE outreach_reply_poll_state SET ${sets.join(', ')}, updated_at = NOW() WHERE id = TRUE`,
      params
    );
  } catch (err) {
    // Never let bookkeeping break the poll itself.
    console.warn('[Outreach replies] could not record poll state:', err.message);
  }
}

/** Current state of reply polling, for the UI. */
async function pollState() {
  const [host, user, pass] = await Promise.all([
    getSetting('OUTREACH_IMAP_HOST'), getSetting('OUTREACH_IMAP_USER'), getSetting('OUTREACH_IMAP_PASSWORD'),
  ]);
  const configured = !!(host && user && pass);
  let row = {};
  try {
    const { rows } = await pool.query('SELECT * FROM outreach_reply_poll_state WHERE id = TRUE');
    row = rows[0] || {};
  } catch { /* table may not exist on an old deploy — treat as unknown */ }
  return {
    configured,
    // The address replies have to arrive at for the poll to see them. Shown so
    // a mismatch with the campaign's reply-to is visible rather than mysterious.
    inbox: configured ? String(user).trim() : null,
    last_run_at: row.last_run_at || null,
    last_ok_at: row.last_ok_at || null,
    last_match_at: row.last_match_at || null,
    skipped_reason: row.skipped_reason || null,
    last_error: row.last_error || null,
    matched: row.matched || 0,
    unsubscribed: row.unsubscribed || 0,
  };
}

// Polls the outreach reply inbox over IMAP. When a message arrives from a
// contact we've emailed, that contact's outreach sends are marked replied
// and their pending follow-ups are cancelled.
async function pollReplies() {
  const host = await getSetting('OUTREACH_IMAP_HOST');
  const user = await getSetting('OUTREACH_IMAP_USER');
  const pass = await getSetting('OUTREACH_IMAP_PASSWORD');
  if (!host || !user || !pass) {
    const reason = 'IMAP not configured — reply polling is off, so unsubscribe replies are not picked up.';
    await recordPollState({ last_run_at: new Date(), skipped_reason: reason });
    return { skipped: reason };
  }
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
  let scanned = 0;
  let unsubscribed = 0;
  let lastMatchAt = null;
  try {
    await client.connect();
  } catch (err) {
    await recordPollState({ last_run_at: new Date(), last_error: err.message, skipped_reason: null });
    throw err;
  }
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const uids = await client.search({ since }, { uid: true });
      if (uids && uids.length) {
        for await (const msg of client.fetch(uids, { envelope: true, source: true }, { uid: true })) {
          scanned += 1;
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
          if (rows.length) { matched += 1; lastMatchAt = new Date(); }

          // Phase 2: feed the reply into the per-prospect state
          // machine — auto-pauses the sequence so we don't keep
          // chasing someone who already responded.
          if (rows.length) {
            const prospectState = require('./outreachProspectState');
            for (const r of rows) {
              await prospectState.markEvent(r.campaign_id, r.contact_id, 'replied').catch(() => {});
            }
          }

          // An unmistakable opt-out acts on its own, before and regardless of
          // the classifier. The AI pass below still runs for the summary and
          // for the subtler cases, but the journalist's follow-ups stop here
          // even if it is unavailable, unfunded, or wrong.
          if (rows.length && body && looksLikeUnsubscribe(body)) {
            try {
              const done = await suppressForCampaign(rows[0].campaign_id, rows[0].contact_id);
              if (done) {
                unsubscribed += 1;
                await pool.query(
                  `UPDATE outreach_sends SET reply_classification = COALESCE(reply_classification, 'unsubscribe')
                    WHERE id = ANY($1::uuid[])`,
                  [rows.map((r) => r.id)]
                );
                console.log(`[Outreach replies] ${email} asked to be removed — unsubscribed for this client.`);
              }
            } catch (err) {
              console.warn('[Outreach replies] keyword unsubscribe failed:', err.message);
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
                  if (await suppressForCampaign(rows[0].campaign_id, rows[0].contact_id)) unsubscribed += 1;
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
  await recordPollState({
    last_run_at: new Date(), last_ok_at: new Date(),
    skipped_reason: null, last_error: null,
    scanned, matched, unsubscribed,
    ...(lastMatchAt ? { last_match_at: lastMatchAt } : {}),
  });
  return { matched, scanned, unsubscribed };
}

module.exports = { pollReplies, pollState, looksLikeUnsubscribe, replyBodyOnly, suppressForCampaign };
