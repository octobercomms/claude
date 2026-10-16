// Catching up on replies that arrived while nobody was reading the mailbox.
//
// The live poll (outreachReplies.pollReplies) looks back three days. That is
// the right window for stopping a follow-up before it goes out and useless for
// a backlog, and October had a backlog: press releases replied to press@ while
// the poll read hello@, so months of replies were never matched and never
// checked for opt-outs. Adding press@ to the mailbox list fixed everything
// from that moment on and nothing from before.
//
// Two steps on purpose. scan() reads a wide window and writes nothing to any
// send or contact; apply() is a person pressing go over what the scan found.
//
// Why there is no undo: both actions this proposes only ever STOP mail going
// out. Applying one wrongly costs a follow-up you would have liked to send.
// Reversing an opt-out would resume mail to someone who asked you to stop,
// which must never be one button press. The asymmetry is the safety argument,
// and it is why the review step guards the right direction.

const pool = require('../db');
const inboxes = require('./outreachInboxes');
const oooMailScan = require('./oooMailScan');
const replies = require('./outreachReplies');

/**
 * Which opt-out phrase this reply matched, or null.
 *
 * Mirrors outreachReplies.looksLikeUnsubscribe exactly — subject first, then
 * only the part the person actually wrote — but names the phrase, because an
 * opt-out applied on a bad match is the one mistake here that costs coverage
 * and "trust me, it's an opt-out" is not reviewable.
 */
function unsubPhrase(body, subject) {
  const subj = String(subject || '').toLowerCase().trim();
  for (const phrase of replies.UNSUB_PHRASES) {
    if (subj && subj.includes(phrase)) return phrase;
  }
  const own = replies.replyBodyOnly(body).toLowerCase();
  if (!own) return null;
  for (const phrase of replies.UNSUB_PHRASES) {
    if (own.includes(phrase)) return phrase;
  }
  return null;
}

/**
 * Everything this sender has open with us.
 *
 * Mirrors the live poll's matching: any send to this address that went out and
 * has not been marked replied. Sends already marked are returned too, so the
 * scan can tell "nothing to do" from "no relationship" and skip the former
 * without proposing a no-op.
 */
async function openSendsFor(email) {
  const { rows } = await pool.query(
    `SELECT s.id, s.campaign_id, s.contact_id, s.replied_at, s.sent_at,
            c.name AS contact_name, c.email AS contact_email,
            camp.name AS campaign_name, camp.client_id,
            cc.unsubscribed_at
       FROM outreach_sends s
       JOIN outreach_contacts c   ON c.id = s.contact_id
       JOIN outreach_campaigns camp ON camp.id = s.campaign_id
       LEFT JOIN outreach_contact_clients cc
              ON cc.contact_id = c.id AND cc.client_id = camp.client_id
      WHERE LOWER(c.email) = $1
        AND s.sent_at IS NOT NULL
      ORDER BY s.sent_at DESC`,
    [String(email || '').toLowerCase().trim()]
  );
  return rows;
}

/**
 * Read a window across the chosen mailboxes and record what WOULD be done.
 *
 * Writes only to outreach_reply_catchup. No send is marked, no contact is
 * suppressed, no follow-up is cancelled.
 *
 * Deliberately no AI classification: the live poll calls Claude for a summary,
 * which is fine on a trickle and real money across months of mail. Opt-out
 * detection here is the deterministic keyword pass, which is the
 * compliance-critical half and the half that has to be auditable anyway.
 */
async function scan({ days = 180, limit = 3000, inboxId = null, user = null } = {}) {
  const all = await inboxes.activeWithCredentials();
  const list = all.filter((i) => (inboxId ? i.id === inboxId : i.poll_replies !== false));
  if (!list.length) {
    return {
      skipped: all.length
        ? 'No mailbox is switched on for replies. Settings → Outreach → Mailboxes OMI reads.'
        : 'No mailbox is connected, so there is nothing to read. Settings → Outreach → Mailboxes OMI reads.',
    };
  }

  const windowDays = Math.min(1095, Math.max(1, Number(days) || 180));
  const cap = Math.min(20000, Math.max(1, Number(limit) || 3000));
  const { ImapFlow } = require('imapflow');

  let scanned = 0; let found = 0; let optOuts = 0; let alreadyHandled = 0;
  const per = [];
  const errors = [];

  for (const inbox of list) {
    const port = Number(inbox.port) || 993;
    const client = new ImapFlow({
      host: String(inbox.host).trim(), port, secure: port === 993,
      auth: { user: String(inbox.username).trim(), pass: String(inbox.password).trim() },
      logger: false,
    });
    let boxScanned = 0; let boxFound = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
        const uids = await client.search({ since }, { uid: true });
        const slice = (uids || []).slice(-cap).reverse();
        for await (const msg of client.fetch(slice, { envelope: true, source: true }, { uid: true })) {
          boxScanned += 1;
          const from = msg.envelope?.from?.[0];
          const email = from?.address ? from.address.toLowerCase().trim() : '';
          if (!email) continue;
          try {
            const r = await consider({ msg, email, inbox });
            if (r === 'found') { boxFound += 1; found += 1; }
            else if (r === 'opt_out') { boxFound += 1; found += 1; optOuts += 1; }
            else if (r === 'already') alreadyHandled += 1;
          } catch (err) {
            console.warn('[Reply catch-up]', inbox.label, email, err.message);
          }
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      // One unreachable mailbox must not abandon the others.
      errors.push(`${inbox.label}: ${err.message}`);
      console.warn('[Reply catch-up]', inbox.label, err.message);
    } finally {
      await client.logout().catch(() => {});
    }
    scanned += boxScanned;
    per.push({ inbox: inbox.label, scanned: boxScanned, found: boxFound });
  }

  return {
    window_days: windowDays, scanned, found, opt_outs: optOuts,
    already_handled: alreadyHandled, inboxes: per, errors,
  };
}

// One message: decide whether it proposes anything, and record it if so.
async function consider({ msg, email, inbox }) {
  const raw = msg.source ? msg.source.toString('utf8') : '';
  const { headers, body } = oooMailScan.splitRaw(raw);
  const subject = msg.envelope?.subject ? String(msg.envelope.subject) : '';
  const receivedAt = msg.envelope?.date || null;
  const key = oooMailScan.messageKey({ headers, fromEmail: email, subject, date: receivedAt });

  // Already proposed by an earlier scan. Re-scanning a wider window is cheap
  // and never duplicates.
  const { rows: seen } = await pool.query('SELECT 1 FROM outreach_reply_catchup WHERE message_key = $1', [key]);
  if (seen.length) return 'seen';

  const sends = await openSendsFor(email);
  if (!sends.length) return 'no_match';           // not someone we emailed

  const text = oooMailScan.toText(body);
  const phrase = unsubPhrase(text, subject);

  // An auto-reply is not a reply. The live poll marks them because it cannot
  // tell, which is arguably its own bug; repeating that across months of mail
  // would mark hundreds of out-of-office notices as engagement and cancel the
  // follow-ups behind them. Those messages are the out-of-office feed's job.
  const isAuto = require('./oooExtract').isAutoReply({ subject, headers });
  if (isAuto && !phrase) return 'auto_reply';

  const open = sends.filter((s) => !s.replied_at);
  const newest = open[0] || sends[0];
  const alreadyOut = newest.unsubscribed_at != null;

  const markReplied = open.length > 0;
  const doUnsub = Boolean(phrase) && !alreadyOut;
  if (!markReplied && !doUnsub) return 'already';   // nothing left to do

  await pool.query(
    `INSERT INTO outreach_reply_catchup
       (message_key, inbox_label, from_email, subject, received_at, snippet,
        contact_id, campaign_id, client_id, send_ids, mark_replied, unsubscribe, unsub_phrase)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],$11,$12,$13)
     ON CONFLICT (message_key) DO NOTHING`,
    [
      key, inbox.label, email, subject || null, receivedAt,
      replies.replyBodyOnly(text).slice(0, 600) || text.slice(0, 600),
      newest.contact_id, newest.campaign_id, newest.client_id,
      open.map((s) => s.id),
      markReplied, doUnsub, phrase,
    ]
  );
  return doUnsub ? 'opt_out' : 'found';
}

/** The review queue, opt-outs first because they are the compliance half. */
async function listItems({ status = 'pending', limit = 500 } = {}) {
  const { rows } = await pool.query(
    // r.* rather than a column list: this table holds no credentials and
    // nothing else secret, and spelling the columns out across four joins is
    // how an unqualified `id` becomes ambiguous at runtime.
    `SELECT r.*,
            c.name AS contact_name, c.email AS contact_email,
            camp.name AS campaign_name, cl.name AS client_name
       FROM outreach_reply_catchup r
       LEFT JOIN outreach_contacts c    ON c.id = r.contact_id
       LEFT JOIN outreach_campaigns camp ON camp.id = r.campaign_id
       LEFT JOIN clients cl             ON cl.id = r.client_id
      WHERE ($1::text IS NULL OR r.status = $1)
      ORDER BY (r.status = 'pending') DESC, r.unsubscribe DESC, r.received_at DESC NULLS LAST
      LIMIT $2`,
    [status || null, Math.min(2000, Math.max(1, limit))]
  );
  return rows;
}

async function counts() {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE unsubscribe)::int AS opt_outs
       FROM outreach_reply_catchup GROUP BY status`
  );
  const out = { pending: 0, applied: 0, dismissed: 0, pending_opt_outs: 0 };
  for (const r of rows) {
    out[r.status] = r.n;
    if (r.status === 'pending') out.pending_opt_outs = r.opt_outs;
  }
  return out;
}

/**
 * Apply one proposal.
 *
 * `replied_at` is set to the reply's OWN date, not now. Stamping months of
 * backlog with today's timestamp would tell the dashboard every journalist
 * replied this afternoon, which is a worse lie than the gap it is fixing.
 */
async function applyItem(id, opts = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM outreach_reply_catchup WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) { const e = new Error('Item not found'); e.status = 404; throw e; }
    const item = rows[0];
    if (item.status === 'applied') { await client.query('ROLLBACK'); return { id, status: 'applied', note: item.applied_note }; }

    const parts = [];
    const when = item.received_at || new Date();

    if (item.mark_replied && item.send_ids?.length) {
      const { rowCount } = await client.query(
        `UPDATE outreach_sends
            SET replied_at = $2, reply_text = COALESCE(reply_text, $3)
          WHERE id = ANY($1::uuid[]) AND replied_at IS NULL`,
        [item.send_ids, when, item.snippet]
      );
      if (rowCount) parts.push(`marked ${rowCount} send(s) replied`);

      // Same scope as the live poll: anything still queued for this contact
      // stops, across campaigns. Chasing someone who already answered is the
      // failure this whole feature exists to stop.
      const { rowCount: cancelled } = await client.query(
        `UPDATE outreach_sends SET status = 'cancelled'
          WHERE contact_id = $1 AND status = 'pending'`,
        [item.contact_id]
      );
      if (cancelled) parts.push(`cancelled ${cancelled} pending follow-up(s)`);
    }

    await client.query(
      `UPDATE outreach_reply_catchup
          SET status = 'applied', applied_at = NOW(), applied_by = $2, applied_note = $3
        WHERE id = $1`,
      [id, opts.user || null, parts.join(', ') || 'no change needed']
    );
    await client.query('COMMIT');

    // Suppression and the prospect state machine run outside the transaction,
    // because both are their own multi-statement operations with their own
    // guards and neither is safe to half-apply inside someone else's.
    if (item.unsubscribe && item.campaign_id && item.contact_id) {
      const fresh = await replies.suppressForCampaign(item.campaign_id, item.contact_id);
      if (fresh) parts.push('recorded the opt-out');
    }
    if (item.mark_replied && item.campaign_id && item.contact_id) {
      const prospectState = require('./outreachProspectState');
      await prospectState.markEvent(item.campaign_id, item.contact_id, 'replied').catch(() => {});
    }

    const note = parts.join(', ') || 'no change needed';
    await pool.query('UPDATE outreach_reply_catchup SET applied_note = $2 WHERE id = $1', [id, note]);
    return { id, status: 'applied', note };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Apply a reviewed set in one press.
 *
 * Each item is its own transaction, so a failure part-way leaves the
 * successful ones applied and reports the rest rather than rolling back work
 * already approved. Only ids the reviewer ticked arrive here; the server never
 * selects the set.
 */
async function applyBatch(ids, opts = {}) {
  const listed = (Array.isArray(ids) ? ids : []).slice(0, 2000);
  const results = [];
  for (const id of listed) {
    try { results.push({ ...(await applyItem(id, opts)), ok: true }); }
    catch (err) { results.push({ id, ok: false, error: err.message }); }
  }
  return {
    applied: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

async function dismiss(id, opts = {}) {
  const { rowCount } = await pool.query(
    `UPDATE outreach_reply_catchup SET status = 'dismissed', applied_by = $2
      WHERE id = $1 AND status <> 'applied'`,
    [id, opts.user || null]
  );
  if (!rowCount) { const e = new Error('Item not found or already applied'); e.status = 404; throw e; }
  return { id, status: 'dismissed' };
}

module.exports = { scan, listItems, counts, applyItem, applyBatch, dismiss, unsubPhrase, openSendsFor };
