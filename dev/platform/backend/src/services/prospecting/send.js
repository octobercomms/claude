// Sending — the ONLY place a message leaves the system, and the last line of
// compliance defence. Every send re-checks the guardrails from scratch, because
// an approval can be hours old and the world may have changed (a fresh opt-out,
// a revoked identity). Nothing here can send without: an approved human action,
// an authenticated sending identity (SPF/DKIM/DMARC verified), a suppression
// re-check, and the daily cap. See docs/platform/outreach/PLAN.md.

const crypto = require('crypto');
const nodemailer = require('nodemailer');
const pool = require('../../db');
const suppression = require('./suppression');
const optout = require('./optout');
const draft = require('./draft');

// Build the transport for a sending identity. Outreach must never share the
// client's primary/reputation domain, so an identity SHOULD carry its own SMTP
// creds (smtp_json). If it doesn't, we fall back to the platform default
// transport — fine for October's own dogfooding, but a per-identity domain is
// the real deliverability design.
function transportFor(identity) {
  const cfg = identity && identity.smtp_json;
  if (cfg && cfg.host) {
    return nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port || 587,
      secure: cfg.secure ?? (cfg.port === 465),
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
  }
  const { buildTransporter } = require('../../routes/settings');
  return buildTransporter();
}

function fromHeader(identity) {
  const name = (identity.from_name || 'October').replace(/"/g, '');
  return `"${name}" <${identity.from_email}>`;
}

// Turn the drafted plain-text body into a compliant email. Appends the sender's
// postal address (CAN-SPAM / PECR) and a low-key, natural opt-out line if the
// draft didn't already include one. The one-click List-Unsubscribe header is set
// separately on the message. British, personal — a real 1:1 note, not a mailshot.
function composeBody(bodyText, { identity, optOutLink }) {
  const body = String(bodyText || '').trim();
  const hasOptOut = /(don'?t email|not email|unsubscribe|take you off|opt out|rather i didn'?t)/i.test(body);
  const optLine = hasOptOut
    ? ''
    : `\n\nIf you'd rather I didn't email again, just let me know and I'll take you off — or use this link: ${optOutLink}`;
  const address = identity.postal_address ? `\n\n${identity.postal_address}` : '';
  const text = `${body}${optLine}${address}`;
  // A minimal HTML part so the opt-out link is clickable; plain-text stays the
  // primary part (cold 1:1 email should look like plain text, not a template).
  const esc = (s) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;color:#111;white-space:pre-wrap;line-height:1.55;">${
    esc(text).replace(optOutLink, `<a href="${optOutLink}">${optOutLink}</a>`)
  }</div>`;
  return { text, html };
}

// Load everything needed to send one message: the message, its prospect, the
// campaign, and the campaign's sending identity — in one query.
async function loadContext(messageId) {
  const { rows } = await pool.query(
    `SELECT m.id AS message_id, m.state, m.subject, m.body, m.step, m.direction,
            p.id AS prospect_id, p.email, p.company, p.contact_name, p.role, p.one_fact,
            c.id AS campaign_id, c.client_id, c.name AS campaign_name, c.booking_url,
            c.daily_cap, c.sequence, c.icp,
            i.id AS identity_id, i.from_name, i.from_email, i.postal_address,
            i.smtp_json, i.auth_ok
       FROM prospecting_messages m
       JOIN prospecting_prospects p ON p.id = m.prospect_id
       JOIN prospecting_campaigns c ON c.id = p.campaign_id
       LEFT JOIN prospecting_identities i ON i.id = c.sender_identity_id
      WHERE m.id = $1`,
    [messageId]
  );
  return rows[0] || null;
}

// How many messages this campaign has already sent today (Europe/London day is
// close enough for a soft human-pacing cap; we compare on UTC calendar day).
async function sentTodayCount(campaignId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM prospecting_messages m
       JOIN prospecting_prospects p ON p.id = m.prospect_id
      WHERE p.campaign_id = $1 AND m.state = 'sent'
        AND m.sent_at >= date_trunc('day', NOW())`,
    [campaignId]
  );
  return rows[0]?.n || 0;
}

// Send one approved message. Returns { sent } | { deferred } | { skipped, reason }.
// All the compliance gates live here so there is exactly one enforced path.
async function sendMessage(messageId, { actor = 'system', ignoreCap = false } = {}) {
  const ctx = await loadContext(messageId);
  if (!ctx) return { skipped: true, reason: 'not-found' };
  if (ctx.direction !== 'out') return { skipped: true, reason: 'not-outbound' };
  if (ctx.state !== 'approved') return { skipped: true, reason: `state-${ctx.state}` };

  // Gate 1 — a verified sending identity. No auth (SPF/DKIM/DMARC), no send.
  if (!ctx.identity_id || !ctx.from_email) return { skipped: true, reason: 'no-identity' };
  if (!ctx.auth_ok) return { skipped: true, reason: 'identity-not-authenticated' };

  // Gate 2 — suppression re-check at the moment of send (an opt-out may have
  // landed after approval; an edited-and-approved message must not slip past).
  if (!ctx.email) return { skipped: true, reason: 'no-email' };
  if (await suppression.isSuppressed(ctx.client_id, ctx.email)) {
    await pool.query(`UPDATE prospecting_messages SET state = 'skipped' WHERE id = $1`, [messageId]);
    await audit(ctx.client_id, actor, 'skip', 'message', messageId, { reason: 'suppressed' });
    return { skipped: true, reason: 'suppressed' };
  }

  // Gate 3 — daily cap (human-paced, per campaign). Over cap → leave approved,
  // the next dispatch tick picks it up tomorrow.
  if (!ignoreCap) {
    const sent = await sentTodayCount(ctx.campaign_id);
    if (sent >= (ctx.daily_cap || 20)) return { deferred: true, reason: 'daily-cap' };
  }

  // Compose with the compliance furniture: opt-out link + postal address +
  // one-click List-Unsubscribe header.
  const token = await optout.tokenFor(ctx.prospect_id);
  const optOutLink = optout.optOutUrl(token);
  const { text, html } = composeBody(ctx.body, { identity: ctx, optOutLink });
  const transporter = transportFor(ctx);

  try {
    await transporter.sendMail({
      from: fromHeader(ctx),
      to: ctx.email,
      subject: ctx.subject || 'Quick note',
      text,
      html,
      headers: {
        'List-Unsubscribe': `<${optOutLink}>, <mailto:${ctx.from_email}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  } catch (err) {
    await audit(ctx.client_id, actor, 'send_failed', 'message', messageId, { error: err.message });
    throw err;
  }

  await pool.query(
    `UPDATE prospecting_messages SET state = 'sent', sent_at = NOW(), approved_by = COALESCE(approved_by, $2) WHERE id = $1`,
    [messageId, actor]
  );
  await pool.query(
    `UPDATE prospecting_prospects SET state = 'sequenced', updated_at = NOW()
      WHERE id = $1 AND state NOT IN ('opted_out', 'booked', 'replied')`,
    [ctx.prospect_id]
  );
  await audit(ctx.client_id, actor, 'send', 'message', messageId, {
    prospect_id: ctx.prospect_id, step: ctx.step, to: ctx.email,
  });

  // Queue the next sequence step as a DRAFT (pending approval) so the follow-up
  // re-enters the queue rather than auto-firing — the design principle.
  try { await queueNextStep(ctx); } catch (e) { console.warn('[prospecting] queueNextStep failed:', e.message); }

  return { sent: true };
}

// Draft the next step of the sequence (if any) and insert it as a pending
// message due `wait_days` after now. It will need a human approval like any
// other — nothing auto-sends.
async function queueNextStep(ctx) {
  const seq = Array.isArray(ctx.sequence) ? ctx.sequence : [];
  const nextStep = (ctx.step || 1) + 1;
  const spec = seq[nextStep - 1];
  if (!spec) return; // sequence complete

  // Don't queue a follow-up for a prospect who has since replied/opted out/booked.
  const { rows } = await pool.query('SELECT state FROM prospecting_prospects WHERE id = $1', [ctx.prospect_id]);
  if (!rows[0] || ['opted_out', 'replied', 'booked', 'dismissed'].includes(rows[0].state)) return;

  const campaign = { icp: ctx.icp, booking_url: ctx.booking_url, sequence: seq };
  const identity = { from_name: ctx.from_name, from_email: ctx.from_email };
  const prospect = { company: ctx.company, contact_name: ctx.contact_name, role: ctx.role, one_fact: ctx.one_fact };
  const d = await draft.draftOutbound({ prospect, campaign, identity, step: nextStep });
  const waitDays = Number(spec.wait_days) > 0 ? Number(spec.wait_days) : 3;
  const scheduledAt = new Date(Date.now() + waitDays * 24 * 3600 * 1000);
  await pool.query(
    `INSERT INTO prospecting_messages (prospect_id, direction, step, subject, body, state, scheduled_at, content_hash)
     VALUES ($1, 'out', $2, $3, $4, 'pending', $5, $6)`,
    [ctx.prospect_id, nextStep, d.subject, d.body, scheduledAt,
     crypto.createHash('sha1').update(`${d.subject}\n${d.body}`).digest('hex')]
  );
}

// Cron entry — dispatch every approved message that's due, oldest first,
// respecting each campaign's daily cap. Returns a small summary.
async function dispatchDue({ limit = 100, log = () => {} } = {}) {
  const { rows } = await pool.query(
    `SELECT m.id
       FROM prospecting_messages m
       JOIN prospecting_prospects p ON p.id = m.prospect_id
       JOIN prospecting_campaigns c ON c.id = p.campaign_id
      WHERE m.state = 'approved' AND m.direction = 'out'
        AND (m.scheduled_at IS NULL OR m.scheduled_at <= NOW())
        AND c.status = 'active'
      ORDER BY m.scheduled_at NULLS FIRST, m.created_at
      LIMIT $1`,
    [limit]
  );
  let sent = 0, deferred = 0, skipped = 0;
  for (const r of rows) {
    try {
      const out = await sendMessage(r.id, { actor: 'scheduler' });
      if (out.sent) sent++; else if (out.deferred) deferred++; else skipped++;
    } catch (e) { skipped++; log(`send ${r.id} failed: ${e.message}`); }
  }
  if (rows.length) log(`prospecting dispatch: ${sent} sent, ${deferred} deferred (cap), ${skipped} skipped`);
  return { due: rows.length, sent, deferred, skipped };
}

async function audit(clientId, actor, action, entity, entityId, detail) {
  try {
    await pool.query(
      `INSERT INTO prospecting_audit (client_id, actor, action, entity, entity_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [clientId, actor, action, entity, entityId, detail ? JSON.stringify(detail) : null]
    );
  } catch (e) { console.warn('[prospecting] audit failed:', e.message); }
}

module.exports = { sendMessage, dispatchDue, queueNextStep, audit, composeBody };
