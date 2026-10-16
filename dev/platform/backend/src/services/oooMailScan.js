// The automatic door: reading contact changes straight out of the inbox.
//
// OMI already polls the outreach reply inbox over IMAP every scheduler cycle
// (services/outreachReplies.js pollReplies). Until now it used each message
// only to mark a send replied and to catch unsubscribes, then threw the body
// away -- so an auto-reply naming three other journalists was read, understood
// to be a reply, and discarded. This module is what that poll now does with it.
//
// No MailFlow involvement. MailFlow is a window onto the same Gmail/IMAP
// mailboxes rather than a store of its own, so OMI reading them directly avoids
// a shared token, a push contract, and any change to the AGPL fork patch in
// dev/oc-mail. The CSV and MailFlow-push doors still work and converge on the
// same rows.
//
// The safety position: this reads ALL mail, most of which is not press. So
// every suggestion it raises records whether the sender is someone OMI already
// holds, and an unknown sender lands in a separate review list that is never
// pre-ticked. Nothing here writes to a contact.

const crypto = require('crypto');
const pool = require('../db');
const extract = require('./oooExtract');
const ooo = require('./oooSuggestions');

// Phrases that mean the sender has gone for good rather than gone for a week.
// Surfaced as a flag on the suggestion, not acted on: a departure needs the
// contact's record edited, and guessing which of the extracted addresses is
// their new one is exactly the sort of inference that produces a confident
// wrong answer.
const DEPARTURE = [
  /\bI (?:have |'ve )?(?:now )?left\b/i,
  /\bI am (?:no longer|leaving)\b/i,
  /\bno longer (?:with|at|works? (?:for|at)|employed)\b/i,
  /\bhas (?:now )?left\b/i,
  /\bto start a new role\b/i,
  /\bI (?:am|'m) (?:taking up|starting) (?:the|a) (?:role|position)\b/i,
  /\bmy last day\b/i,
  /\bthis mailbox is no longer (?:monitored|in use)\b/i,
  /\bnot? longer monitored\b/i,
];

function departureSentence(body) {
  for (const s of extract.sentences(body)) {
    if (DEPARTURE.some((re) => re.test(s))) return s.slice(0, 300);
  }
  return null;
}

// Split a raw RFC822 message into its header block and body.
function splitRaw(raw) {
  const text = String(raw || '');
  const i = text.search(/\r?\n\r?\n/);
  if (i < 0) return { headers: text, body: '' };
  const m = /\r?\n\r?\n/.exec(text.slice(i));
  return { headers: text.slice(0, i), body: text.slice(i + (m ? m[0].length : 2)) };
}

// Readable text from a body part. Quoted-printable soft breaks, tags and
// entities out; this is the same reduction the reply classifier already does.
function toText(body) {
  return String(body || '')
    .replace(/=\r?\n/g, '')
    .replace(/=3D/g, '=')
    .replace(/<(?:style|script)\b[^>]*>[\s\S]*?<\/(?:style|script)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// A stable per-message key for the watermark, so a widened backfill window does
// not re-extract replies already seen. Message-Id where the sender set one.
function messageKey({ headers, fromEmail, subject, date }) {
  const m = /^message-id:\s*<?([^>\r\n]+)>?/im.exec(String(headers || ''));
  if (m) return `mid:${m[1].trim().toLowerCase()}`;
  const key = [String(fromEmail || '').toLowerCase(), String(subject || ''), String(date || '')].join('|');
  return 'h:' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

async function alreadyScanned(key) {
  const { rows } = await pool.query('SELECT suggestion_id FROM ooo_scanned_messages WHERE message_key = $1', [key]);
  return rows.length ? rows[0] : null;
}

async function markScanned(key, wasAutoReply, suggestionId) {
  await pool.query(
    `INSERT INTO ooo_scanned_messages (message_key, was_auto_reply, suggestion_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (message_key) DO UPDATE
        SET was_auto_reply = EXCLUDED.was_auto_reply,
            suggestion_id  = COALESCE(EXCLUDED.suggestion_id, ooo_scanned_messages.suggestion_id),
            scanned_at = NOW()`,
    [key, Boolean(wasAutoReply), suggestionId || null]
  );
}

/**
 * Read one message and queue a suggestion if it is an auto-reply naming anyone.
 *
 * Returns a short verdict rather than throwing, so a malformed message can
 * never take the reply poll down with it.
 */
async function ingestMessage({ raw, fromEmail, subject, date, ownDomains = [], knownSendersOnly = false }) {
  const { headers, body } = splitRaw(raw);
  const text = toText(body);
  const key = messageKey({ headers, fromEmail, subject, date });

  const seen = await alreadyScanned(key);
  if (seen) return { key, skipped: 'already_scanned', suggestion_id: seen.suggestion_id };

  if (!extract.isAutoReply({ subject, headers })) {
    await markScanned(key, false, null);
    return { key, skipped: 'not_auto_reply' };
  }

  // Set per mailbox. A personal or finance account produces auto-replies all
  // day from people who will never be press contacts; each extracts perfectly
  // well and is worth nothing. Holding those mailboxes to senders OMI already
  // knows keeps "my colleague has taken over" for someone you track while
  // leaving supplier mail out of the queue entirely.
  if (knownSendersOnly && !(await ooo.matchContact(fromEmail))) {
    await markScanned(key, true, null);
    return { key, skipped: 'sender_not_known' };
  }

  const candidates = extract.extractContacts(text, { senderEmail: fromEmail, ownDomains });
  const departure = departureSentence(text);

  if (!candidates.length && !departure) {
    // A plain "I'm away until Monday" with no stand-in. Nothing to propose.
    await markScanned(key, true, null);
    return { key, skipped: 'nothing_extracted' };
  }

  const id = extract.suggestionId({ sender: fromEmail, subject, date });
  const flags = [];
  const alts = candidates.map((c) => {
    const rowFlags = extract.gate(
      { email: c.email, name: c.name, quote: c.quote, sourceDate: date },
      {}
    );
    if (c.nameInferred) {
      rowFlags.push({
        code: 'name_inferred',
        detail: 'The name was read off the address, not stated in the reply.',
      });
    }
    if (c.nameUnverified) {
      rowFlags.push({
        code: 'name_unverified',
        detail: 'The sentence names someone, but nothing ties that name to this address. Read the quote and set the name by hand.',
      });
    }
    for (const f of rowFlags) if (!flags.some((x) => x.code === f.code)) flags.push(f);
    return {
      name: c.name || null,
      email: c.email,
      // Left blank deliberately. The reply gives a domain, not a company
      // name, and turning "@mondiale.co.uk" into "Mondiale" is a guess that
      // would then read as fact on the contact record. The reviewer fills it.
      company: null,
      role: null,
      quote: c.quote,
      flags: rowFlags,
    };
  });

  if (departure) {
    flags.push({
      code: 'possible_departure',
      detail: `The sender may have left: "${departure}". Their own record needs checking; this suggestion only proposes the stand-ins.`,
    });
  }

  await ooo.upsertSuggestion(
    {
      id,
      category: 'mentions_alt_contact',
      confidence: null,            // deterministic extraction; the evidence is the quote
      detected_at: date || null,
      person: null,
      alt_contacts: alts,
      source: { from_email: fromEmail, subject: subject || null, message_date: date || null, quote: alts[0]?.quote || departure || null },
    },
    null,
    { origin: 'imap', flags }
  );

  await markScanned(key, true, id);
  return { key, queued: true, suggestion_id: id, contacts: alts.length, departure: Boolean(departure) };
}

module.exports = { ingestMessage, departureSentence, splitRaw, toText, messageKey };
