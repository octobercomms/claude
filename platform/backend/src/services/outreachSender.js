// Composes and sends October Outreach emails. Prefers Amazon SES v2 over the
// SES SMTP transport when API credentials are set — the SES API is lower
// latency, gives richer error responses, and matches the product brief.
const { getSetting } = require('../utils/settings');

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

function htmlBody(textBody, trackingSendId) {
  let html = String(textBody || '').replace(/\n/g, '<br>');
  if (trackingSendId && process.env.PLATFORM_URL) {
    html += `<img src="${process.env.PLATFORM_URL}/api/outreach/track/open/${trackingSendId}" width="1" height="1" alt="" style="display:none">`;
  }
  return html;
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

async function sendViaSESv2({ from, to, replyTo, subject, text, html }) {
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
      },
    },
  });
  const res = await client.send(cmd);
  return res.MessageId;
}

function buildSmtpTransport() {
  return require('../routes/settings').buildTransporter();
}

async function deliver({ from, to, replyTo, subject, text, html }) {
  const sesId = await sendViaSESv2({ from, to, replyTo, subject, text, html });
  if (sesId) return { providerMessageId: sesId, provider: 'ses-api' };
  const info = await buildSmtpTransport().sendMail({ from, to, replyTo, subject, text, html });
  return { providerMessageId: info.messageId, provider: 'smtp' };
}

async function sendOutreachEmail({ send, contact, step, sending }) {
  if (!contact.email) throw new Error('Contact has no email address.');
  const { from, replyTo } = await senderFields(sending);
  const subject = fillTemplate(step.subject, contact);
  const text = fillTemplate(step.body, contact);
  const html = htmlBody(text, send.id);
  return deliver({ from, to: contact.email, replyTo, subject, text, html });
}

async function sendTest(campaign, step, sending, toAddress) {
  const { from, replyTo } = await senderFields(sending);
  const sample = { first_name: 'Test', last_name: 'Recipient', name: 'Test Recipient', company: 'Test Company', email: toAddress };
  const subject = '[TEST] ' + fillTemplate(step.subject, sample);
  const text = fillTemplate(step.body, sample);
  return deliver({ from, to: toAddress, replyTo, subject, text, html: htmlBody(text) });
}

module.exports = { sendOutreachEmail, sendTest, fillTemplate };
