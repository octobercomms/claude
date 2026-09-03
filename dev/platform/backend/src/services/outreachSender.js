// Composes and sends October Email (cold outreach + press release)
// emails. Prefers Amazon SES v2 over the SES SMTP transport when API
// credentials are set — the SES API is lower latency, gives richer
// error responses, and supports the custom headers we need for the
// one-click unsubscribe Gmail and Yahoo now require for senders.
const crypto = require('crypto');
const { getSetting } = require('../utils/settings');

// HMAC-signed unsubscribe URL. Stateless — no token to store per
// contact, the signature verifies on-the-fly in the public route.
// clientId is encoded so the unsubscribe only affects that client's
// membership row, not the journalist's other client relationships.
// Includes an `exp` epoch so a leaked token expires; the verifier in
// routes/unsubscribe.js accepts the timestamped form AND the legacy
// deterministic form for backwards-compat with already-sent emails.
function unsubscribeUrl(contactId, clientId) {
  const base = (process.env.PLATFORM_URL || '').replace(/\/$/, '');
  if (!base || !process.env.JWT_SECRET) return null;
  // 365-day expiry — journalists sometimes unsubscribe months after the
  // first send, but a 5-year-old leaked URL shouldn't still work.
  const exp = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const payload = clientId ? `unsub:${contactId}:${clientId}:${exp}` : `unsub:${contactId}::${exp}`;
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('hex').slice(0, 32);
  const params = new URLSearchParams({ c: contactId, s: sig, e: String(exp) });
  if (clientId) params.set('cl', clientId);
  return `${base}/api/unsubscribe?${params.toString()}`;
}

// HMAC token binding sendId + kind to the JWT_SECRET, used on the open
// pixel and click tracker. Without this, an attacker can enumerate
// outreach_sends UUIDs by hitting /track/open/<uuid> and learning which
// returns 200 — confirming both delivery and the existence of a send
// row for that recipient. The signature is short (24 hex chars) so it
// doesn't blow out the email URL length but still has ~96 bits of
// entropy. dest is only signed for click tokens so the tracker can also
// refuse open redirects to URLs not present at send time.
function signTrackToken({ sendId, kind, dest = null }) {
  if (!process.env.JWT_SECRET) return '';
  const payload = dest
    ? `track:${kind}:${sendId}:${dest}`
    : `track:${kind}:${sendId}`;
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('hex').slice(0, 24);
}

function fillTemplate(text, contact) {
  const first = (contact.first_name || contact.name || '').trim().split(/\s+/)[0] || 'there';
  const last = (contact.last_name || '').trim();
  return String(text || '')
    .replace(/\{\{\s*first_name\s*\}\}/gi, first)
    .replace(/\{\{\s*last_name\s*\}\}/gi, last)
    .replace(/\{\{\s*name\s*\}\}/gi, contact.name || [first, last].filter(Boolean).join(' ') || 'there')
    .replace(/\{\{\s*company\s*\}\}/gi, contact.company || '');
}

async function senderFields(sending) {
  const cfg = sending || {};
  const fromEmail = cfg.from_email
    || (await getSetting('SES_FROM_EMAIL'))
    || process.env.SES_FROM_EMAIL
    || process.env.GMAIL_USER;
  const fromName = cfg.from_name || 'October Communications';
  return {
    fromEmail,
    fromName,
    from: fromEmail ? `"${fromName}" <${fromEmail}>` : undefined,
    replyTo: cfg.reply_to || (await getSetting('OUTREACH_DEFAULT_REPLY_TO')) || undefined,
  };
}

// Rewrite every <a href="http(s)://…"> to go through our click tracker.
// Skips the unsubscribe link (we don't want clicking unsubscribe to count
// as engagement) and any mailto: / tel: / anchor links. base64url-encodes
// the destination so query strings and slashes survive the round trip.
function rewriteLinksForTracking(html, sendId) {
  const base = (process.env.PLATFORM_URL || '').replace(/\/$/, '');
  if (!base || !sendId) return html;
  return String(html).replace(/<a\s+([^>]*?)href=(['"])(https?:\/\/[^'"]+)\2([^>]*)>/gi,
    (match, before, quote, url, after) => {
      // Don't rewrite links that go back to us — unsubscribe + the
      // open pixel + the click tracker itself shouldn't be tracked.
      if (url.startsWith(base + '/api/')) return match;
      const encoded = Buffer.from(url, 'utf8').toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      // Sign (sendId + destination URL) so the tracker can refuse
      // forged tracking links. Without the sig the endpoint will fall
      // back to PLATFORM_URL instead of redirecting to an attacker
      // payload — closes the open-redirect path attackers used to
      // launder phishing URLs through the platform's domain.
      const sig = signTrackToken({ sendId, kind: 'click', dest: url });
      const tracked = `${base}/api/outreach/track/click/${encodeURIComponent(sendId)}?u=${encoded}&s=${sig}`;
      return `<a ${before}href=${quote}${tracked}${quote}${after}>`;
    });
}

function htmlBody(textBody, trackingSendId, contactId, clientId) {
  let html = String(textBody || '').replace(/\n/g, '<br>');
  const unsub = contactId ? unsubscribeUrl(contactId, clientId) : null;
  if (unsub) {
    html += `<div style="margin-top:32px;padding-top:14px;border-top:1px solid #eee;font-size:11px;color:#888;line-height:1.5;">` +
      `If this isn't relevant to your beat, no hard feelings — ` +
      `<a href="${unsub}" style="color:#888;">unsubscribe</a> and I won't email you about future releases.` +
      `</div>`;
  }
  if (trackingSendId) html = rewriteLinksForTracking(html, trackingSendId);
  if (trackingSendId && process.env.PLATFORM_URL) {
    const sig = signTrackToken({ sendId: trackingSendId, kind: 'open' });
    html += `<img src="${process.env.PLATFORM_URL}/api/outreach/track/open/${trackingSendId}?s=${sig}" width="1" height="1" alt="" style="display:none">`;
  }
  return html;
}

// List-Unsubscribe headers — required by Gmail / Yahoo for bulk senders.
// `mailto:` + `https` lets clients pick the safer one; List-Unsubscribe-Post
// signals we honour the RFC 8058 one-click flow.
function listUnsubscribeHeaders(contactId, fromEmail, clientId) {
  const unsub = unsubscribeUrl(contactId, clientId);
  if (!unsub) return {};
  const mailto = fromEmail ? `mailto:${fromEmail}?subject=unsubscribe` : null;
  const list = mailto ? `<${mailto}>, <${unsub}>` : `<${unsub}>`;
  return {
    'List-Unsubscribe': list,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

// SESv2 API path. Used when both AWS access keys are configured.
let _sesClient = null;
async function getSesClient() {
  const accessKeyId = await getSetting('SES_ACCESS_KEY_ID');
  const secretAccessKey = await getSetting('SES_SECRET_ACCESS_KEY');
  if (!accessKeyId || !secretAccessKey) return null;
  const region = (await getSetting('SES_REGION')) || process.env.SES_REGION || 'eu-west-1';
  const cacheKey = `${accessKeyId}:${region}`;
  if (_sesClient && _sesClient.cacheKey === cacheKey) return _sesClient.client;
  const { SESv2Client } = require('@aws-sdk/client-sesv2');
  const client = new SESv2Client({ region, credentials: { accessKeyId, secretAccessKey } });
  _sesClient = { client, cacheKey };
  return client;
}

async function sendViaSESv2({ from, to, replyTo, subject, text, html, headers }) {
  const client = await getSesClient();
  if (!client) return null;
  const { SendEmailCommand } = require('@aws-sdk/client-sesv2');
  const cmd = new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    ReplyToAddresses: replyTo ? [replyTo] : undefined,
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: text, Charset: 'UTF-8' },
          Html: { Data: html, Charset: 'UTF-8' },
        },
        Headers: headers && Object.keys(headers).length
          ? Object.entries(headers).map(([Name, Value]) => ({ Name, Value }))
          : undefined,
      },
    },
  });
  const res = await client.send(cmd);
  return res.MessageId;
}

function buildSmtpTransport() {
  return require('../routes/settings').buildTransporter();
}

async function deliver({ from, to, replyTo, subject, text, html, headers, contactId }) {
  try {
    const sesId = await sendViaSESv2({ from, to, replyTo, subject, text, html, headers });
    if (sesId) return { providerMessageId: sesId, provider: 'ses-api' };
  } catch (sesErr) {
    // SES synchronously rejected the send. If the error names a dead /
    // blacklisted recipient, mark the contact bounced so subsequent
    // sequences and campaigns won't drop fresh sends into the queue.
    const bounceHandler = require('./bounceHandler');
    if (contactId && bounceHandler.looksLikeSyncHardBounce(sesErr.message)) {
      await bounceHandler.markBounced(contactId, `SES sync · ${sesErr.message}`).catch(() => {});
    }
    throw sesErr;
  }
  const info = await buildSmtpTransport().sendMail({ from, to, replyTo, subject, text, html, headers });
  return { providerMessageId: info.messageId, provider: 'smtp' };
}

// Compute the effective sender identity a client's emails will go out as,
// mirroring the precedence in sendOutreachEmail: an active mailbox wins, else
// the legacy per-client single-sender config (clients.outreach_sending), else
// the platform default. Read-only — used to SHOW the AM who a send is from
// before it goes out. `source: 'default'` means nothing is configured and the
// platform fallback address is being used.
async function resolveSender(clientId) {
  const pool = require('../db');
  let mailboxes = [];
  if (clientId) {
    const { rows } = await pool.query(
      `SELECT from_name, from_email, reply_to FROM outreach_mailboxes
        WHERE client_id = $1 AND active = TRUE AND warm_up_status NOT IN ('paused','error')
        ORDER BY COALESCE(last_used_at, '1970-01-01'::timestamptz) ASC`,
      [clientId]
    );
    mailboxes = rows;
  }
  if (mailboxes.length) {
    const m = mailboxes[0];
    return {
      source: 'mailbox', configured: true, mailbox_count: mailboxes.length,
      from_name: m.from_name || 'October Communications',
      from_email: m.from_email || null,
      reply_to: m.reply_to || m.from_email || null,
    };
  }
  let cfg = {};
  if (clientId) {
    const { rows } = await pool.query('SELECT outreach_sending FROM clients WHERE id = $1', [clientId]);
    cfg = rows[0]?.outreach_sending || {};
  }
  const sf = await senderFields(cfg);
  const configured = !!(cfg && cfg.from_email);
  return {
    source: configured ? 'legacy' : 'default', configured, mailbox_count: 0,
    from_name: sf.fromName, from_email: sf.fromEmail || null, reply_to: sf.replyTo || null,
  };
}

async function sendOutreachEmail({ send, contact, step, sending, clientId }) {
  if (!contact.email) throw new Error('Contact has no email address.');

  // Phase 1: gate on verification before every send. shouldSend auto
  // re-verifies stale contacts and only hard-blocks on an "invalid"
  // result — soft errors are allowed through with a warning so a
  // flaky verifier doesn't take down the whole campaign.
  const outreachVerification = require('./outreachVerification');
  const gate = await outreachVerification.shouldSend(contact.id).catch(() => ({ ok: true }));
  if (!gate.ok) throw new Error(`Send blocked: ${gate.reason}`);

  // Phase 2: respect the per-prospect state machine. If the prospect
  // replied on any channel, was unsubscribed, or was manually paused,
  // don't send.
  const prospectState = require('./outreachProspectState');
  const active = await prospectState.isActive(send.campaign_id, contact.id).catch(() => true);
  if (!active) throw new Error('Send blocked: prospect no longer active in this cadence');

  // Phase 1: per-client mailbox rotation. If the client has any
  // mailboxes configured, pick the next eligible one and use its
  // from/reply-to; otherwise fall back to the legacy single-sender
  // outreach_sending config so older campaigns keep working.
  const outreachMailboxes = require('./outreachMailboxes');
  let pickedMailbox = null;
  let from, replyTo;
  if (clientId) {
    pickedMailbox = await outreachMailboxes.pickMailbox(clientId).catch(() => null);
  }
  if (pickedMailbox) {
    const addr = pickedMailbox.from_email;
    from = `"${pickedMailbox.from_name}" <${addr}>`;
    replyTo = pickedMailbox.reply_to || addr;
  } else {
    const sf = await senderFields(sending);
    from = sf.from; replyTo = sf.replyTo;
  }

  // Press-release path — step.body uses a sentinel ("__press_release__"
  // or "__press_followup_N__") and the real content lives on the
  // press_release_emails row keyed to this contact + the release the
  // campaign was built for. Reduces double-up of body storage between
  // outreach_sequences and the press cache.
  const pressMatch = /^__press_(release|followup_(\d+))__$/.exec(step.body || '');
  if (pressMatch) {
    const { from: pressFrom, replyTo: pressReplyTo } = { from, replyTo };
    return await sendPress({
      campaignId: send.campaign_id, contact, sendId: send.id,
      from: pressFrom, replyTo: pressReplyTo, clientId,
      kind: pressMatch[1] === 'release' ? 'release' : 'followup',
      followupIndex: pressMatch[2] ? parseInt(pressMatch[2], 10) : 0,
    });
  }

  const subject = fillTemplate(step.subject, contact);
  const text = fillTemplate(step.body, contact);
  const html = htmlBody(text, send.id, contact.id, clientId);
  const headers = listUnsubscribeHeaders(contact.id, (from || '').match(/<([^>]+)>/)?.[1] || from, clientId);

  let result;
  try {
    result = await deliver({ from, to: contact.email, replyTo, subject, text, html, headers, contactId: contact.id });
  } catch (err) {
    if (pickedMailbox && /smtp|auth|relay|550|554/i.test(err.message)) {
      await outreachMailboxes.markError(pickedMailbox.id, err.message).catch(() => {});
    }
    throw err;
  }

  // Phase 1: stamp the mailbox that delivered this send + bump its
  // daily counter. Errors here are non-fatal — the message already
  // went out, the counter is an analytics signal.
  if (pickedMailbox) {
    try {
      await outreachMailboxes.recordSend(pickedMailbox.id);
      if (send.id) {
        const pool = require('../db');
        await pool.query('UPDATE outreach_sends SET mailbox_id = $1 WHERE id = $2', [pickedMailbox.id, send.id]);
      }
    } catch (err) { /* swallow — non-fatal */ }
  }

  // Phase 2: advance the per-prospect state machine to the next step.
  // Best-effort; downstream cron picks up the next pending send.
  try {
    await prospectState.advance(send.campaign_id, contact.id);
  } catch (err) { /* swallow — non-fatal */ }
  return result;
}

async function sendPress({ campaignId, contact, sendId, from, replyTo, kind, followupIndex, clientId }) {
  // Resolve the press release this campaign is attached to. One
  // press release per campaign by construction in press.js.
  const pool = require('../db');
  const { rows: relRows } = await pool.query(
    'SELECT * FROM outreach_press_releases WHERE campaign_id = $1 LIMIT 1',
    [campaignId]
  );
  if (!relRows.length) throw new Error('Press release for this campaign not found');
  const release = relRows[0];
  let { rows: emailRows } = await pool.query(
    'SELECT * FROM press_release_emails WHERE press_release_id = $1 AND contact_id = $2',
    [release.id, contact.id]
  );
  if (!emailRows.length) {
    // Press emails are generated lazily at dispatch (not up-front at send
    // time), so a large list can queue instantly. Generate this recipient's
    // intro + follow-ups now, on the paced send cron.
    await require('./pressRelease').getOrGenerateEmails({
      pressReleaseId: release.id, contactId: contact.id, force: false,
    });
    ({ rows: emailRows } = await pool.query(
      'SELECT * FROM press_release_emails WHERE press_release_id = $1 AND contact_id = $2',
      [release.id, contact.id]
    ));
  }
  if (!emailRows.length) throw new Error('Could not generate the press email for this contact');
  const cached = emailRows[0];

  // Lazy require so the outreach sender doesn't depend on cheerio /
  // pressRelease at module load time on installs that aren't using
  // the press feature.
  const pressRelease = require('./pressRelease');
  const signature = await pressRelease.clientSignature(clientId);

  // Step 1's subject lives on the outreach_sequences row so the AM can
  // edit it independently of the release title. Fall back to the
  // release title for older campaigns where step.subject was never set.
  const { rows: seqRows } = await pool.query(
    'SELECT subject FROM outreach_sequences WHERE campaign_id = $1 AND step_number = 1 LIMIT 1',
    [campaignId]
  );
  const editedSubject = seqRows[0]?.subject;

  // Render the full release email (pitch + optional embed), tracked. Shared by
  // the initial send AND the "resend to an unopener" follow-up path.
  function renderRelease(subjectLine) {
    const releaseWithHero = { ...release, hero_image: (release.images?.[0]?.src) || null };
    const sender = { name: 'Daniel Nelson', first_name: 'Daniel', company: 'October Communications' };
    let h = pressRelease.buildEmailHtml({
      release: releaseWithHero, pitch: cached.intro, sender,
      recipientName: contact.name, embedFull: release.embed_full_release !== false,
      contactId: contact.id, clientId, campaignId, signature,
    });
    h = rewriteLinksForTracking(h, sendId);
    if (sendId && process.env.PLATFORM_URL) {
      const sig = signTrackToken({ sendId, kind: 'open' });
      h += `<img src="${process.env.PLATFORM_URL}/api/outreach/track/open/${sendId}?s=${sig}" width="1" height="1" alt="" style="display:none">`;
    }
    return { subject: subjectLine, html: h, text: (cached.intro || '') + `\n\nPress release: ${release.source_url || ''}` };
  }

  let subject, html, text;
  if (kind === 'release') {
    ({ subject, html, text } = renderRelease(editedSubject || release.title));
  } else {
    // Open-aware follow-up. If the journalist has ALREADY OPENED an earlier email
    // in this campaign, send the real next-stage follow-up. If they've NOT opened
    // anything yet, there's no point sending a "just following up" — instead
    // RESEND the original pitch with a fresh subject line (this step's edited
    // subject) to try to catch their attention. (Daniel's #10/#11.)
    const stepNo = followupIndex + 1; // sequence step_number for this follow-up
    const { rows: openedRows } = await pool.query(
      `SELECT 1 FROM outreach_sends WHERE campaign_id = $1 AND contact_id = $2 AND opened_at IS NOT NULL LIMIT 1`,
      [campaignId, contact.id]
    );
    const hasOpened = openedRows.length > 0;
    const { rows: stepRows } = await pool.query(
      'SELECT subject FROM outreach_sequences WHERE campaign_id = $1 AND step_number = $2 LIMIT 1',
      [campaignId, stepNo]
    );
    const stepSubject = stepRows[0]?.subject;

    if (!hasOpened) {
      // Resend the release with a new subject.
      ({ subject, html, text } = renderRelease(stepSubject || `Re: ${release.title}`));
    } else {
      const followUps = Array.isArray(cached.follow_ups) ? cached.follow_ups : [];
      const idx = Math.max(0, Math.min(followupIndex - 1, followUps.length - 1));
      const fu = followUps[idx] || { subject: `Re: ${release.title}`, body: '' };
      subject = stepSubject || fu.subject || `Re: ${release.title}`;
      text = fu.body || '';
      const releaseWithHero = { ...release, hero_image: (release.images?.[0]?.src) || null };
      const sender = { name: 'Daniel Nelson', first_name: 'Daniel', company: 'October Communications' };
      html = pressRelease.buildFollowUpHtml({
        release: releaseWithHero, body: text, sender, recipientName: contact.name,
        contactId: contact.id, clientId, campaignId, signature,
        includeHero: release.followup_hero !== false,
      });
      html = rewriteLinksForTracking(html, sendId);
      if (sendId && process.env.PLATFORM_URL) {
        const sig = signTrackToken({ sendId, kind: 'open' });
        html += `<img src="${process.env.PLATFORM_URL}/api/outreach/track/open/${sendId}?s=${sig}" width="1" height="1" alt="" style="display:none">`;
      }
    }
  }
  const headers = listUnsubscribeHeaders(contact.id, (from || '').match(/<([^>]+)>/)?.[1] || from, clientId);
  return deliver({ from, to: contact.email, replyTo, subject, text, html, headers, contactId: contact.id });
}

async function sendTest(campaign, step, sending, toAddress) {
  const { from, replyTo } = await senderFields(sending);
  const sample = { first_name: 'Test', last_name: 'Recipient', name: 'Test Recipient', company: 'Test Company', email: toAddress };
  const subject = '[TEST] ' + fillTemplate(step.subject, sample);
  const text = fillTemplate(step.body, sample);
  return deliver({ from, to: toAddress, replyTo, subject, text, html: htmlBody(text) });
}

// Send ONE faithful test copy of a press email to an arbitrary address, exactly
// as a journalist would receive it (real template + personalised pitch), but
// with a [TEST] subject, no tracking pixel, and no send row. `stepNumber` picks
// which email in the sequence (1 = the release, 2+ = a follow-up). `contact` is
// the journalist whose personalised copy to render (so the AM tests the real
// thing); `toAddress` is where the test lands (usually the AM's own inbox).
async function sendPressTest({ release, contact, toAddress, sending, clientId, stepNumber = 1 }) {
  const pool = require('../db');
  const { from, replyTo } = await senderFields(sending);
  const pressRelease = require('./pressRelease');
  const cached = await pressRelease.getOrGenerateEmails({ pressReleaseId: release.id, contactId: contact.id, force: false });
  const signature = await pressRelease.clientSignature(clientId);
  const sender = { name: 'Daniel Nelson', first_name: 'Daniel', company: 'October Communications' };
  let subject, html, text;
  if (stepNumber <= 1) {
    const releaseWithHero = { ...release, hero_image: (release.images?.[0]?.src) || null };
    // Prefer the AM-edited step-1 subject; fall back to the release title.
    const { rows: seqRows } = await pool.query(
      'SELECT subject FROM outreach_sequences WHERE campaign_id = $1 AND step_number = 1 LIMIT 1', [release.campaign_id]);
    subject = seqRows[0]?.subject || release.title;
    html = pressRelease.buildEmailHtml({
      release: releaseWithHero, pitch: cached.intro, sender,
      recipientName: contact.name, embedFull: release.embed_full_release !== false,
      contactId: contact.id, clientId, signature,
    });
    text = (cached.intro || '') + `\n\nPress release: ${release.source_url || ''}`;
  } else {
    const releaseWithHero = { ...release, hero_image: (release.images?.[0]?.src) || null };
    // Follow-up subjects live on the sequence rows (steps 2-4); prefer those so
    // the test matches what a journalist actually receives, not a cached draft.
    const { rows: seqRows } = await pool.query(
      'SELECT subject FROM outreach_sequences WHERE campaign_id = $1 AND step_number = $2 LIMIT 1', [release.campaign_id, stepNumber]);
    const followUps = Array.isArray(cached.follow_ups) ? cached.follow_ups : [];
    const fu = followUps[stepNumber - 2] || { subject: `Re: ${release.title}`, body: '' };
    subject = seqRows[0]?.subject || fu.subject || `Re: ${release.title}`;
    text = fu.body || '';
    html = pressRelease.buildFollowUpHtml({
      release: releaseWithHero, body: text, sender, recipientName: contact.name,
      contactId: contact.id, clientId, signature,
      includeHero: release.followup_hero !== false,
    });
  }
  return deliver({ from, to: toAddress, replyTo, subject: `[TEST] ${subject}`, text, html });
}

// Build the HTML+text exactly as the sender would for this step + sample
// contact, but without delivering. Used by the wizard's "Preview as
// contact" button so the AM can sanity-check a step's substitutions,
// tracking pixel and unsub footer before launching.
function previewStep(step, sample) {
  const subject = fillTemplate(step.subject || '', sample);
  const text = fillTemplate(step.body || '', sample);
  return { subject, text, html: htmlBody(text) };
}

module.exports = { sendOutreachEmail, sendTest, sendPressTest, previewStep, fillTemplate, unsubscribeUrl, resolveSender };
