// Pre-send readiness check for an outreach campaign. Aggregates everything
// the AM should look at before clicking Launch:
//
//   blockers — won't let you launch. Missing sequence body, SES in sandbox,
//              SPF missing, > 50% of recipients previously bounced
//   warnings — let you launch but flag. Long subject, spam-trigger words,
//              no personalisation token, DMARC missing, lots of free-mail,
//              prior bounce / unsub history on the list
//   stats    — informational. Total recipients, free-mail count, prior
//              bounce/unsub counts, estimated send window
//
// Wired up by GET /outreach/campaigns/:id/readiness; rendered on the
// Launch step of the wizard. The launch button disables when any
// blocker is present.

const dns = require('dns').promises;
const pool = require('../db');
const { getSetting } = require('../utils/settings');

// Common spam-trigger words. Conservative list — we want to warn, not
// terrify, so this is the high-confidence subset rather than every
// possibly-spammy phrase.
const SPAM_WORDS = [
  'free!', 'free money', 'act now', 'urgent', 'limited time',
  'click here', 'order now', 'congratulations', 'winner', '$$$',
  '!!!', 'risk-free', 'no obligation', 'cash bonus', 'this is not spam',
  'guaranteed', 'amazing', 'cheap', 'as seen on tv', 'lowest price',
];
const PERSONALISATION_RE = /\{\{\s*\w+\s*\}\}/;

// Free-mail providers we count toward the "list is mostly personal
// addresses" warning. Not exhaustive — journalists and PR contacts
// often use these (gmail especially), so this is informational, not
// blocking.
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.uk',
  'outlook.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me', 'pm.me',
  'fastmail.com', 'fastmail.fm', 'hey.com', 'gmx.com', 'gmx.net',
]);

async function buildReadiness(campaignId) {
  const blockers = [];
  const warnings = [];
  const stats = {};

  // Campaign + sequence
  const { rows: camp } = await pool.query(
    'SELECT * FROM outreach_campaigns WHERE id = $1', [campaignId]
  );
  if (!camp.length) throw new Error('Campaign not found');
  const campaign = camp[0];
  const { rows: steps } = await pool.query(
    'SELECT * FROM outreach_sequences WHERE campaign_id = $1 ORDER BY step_number',
    [campaignId]
  );

  if (!steps.length) {
    blockers.push({ code: 'no_sequence', msg: 'No email sequence written. Go back to step 4 and write at least the first email.' });
  }

  // Per-step content checks
  for (const step of steps) {
    const label = `Step ${step.step_number}`;
    const subj = (step.subject || '').trim();
    const body = (step.body || '').trim();
    if (!subj) blockers.push({ code: 'missing_subject', msg: `${label} has no subject line.` });
    if (!body && body !== '__press_release__' && !/^__press_followup_\d+__$/.test(body)) {
      blockers.push({ code: 'missing_body', msg: `${label} has no email body.` });
    }
    if (subj.length > 60) {
      warnings.push({ code: 'subject_too_long', msg: `${label} subject is ${subj.length} chars — mobile clients clip after about 60.` });
    }
    const subjLower = subj.toLowerCase();
    const bodyLower = body.toLowerCase();
    const triggered = SPAM_WORDS.filter(w => subjLower.includes(w) || bodyLower.includes(w));
    if (triggered.length) {
      warnings.push({ code: 'spam_words', msg: `${label} contains spam-trigger words: ${triggered.join(', ')}.` });
    }
    if (step.step_number === 1 && !PERSONALISATION_RE.test(subj + ' ' + body) && body !== '__press_release__') {
      warnings.push({ code: 'no_personalisation', msg: `${label} uses no merge tags — adding {{first_name}} typically lifts opens significantly.` });
    }
  }

  // DNS — SPF / DKIM / DMARC for the sending domain
  const fromEmail = campaign.from_email
    || (await getSetting('SES_FROM_EMAIL'))
    || process.env.SES_FROM_EMAIL;
  const domain = fromEmail ? fromEmail.split('@')[1].toLowerCase() : null;
  stats.sending_domain = domain;
  if (!domain) {
    blockers.push({ code: 'no_from_address', msg: 'No From address configured. Set one on the Campaign step or in Settings.' });
  } else {
    const dnsResult = await checkDns(domain);
    stats.dns = dnsResult;
    if (dnsResult.spf === 'missing') {
      blockers.push({ code: 'spf_missing', msg: `No SPF record for ${domain}. Mail will be filtered.` });
    }
    if (dnsResult.dkim === 'missing') {
      warnings.push({ code: 'dkim_missing', msg: `No DKIM record detected for ${domain}. Add the three SES DKIM CNAMEs (selector1, selector2, selector3).` });
    }
    if (dnsResult.dmarc === 'missing') {
      warnings.push({ code: 'dmarc_missing', msg: `No DMARC record for ${domain}. Strongly recommended — Gmail enforces this for bulk senders.` });
    }
  }

  // SES sandbox check (best-effort — if the SES SDK or creds are missing
  // we skip rather than fail the whole readiness check)
  const sandbox = await checkSesSandbox();
  stats.ses = sandbox;
  if (sandbox.in_sandbox) {
    blockers.push({ code: 'ses_sandbox', msg: 'SES account is in sandbox mode — sends to unverified addresses silently fail. Request production access in the SES console.' });
  }

  // Recipient list quality
  const { rows: rec } = await pool.query(
    `SELECT con.email, con.bounced_at, m.unsubscribed_at
       FROM outreach_campaign_contacts cc
       JOIN outreach_contacts con ON con.id = cc.contact_id
       LEFT JOIN outreach_contact_clients m
              ON m.contact_id = con.id AND m.client_id = $2
      WHERE cc.campaign_id = $1`,
    [campaignId, campaign.client_id]
  );
  const total = rec.length;
  stats.total_recipients = total;
  if (!total) {
    blockers.push({ code: 'no_recipients', msg: 'No contacts enrolled. Go back to step 3 and add some.' });
  } else {
    const bounced = rec.filter(r => r.bounced_at).length;
    const unsubd = rec.filter(r => r.unsubscribed_at).length;
    const freeMail = rec.filter(r => {
      const d = (r.email || '').split('@')[1]?.toLowerCase();
      return d && FREE_MAIL.has(d);
    }).length;
    const uniqueEmails = new Set(rec.map(r => (r.email || '').toLowerCase()).filter(Boolean));
    const dupes = rec.length - uniqueEmails.size;

    stats.previously_bounced = bounced;
    stats.previously_unsubscribed = unsubd;
    stats.free_mail = freeMail;
    stats.duplicates = dupes;

    if (bounced / total > 0.5) {
      blockers.push({ code: 'mostly_bounced', msg: `${bounced} of ${total} recipients have previously bounced. Sending now will torch your sender reputation.` });
    } else if (bounced / total > 0.1) {
      warnings.push({ code: 'high_bounce_history', msg: `${bounced} of ${total} recipients have bounced before. They'll be skipped at send time, but worth cleaning the list anyway.` });
    }
    if (unsubd) {
      warnings.push({ code: 'unsubscribed_in_list', msg: `${unsubd} recipient${unsubd === 1 ? '' : 's'} previously unsubscribed from this client. They will be skipped at send time.` });
    }
    if (freeMail / total > 0.4) {
      warnings.push({ code: 'free_mail_heavy', msg: `${freeMail} of ${total} (${Math.round(100 * freeMail / total)}%) are free-mail addresses. Filters scrutinise lists like this more heavily.` });
    }
    if (dupes) {
      warnings.push({ code: 'duplicate_emails', msg: `${dupes} duplicate email address${dupes === 1 ? '' : 'es'} in the recipient list — the same person will get N copies.` });
    }
  }

  // CAN-SPAM-style reminder — light touch. Not a code-level check, just
  // a checklist item.
  warnings.push({
    code: 'compliance_check',
    msg: 'Compliance check (not enforced): every email needs an unsub link (we add one automatically), the sender\'s legal/physical address (CAN-SPAM), and a documented basis for emailing this list (UK PECR / GDPR legitimate interest).',
    severity: 'info',
  });

  // Estimated send window — assume 1 send / second average from SES + queue,
  // 8-hour business-hour pacing per day. Rough but useful.
  const perDay = 8 * 60 * 60;
  const days = total ? Math.ceil(total / perDay) : 0;
  stats.estimated_send_days = days;

  return { blockers, warnings, stats, step_count: steps.length };
}

async function checkDns(domain) {
  const lookup = async (host) => {
    try { return await dns.resolveTxt(host); }
    catch { return []; }
  };
  const lookupCname = async (host) => {
    try { return await dns.resolveCname(host); }
    catch { return []; }
  };
  const flatten = (records) => records.map(parts => parts.join(''));

  const [base, dmarc, dkim1, dkim2, dkim3] = await Promise.all([
    lookup(domain),
    lookup(`_dmarc.${domain}`),
    lookupCname(`selector1._domainkey.${domain}`),
    lookupCname(`selector2._domainkey.${domain}`),
    lookupCname(`selector3._domainkey.${domain}`),
  ]);
  const spfRecord = flatten(base).find(r => /^v=spf1\b/i.test(r));
  const dmarcRecord = flatten(dmarc).find(r => /^v=DMARC1\b/i.test(r));
  // SES rotates DKIM through selector1 / selector2 / selector3 CNAMEs —
  // any one resolving counts as DKIM configured.
  const dkimFound = [dkim1, dkim2, dkim3].some(arr => arr.length > 0);
  return {
    domain,
    spf: spfRecord ? 'found' : 'missing',
    dkim: dkimFound ? 'found' : 'missing',
    dmarc: dmarcRecord ? 'found' : 'missing',
  };
}

async function checkSesSandbox() {
  try {
    const accessKeyId = await getSetting('SES_ACCESS_KEY_ID');
    const secretAccessKey = await getSetting('SES_SECRET_ACCESS_KEY');
    if (!accessKeyId || !secretAccessKey) {
      return { configured: false, in_sandbox: null };
    }
    const region = (await getSetting('SES_REGION')) || process.env.SES_REGION || 'eu-west-1';
    const { SESv2Client, GetAccountCommand } = require('@aws-sdk/client-sesv2');
    const client = new SESv2Client({ region, credentials: { accessKeyId, secretAccessKey } });
    const res = await client.send(new GetAccountCommand({}));
    // ProductionAccessEnabled === true means you're out of sandbox.
    return {
      configured: true,
      in_sandbox: !res.ProductionAccessEnabled,
      sending_enabled: res.SendingEnabled !== false,
      reputation_metrics_enabled: !!res.EnforcementStatus && res.EnforcementStatus !== 'HEALTHY' ? res.EnforcementStatus : null,
    };
  } catch (err) {
    // SDK or auth error — surface but don't block the whole readiness
    return { configured: true, in_sandbox: null, error: err.message };
  }
}

module.exports = { buildReadiness };
