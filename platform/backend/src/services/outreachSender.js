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
function unsubscribeUrl(contactId, clientId) {
  const base = (process.env.PLATFORM_URL || '').replace(/\/$/, '');
  if (!base || !process.env.JWT_SECRET) return null;
  const payload = clientId ? `unsub:${contactId}:${clientId}` : `unsub:${contactId}`;
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('hex').slice(0, 32);
  const params = new URLSearchParams({ c: contactId, s: sig });
  if (clientId) params.set('cl', clientId);
  return `${base}/api/unsubscribe?${params.toString()}`;
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
      const tracked = `${base}/api/outreach/track/click/${encodeURIComponent(sendId)}?u=${encoded}`;
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
    html += `<img src="${process.env.PLATFORM_URL}/api/outreach/track/open/${trackingSendId}" width="1" height="1" alt="" style="display:none">`;
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

async function deliver({ from, to, replyTo, subject, text, html, headers }) {
  const sesId = await sendViaSESv2({ from, to, replyTo, subject, text, html, headers });
  if (sesId) return { providerMessageId: sesId, provider: 'ses-api' };
  const info = await buildSmtpTransport().sendMail({ from, to, replyTo, subject, text, html, headers });
  return { providerMessageId: info.messageId, provider: 'smtp' };
}

async function sendOutreachEmail({ send, contact, step, sending, clientId }) {
  if (!contact.email) throw new Error('Contact has no email address.');
  const { from, replyTo } = await senderFields(sending);

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
  return deliver({ from, to: contact.email, replyTo, subject, text, html, headers });
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
  const { rows: emailRows } = await pool.query(
    'SELECT * FROM press_release_emails WHERE press_release_id = $1 AND contact_id = $2',
    [release.id, contact.id]
  );
  if (!emailRows.length) throw new Error('No cached press email for this contact');
  const cached = emailRows[0];

  // Lazy require so the outreach sender doesn't depend on cheerio /
  // pressRelease at module load time on installs that aren't using
  // the press feature.
  const pressRelease = require('./pressRelease');

  let subject, html, text;
  if (kind === 'release') {
    subject = release.title;
    const releaseWithHero = { ...release, hero_image: (release.images?.[0]?.src) || null };
    const sender = { name: 'Daniel Nelson', first_name: 'Daniel', company: 'October Communications' };
    html = pressRelease.buildEmailHtml({ release: releaseWithHero, pitch: cached.intro, sender, recipientName: contact.name, contactId: contact.id, clientId });
    html = rewriteLinksForTracking(html, sendId);
    // Append the open pixel — buildEmailHtml doesn't know about send_id.
    if (sendId && process.env.PLATFORM_URL) {
      html += `<img src="${process.env.PLATFORM_URL}/api/outreach/track/open/${sendId}" width="1" height="1" alt="" style="display:none">`;
    }
    text = (cached.intro || '') + `\n\nPress release: ${release.source_url || ''}`;
  } else {
    const followUps = Array.isArray(cached.follow_ups) ? cached.follow_ups : [];
    const idx = Math.max(0, Math.min(followupIndex - 1, followUps.length - 1));
    const fu = followUps[idx] || { subject: `Re: ${release.title}`, body: '' };
    subject = fu.subject || `Re: ${release.title}`;
    text = fu.body || '';
    html = htmlBody(text, sendId, contact.id, clientId);
  }
  const headers = listUnsubscribeHeaders(contact.id, (from || '').match(/<([^>]+)>/)?.[1] || from, clientId);
  return deliver({ from, to: contact.email, replyTo, subject, text, html, headers });
}

async function sendTest(campaign, step, sending, toAddress) {
  const { from, replyTo } = await senderFields(sending);
  const sample = { first_name: 'Test', last_name: 'Recipient', name: 'Test Recipient', company: 'Test Company', email: toAddress };
  const subject = '[TEST] ' + fillTemplate(step.subject, sample);
  const text = fillTemplate(step.body, sample);
  return deliver({ from, to: toAddress, replyTo, subject, text, html: htmlBody(text) });
}

module.exports = { sendOutreachEmail, sendTest, fillTemplate, unsubscribeUrl };
