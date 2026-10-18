const pool = require('../db');
const { getSetting } = require('../utils/settings');
const outreachAi = require('./outreachAi');
const oooMailScan = require('./oooMailScan');
const mimeText = require('./mimeText');
const inboxes = require('./outreachInboxes');
const budget = require('./budget');

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
function looksLikeUnsubscribe(body, subject) {
  // A mail client acting on List-Unsubscribe sends "unsubscribe" as the
  // SUBJECT with an empty body. Reading only the body missed every one of
  // those, which is how a journalist who pressed Unsubscribe in Gmail carried
  // on receiving follow-ups.
  const subj = String(subject || '').toLowerCase().trim();
  if (subj && UNSUB_PHRASES.some((phrase) => subj.includes(phrase))) return true;
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

/**
 * Current state of reply polling, for the UI.
 *
 * Keeps the flat fields the campaign screen's banner already reads, and adds
 * the per-mailbox detail. `addresses` is what a campaign's reply-to has to be
 * one of: with several mailboxes, "does the polled inbox match?" is a question
 * about a set, not a single value.
 */
async function pollState() {
  let rows = [];
  try { rows = await inboxes.list({ activeOnly: false }); } catch { /* table may predate this deploy */ }
  const live = rows.filter((r) => r.active && r.poll_replies !== false);

  let agg = {};
  try {
    const { rows: st } = await pool.query('SELECT * FROM outreach_reply_poll_state WHERE id = TRUE');
    agg = st[0] || {};
  } catch { /* treat as unknown */ }

  return {
    configured: live.length > 0,
    // One mailbox reads as before; several are listed, because naming only the
    // first would hide the one the operator is asking about.
    inbox: live.length ? live.map((r) => r.username).join(', ') : null,
    addresses: live.map((r) => String(r.username).trim().toLowerCase()),
    inboxes: rows.map((r) => ({
      id: r.id, label: r.label, username: r.username, host: r.host, active: r.active,
      poll_replies: r.poll_replies, scan_ooo: r.scan_ooo,
      known_senders_only: r.known_senders_only,
      last_run_at: r.last_run_at, last_ok_at: r.last_ok_at, last_match_at: r.last_match_at,
      last_error: r.last_error, scanned: r.scanned, matched: r.matched,
      unsubscribed: r.unsubscribed, ooo_queued: r.ooo_queued,
    })),
    last_run_at: agg.last_run_at || null,
    last_ok_at: agg.last_ok_at || null,
    last_match_at: agg.last_match_at || null,
    skipped_reason: agg.skipped_reason || null,
    last_error: agg.last_error || null,
    matched: agg.matched || 0,
    unsubscribed: agg.unsubscribed || 0,
  };
}

/**
 * Poll ONE mailbox. When a message arrives from a contact we've emailed, that
 * contact's outreach sends are marked replied and their pending follow-ups are
 * cancelled; an unsubscribe reply suppresses them.
 *
 * Takes the mailbox rather than reading settings, because October replies to
 * press@ while the old single setting pointed at hello@ — and unsubscribe
 * detection lives in this loop, so a mailbox nobody reads is a mailbox whose
 * opt-outs never happen.
 */
async function pollOneInbox(inbox) {
  const port = Number(inbox.port) || 993;

  // Loaded lazily so a missing optional dependency cannot crash startup.
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({
    host: String(inbox.host).trim(),
    port,
    secure: port === 993,
    auth: { user: String(inbox.username).trim(), pass: String(inbox.password).trim() },
    logger: false,
  });

  let matched = 0;
  let scanned = 0;
  let unsubscribed = 0;
  let oooQueued = 0;
  let lastMatchAt = null;

  // Our own sending domain, so an auto-reply quoting October's signature back
  // at us does not turn our own footer into a proposed contact.
  const sendingDomain = await getSetting('OUTREACH_SENDING_DOMAIN').catch(() => null);
  try {
    await client.connect();
  } catch (err) {
    await inboxes.recordState(inbox.id, { last_run_at: new Date(), last_error: inboxes.describeImapError(err, inbox) });
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

          // The readable text of the message, whatever shape it arrived in.
          // This used to be "everything after the first blank line, tags
          // stripped, whitespace collapsed", which on a multipart mail stored
          // the boundary and the part headers as the journalist's reply, never
          // decoded base64, and left the opt-out scan reading gibberish. Pass
          // the raw Buffer so the charset survives too.
          const raw = msg.source ? msg.source.toString('utf8') : '';
          const body = mimeText.bodyText(msg.source || raw).slice(0, 4000);

          // Read any lasting contact change out of the auto-reply. This runs
          // for every message, not only the ones matching a contact we emailed:
          // the whole point is to catch a stand-in named by someone we do not
          // yet hold. It queues a suggestion for review and never writes to a
          // contact, and it is wrapped because a malformed message must not be
          // able to stop reply polling -- unsubscribes depend on this loop.
          try {
            const res = inbox.scan_ooo === false ? null : await oooMailScan.ingestMessage({
              raw,
              source: msg.source || null,
              fromEmail: email,
              subject: msg.envelope?.subject ? String(msg.envelope.subject) : '',
              date: msg.envelope?.date || null,
              ownDomains: sendingDomain ? [sendingDomain] : [],
              // A personal or finance mailbox is mostly auto-replies from
              // people who will never be contacts. With this on it still
              // catches "my colleague has taken over" for someone already in
              // OMI, without burying the queue in supplier mail.
              knownSendersOnly: Boolean(inbox.known_senders_only),
            });
            if (res?.queued) oooQueued += 1;
          } catch (oooErr) {
            console.warn('[Outreach replies] out-of-office extraction failed:', oooErr.message);
          }

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
          const subject = msg.envelope && msg.envelope.subject ? String(msg.envelope.subject) : '';
          if (rows.length && looksLikeUnsubscribe(body, subject)) {
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
          //
          // Budgeted here rather than inside outreachAi, because that module
          // also serves two screens a person clicks and waits on; gating it
          // there would block them for a cap this cron loop spent. This is the
          // only unattended caller, so this is where the gate belongs.
          //
          // The gate deliberately wraps ONLY the classification. Everything
          // above it — marking the send replied, cancelling follow-ups,
          // deterministic opt-out detection, out-of-office extraction — is
          // free and runs regardless. A spending cap must never be able to
          // leave someone on a list after they asked to come off.
          const classifyAllowed = rows.length && body
            ? !(await budget.taskCapReached('press_replies'))
            : false;
          if (classifyAllowed) {
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
  await inboxes.recordState(inbox.id, {
    last_run_at: new Date(), last_ok_at: new Date(), last_error: null,
    scanned, matched, unsubscribed, ooo_queued: oooQueued,
    ...(lastMatchAt ? { last_match_at: lastMatchAt } : {}),
  });
  if (oooQueued) console.log(`[Outreach replies] ${inbox.label}: queued ${oooQueued} contact-change suggestion(s).`);
  return { inbox: inbox.label, matched, scanned, unsubscribed, oooQueued };
}

/**
 * Poll every mailbox that is switched on for replies.
 *
 * Each one is independent: a mailbox whose password has expired records its
 * own error and the rest are still read. Before this, one bad credential took
 * reply and unsubscribe handling down for everything.
 */
async function pollReplies() {
  const all = await inboxes.activeWithCredentials();
  const list = all.filter((i) => i.poll_replies !== false);
  if (!list.length) {
    const reason = all.length
      ? 'No mailbox is switched on for replies, so unsubscribe replies are not picked up.'
      : 'No mailbox is connected — reply polling is off, so unsubscribe replies are not picked up.';
    await recordPollState({ last_run_at: new Date(), skipped_reason: reason });
    return { skipped: reason };
  }

  let matched = 0; let scanned = 0; let unsubscribed = 0; let oooQueued = 0;
  let lastMatchAt = null;
  const results = [];
  const errors = [];

  for (const inbox of list) {
    try {
      const r = await pollOneInbox(inbox);
      results.push(r);
      matched += r.matched; scanned += r.scanned;
      unsubscribed += r.unsubscribed; oooQueued += r.oooQueued;
      if (r.matched) lastMatchAt = new Date();
    } catch (err) {
      errors.push(inboxes.describeImapError(err, inbox));
      console.warn('[Outreach replies]', inbox.label, err.message);
    }
  }

  // The single-row table predates per-mailbox state and still backs the
  // campaign screen's "is polling on?" banner, so keep it as the aggregate.
  await recordPollState({
    last_run_at: new Date(),
    last_ok_at: results.length ? new Date() : null,
    skipped_reason: null,
    last_error: errors.length ? errors.join(' | ') : null,
    scanned, matched, unsubscribed,
    ...(lastMatchAt ? { last_match_at: lastMatchAt } : {}),
  });

  return { matched, scanned, unsubscribed, oooQueued, inboxes: results, errors };
}

/**
 * One-off backfill: read further back than the reply poll does, for
 * out-of-office content only.
 *
 * pollReplies looks at three days, which is right for catching a reply before
 * the next follow-up goes out and useless for the months of auto-replies
 * already sitting in a mailbox. This reads a wider window and touches nothing
 * else: no send is marked replied and no unsubscribe is actioned, because
 * re-running those across a quarter of mail is not something a button should
 * do quietly.
 *
 * Runs every mailbox switched on for out-of-office scanning, or just the one
 * named by `inboxId`. The per-message watermark makes a re-run cheap, and the
 * same reply sitting in two mailboxes collapses to one suggestion.
 */
async function backfillOoo({ days = 90, limit = 2000, inboxId = null } = {}) {
  const all = await inboxes.activeWithCredentials();
  const list = all.filter((i) => (inboxId ? i.id === inboxId : i.scan_ooo !== false));
  if (!list.length) {
    return {
      skipped: all.length
        ? 'No mailbox is switched on for out-of-office scanning. Settings → Keys → Mailboxes.'
        : 'No mailbox is connected, so there is nothing to read. Settings → Keys → Mailboxes.',
    };
  }

  const windowDays = Math.min(730, Math.max(1, Number(days) || 90));
  const cap = Math.min(10000, Math.max(1, Number(limit) || 2000));
  const sendingDomain = await getSetting('OUTREACH_SENDING_DOMAIN').catch(() => null);
  const { ImapFlow } = require('imapflow');

  let scanned = 0; let queued = 0; let autoReplies = 0; let contacts = 0; let reread = 0;
  const per = [];
  const errors = [];

  for (const inbox of list) {
    const port = Number(inbox.port) || 993;
    const client = new ImapFlow({
      host: String(inbox.host).trim(), port, secure: port === 993,
      auth: { user: String(inbox.username).trim(), pass: String(inbox.password).trim() },
      logger: false,
    });
    let boxScanned = 0; let boxQueued = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
        const uids = await client.search({ since }, { uid: true });
        // Newest first, so a capped run covers the most useful end of the window.
        const slice = (uids || []).slice(-cap).reverse();
        for await (const msg of client.fetch(slice, { envelope: true, source: true }, { uid: true })) {
          boxScanned += 1;
          const from = msg.envelope?.from?.[0];
          const email = from?.address ? from.address.toLowerCase().trim() : '';
          if (!email) continue;
          try {
            const res = await oooMailScan.ingestMessage({
              raw: msg.source ? msg.source.toString('utf8') : '',
              source: msg.source || null,
              fromEmail: email,
              subject: msg.envelope?.subject ? String(msg.envelope.subject) : '',
              date: msg.envelope?.date || null,
              ownDomains: sendingDomain ? [sendingDomain] : [],
              knownSendersOnly: Boolean(inbox.known_senders_only),
            });
            if (res?.queued) { boxQueued += 1; contacts += res.contacts || 0; }
            // A suggestion recovered from a message an older reader had
            // already written off. Counted separately so the screen can show
            // that re-reading did something, rather than leaving it to faith.
            if (res?.queued && res?.reread) reread += 1;
            if (res?.queued || res?.skipped === 'nothing_extracted') autoReplies += 1;
          } catch (err) {
            console.warn('[OOO backfill]', inbox.label, email, err.message);
          }
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      // One unreachable mailbox must not abandon the others.
      errors.push(inboxes.describeImapError(err, inbox));
      console.warn('[OOO backfill]', inbox.label, err.message);
    } finally {
      await client.logout().catch(() => {});
    }
    scanned += boxScanned; queued += boxQueued;
    per.push({ inbox: inbox.label, scanned: boxScanned, queued: boxQueued });
  }

  return {
    window_days: windowDays, scanned, auto_replies: autoReplies,
    suggestions_queued: queued, contacts_proposed: contacts, recovered: reread,
    inboxes: per, errors,
  };
}

// UNSUB_PHRASES is exported so the reply catch-up can report WHICH phrase it
// matched, rather than a bare boolean. Duplicating the list there would let the
// two drift, and a catch-up that reads opt-outs differently from the live poll
// is worse than no catch-up.
module.exports = { pollReplies, pollOneInbox, pollState, looksLikeUnsubscribe, replyBodyOnly, suppressForCampaign, backfillOoo, UNSUB_PHRASES };
