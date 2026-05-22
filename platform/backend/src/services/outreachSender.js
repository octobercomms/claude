// Composes and sends October Outreach emails using the platform's
// configured email transport, with per-client From / Reply-To overrides.

function fillTemplate(text, contact) {
  const first = (contact.name || '').trim().split(/\s+/)[0] || 'there';
  return String(text || '')
    .replace(/\{\{\s*first_name\s*\}\}/gi, first)
    .replace(/\{\{\s*name\s*\}\}/gi, contact.name || 'there')
    .replace(/\{\{\s*company\s*\}\}/gi, contact.company || '');
}

function senderFields(sending) {
  const cfg = sending || {};
  const fromEmail = cfg.from_email || process.env.SES_FROM_EMAIL || process.env.GMAIL_USER;
  const fromName = cfg.from_name || 'October Communications';
  return {
    from: fromEmail ? `"${fromName}" <${fromEmail}>` : undefined,
    replyTo: cfg.reply_to || undefined,
  };
}

function buildTransport() {
  return require('../routes/settings').buildTransporter();
}

// Send one scheduled outreach email. ctx = { send, contact, step, sending }.
async function sendOutreachEmail({ send, contact, step, sending }) {
  if (!contact.email) throw new Error('Contact has no email address.');
  const { from, replyTo } = senderFields(sending);
  const subject = fillTemplate(step.subject, contact);
  const body = fillTemplate(step.body, contact);
  let html = body.replace(/\n/g, '<br>');
  if (process.env.PLATFORM_URL) {
    html += `<img src="${process.env.PLATFORM_URL}/api/outreach/track/open/${send.id}" width="1" height="1" alt="" style="display:none">`;
  }
  await buildTransport().sendMail({ from, to: contact.email, replyTo, subject, text: body, html });
}

// Send a test copy of a sequence step to an arbitrary address.
async function sendTest(campaign, step, sending, toAddress) {
  const { from, replyTo } = senderFields(sending);
  const sample = { name: 'Test Recipient', company: 'Test Company', email: toAddress };
  const subject = '[TEST] ' + fillTemplate(step.subject, sample);
  const body = fillTemplate(step.body, sample);
  await buildTransport().sendMail({
    from, to: toAddress, replyTo, subject,
    text: body, html: body.replace(/\n/g, '<br>'),
  });
}

module.exports = { sendOutreachEmail, sendTest, fillTemplate };
