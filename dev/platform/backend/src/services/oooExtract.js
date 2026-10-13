// Reading contact changes out of an auto-reply.
//
// Deliberately deterministic: regex and position, no model call. Three reasons.
// It runs on every message in the inbox, so a per-message AI cost is real money
// for mail that is mostly not press. It has to be auditable -- every proposed
// contact carries the sentence it came from, so a reviewer can check the claim
// rather than trust a score. And a model that invents a plausible address is
// exactly the failure the review queue cannot catch, because a fabricated
// address looks identical to a real one.
//
// The MailFlow CSV export is the same shape after parsing, so both doors share
// the gates and the id derivation below.

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Is this an auto-reply at all?
// ---------------------------------------------------------------------------

// Headers an auto-responder is supposed to set. RFC 3834 is `Auto-Submitted`;
// the X- ones are what Exchange and older responders actually send.
const AUTO_HEADERS = [
  /^x-auto(?:-?reply|respond(?:er)?|generated)\b/im,
  /^x-autoreply:[ \t]*yes/im,
  /^precedence:[ \t]*(?:auto_reply|bulk|junk)/im,
];

// Auto-Submitted is read by value rather than pattern. A negative lookahead
// after \s* does not work here: \s* backtracks to zero width, the lookahead
// then sits on the space rather than the value, and "Auto-Submitted: no" --
// which every ordinary mail from a conforming sender may carry -- reads as an
// auto-reply. Every message would have qualified.
const AUTO_SUBMITTED = /^auto-submitted:[ \t]*([^\r\n;]*)/im;

// Subject prefixes, across the languages October's list actually replies in.
// Anchored at the start: "Re: your automatic reply question" is not an OOO.
const AUTO_SUBJECT = new RegExp(
  '^\\s*(?:\\[[^\\]]{1,20}\\]\\s*)*(?:re:\\s*)?(?:' + [
    'auto(?:matic|mated)?[\\s-]*(?:reply|response|antwort)',
    'auto[\\s-]?reply',
    'out[\\s-]of[\\s-](?:the[\\s-])?office',
    'ooo\\b',
    'away from (?:my|the) (?:desk|office)',
    'on (?:annual )?leave',
    'r[eé]ponse automatique',
    'automatische antwort',
    'respuesta autom[aá]tica',
    'risposta automatica',
    'abwesenheit',
  ].join('|') + ')',
  'i'
);

/**
 * Does this message look like an auto-reply?
 *
 * Headers are trusted when present and subject is the fallback, because plenty
 * of responders set neither header correctly but every one of them writes a
 * recognisable subject.
 */
function isAutoReply({ subject = '', headers = '' } = {}) {
  const h = String(headers || '');
  if (h) {
    const m = AUTO_SUBMITTED.exec(h);
    if (m && m[1].trim() && !/^no$/i.test(m[1].trim())) return true;
    if (AUTO_HEADERS.some((re) => re.test(h))) return true;
  }
  return AUTO_SUBJECT.test(String(subject || ''));
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

// Mailbox local-parts that are a department, not a person. Extracting these is
// correct -- the auto-reply really did name them -- but a subscriptions or CV
// mailbox in a journalist list costs deliverability and returns nothing, so
// they arrive flagged and unticked rather than not at all.
const FUNCTIONAL_LOCAL = new RegExp('^(?:' + [
  'jobs?', 'cv', 'careers?', 'recruit(?:ment)?',
  'info', 'enquir(?:y|ies)', 'contact(?:us)?', 'hello', 'hi', 'mail',
  'sales', 'advertis(?:ing|e)', 'ads', 'media(?:sales)?', 'commercial', 'sponsorship',
  'subs(?:criptions?)?', 'subscription', 'billing', 'accounts?', 'finance', 'invoices?',
  'support', 'help(?:desk)?', 'admin', 'office', 'reception',
  'newsdesk', 'news', 'editorial', 'editor', 'desk', 'copy', 'features?',
  'press(?:office)?', 'pr', 'marketing', 'comms?', 'communications',
  'team', 'all', 'everyone', 'staff', 'group',
  'no-?reply', 'do-?not-?reply', 'postmaster', 'mailer-daemon', 'bounce',
  'test(?:team)?', 'webmaster', 'privacy', 'legal', 'dpo',
].join('|') + ')(?:[._-]?(?:team|dept|department|uk|us|group|list|box))?$', 'i');

function isFunctionalMailbox(email) {
  const local = String(email || '').split('@')[0] || '';
  if (FUNCTIONAL_LOCAL.test(local)) return true;
  // Composite department boxes -- housebeautifuldigitalteam@, us_salesleaders@,
  // hitastetestteam@ -- have no personal name in them at all.
  return /(?:team|leaders|desk|group|dept|department|enquiries|salesteam)$/i.test(local);
}

const EMAIL_RE = /\b[A-Za-z0-9](?:[A-Za-z0-9._%+'-]*[A-Za-z0-9])?@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}\b/g;

// A full, valid address. The source auto-replies contain plenty of truncated
// ones ("sabine.weinmann@luther-lawfirm", "contact Simon Lambert or Helen
// Crane.") and an address with no TLD must never reach a sending list.
function isPlausibleEmail(email) {
  const e = String(email || '').trim();
  if (!e || e.length > 254) return false;
  const m = /^([^@]+)@([^@]+)$/.exec(e);
  if (!m) return false;
  const [, local, domain] = m;
  if (local.length > 64) return false;
  if (!/\.[A-Za-z]{2,}$/.test(domain)) return false;   // needs a real TLD
  if (/\.\./.test(e)) return false;
  return true;
}

/**
 * Does the extracted name plausibly belong to the extracted address?
 *
 * Catches the quiet failure mode in the MailFlow export, where a real-looking
 * address was attached to a quote that names someone else entirely. A surname
 * appearing in the local part is the evidence; absent that, the address has to
 * at least appear verbatim in the quote.
 */
function nameMatchesEmail(name, email) {
  const local = String(email || '').split('@')[0].toLowerCase();
  const parts = String(name || '').toLowerCase().match(/[a-z]{2,}/g) || [];
  if (!parts.length) return false;
  return parts.some((p) => {
    if (p.length >= 4) return local.includes(p.slice(0, 4));
    return local.includes(p);                            // short surnames: Fox, Lee
  });
}

const STALE_MONTHS_DEFAULT = 18;

/**
 * Every reason to hold a candidate back, as {code, detail}.
 *
 * Returned rather than acted on. The reviewer sees each flag beside the
 * candidate and can overrule it; nothing here silently drops a row, because a
 * dropped row is invisible and an unticked one is a decision.
 */
function gate(candidate, opts = {}) {
  const flags = [];
  const email = String(candidate.email || '').trim();
  const staleMonths = opts.staleMonths ?? STALE_MONTHS_DEFAULT;

  if (!email) {
    flags.push({ code: 'no_email', detail: 'Named a person but gave no address, so there is nothing to add.' });
  } else if (!isPlausibleEmail(email)) {
    flags.push({ code: 'invalid_email', detail: `"${email}" is not a complete address (no valid domain).` });
  } else {
    if (isFunctionalMailbox(email)) {
      flags.push({ code: 'functional_mailbox', detail: 'A department mailbox, not a person.' });
    }
    const inQuote = String(candidate.quote || '').toLowerCase().includes(email.toLowerCase());
    if (!inQuote && !nameMatchesEmail(candidate.name, email)) {
      flags.push({
        code: 'unsupported_email',
        detail: 'The address is neither in the quoted sentence nor a match for the name, so nothing evidences the pairing.',
      });
    }
  }

  if (candidate.sourceDate) {
    const t = Date.parse(candidate.sourceDate);
    if (!Number.isNaN(t)) {
      const months = (Date.now() - t) / (1000 * 60 * 60 * 24 * 30.44);
      if (months > staleMonths) {
        flags.push({
          code: 'stale',
          detail: `The reply is ${Math.round(months)} months old; the stand-in has very likely moved on.`,
        });
      }
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

// Split on sentence ends, but not on the dot inside an address or an initial.
function sentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<![A-Z])(?<!\b[A-Za-z0-9._%+'-]{1,40}@[A-Za-z0-9.-]{1,40})[.!?;](?=\s+[A-Z(]|\s*$)/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Titles and role words that sit between the cue and the name and must not be
// mistaken for it: "contact Executive Editor Brian Kaberline".
const ROLE_WORDS = new RegExp('^(?:' + [
  'executive', 'managing', 'associate', 'assistant', 'deputy', 'senior', 'acting', 'interim',
  'chief', 'head', 'director', 'editor', 'in', 'of', 'the', 'our', 'my', 'a', 'an',
  'reporter', 'writer', 'journalist', 'correspondent', 'producer', 'presenter',
  'colleague', 'colleagues', 'assistant', 'manager', 'advisor', 'adviser', 'officer',
  'content', 'news', 'features', 'digital', 'online', 'special', 'projects',
  'dr', 'prof', 'professor', 'mr', 'mrs', 'ms', 'miss', 'sir', 'dame',
  'team', 'desk', 'please', 'contact', 'email', 'reach', 'out', 'to', 'at',
].join('|') + ')$', 'i');

// Lowercase words that sit between a name and its address and must be stepped
// over rather than treated as the end of the name: "email Alexis Muellner at
// amuellner@...". Only skipped before a name has started -- once we have
// capitalised words, a lowercase word is genuinely the left edge.
const CONNECTORS = new RegExp('^(?:' + [
  'at', 'on', 'via', 'to', 'or', 'and', 'by', 'c/o',
  'email', 'emailing', 'e-mail', 'mail', 'contact', 'contacting', 'reach', 'call',
  'please', 'directly', 'instead', 'is', 'are', 'can', 'be', 'reached',
].join('|') + ')$', 'i');

// Every run of capitalised words before the address, nearest last, with runs
// made only of titles dropped. "Hannah Wintle for Sleeper / Starboard at
// h.wintle@..." yields ["Hannah Wintle", "Sleeper", "Starboard"].
// Unbounded in the match, trimmed after. Capping the match at three words
// split "Executive Editor Brian Kaberline" into "…Brian" and "Kaberline", so
// neither fragment matched the address and the name came out empty.
const RUN_RE = /\b[A-Z][A-Za-z'\u2019-]*(?:\s+[A-Z][A-Za-z'\u2019-]*){0,5}\b/g;

// Drop titles and cue words from a run, and keep at most three words — a
// person's name, not a sentence.
function trimRun(run) {
  const words = String(run).split(/\s+/).filter((w) => !ROLE_WORDS.test(w));
  return words.slice(-3).join(' ');
}

function capitalisedRuns(text, index) {
  const before = String(text).slice(0, index);
  const runs = [];
  RUN_RE.lastIndex = 0;
  let m;
  while ((m = RUN_RE.exec(before)) !== null) {
    const run = trimRun(m[0]);
    if (run) runs.push(run);
  }
  return runs;
}

/**
 * The name belonging to this address, or '' when nothing in the sentence
 * evidences one.
 *
 * The nearest capitalised run is the obvious choice and the wrong one: in
 * "Hannah Wintle for Sleeper / Starboard at h.wintle@mondiale.co.uk" it is
 * "Starboard", a magazine. Picking it would write a publication's name into a
 * contact's name field, and the review card would show a plausible-looking row
 * with no sign anything was wrong.
 *
 * So the address arbitrates: of the runs in the sentence, take the one the
 * local part corroborates. Journalists' addresses are built from their names
 * almost without exception, which makes this a strong test. When nothing
 * corroborates, the name is left blank rather than guessed -- the quote is on
 * the card either way, so a reviewer can read it and type the name.
 */
function nameBefore(text, index, email) {
  const runs = capitalisedRuns(text, index);
  if (!runs.length) return '';
  if (!email) return runs[runs.length - 1];
  // Longest first: "Hannah Wintle" is preferred over a bare "Wintle".
  const ordered = [...runs].sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length);
  const corroborated = ordered.find((r) => nameMatchesEmail(r, email));
  return corroborated || '';
}

// Last resort, and marked as a guess by the caller: a first.last@ or
// first_last@ local part carries the name itself. Only used when the sentence
// names nobody, and never for a department mailbox.
function nameFromLocalPart(email) {
  const local = String(email || '').split('@')[0] || '';
  if (isFunctionalMailbox(email)) return '';
  const parts = local.split(/[._-]+/).filter((p) => /^[A-Za-z]{2,}$/.test(p));
  if (parts.length < 2 || parts.length > 3) return '';
  return parts.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

// A display name in front of the address: "Jane Doe <j@x.com>", "Jane Doe (j@x.com)".
function displayName(text, index, email) {
  const win = String(text).slice(Math.max(0, index - 80), index + email.length + 2);
  const m = /([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,5})\s*[<(]\s*$/.exec(win.slice(0, win.indexOf(email)));
  // Titles come off here too: "Editor Brian Kaberline (bkaberline@…)" is the
  // parenthesised form, and without trimming it the title became the forename.
  return m ? trimRun(m[1]) : '';
}

// Quoting our own footer back at us is not a contact change: an auto-reply
// carries the full text of the mail it is answering, including October's own
// signature and unsubscribe block.
function ownDomains(extra = []) {
  return new Set([
    'octobercomms.com', 'nvelope.co', 'platform.octobercomms.com',
    ...extra.map((d) => String(d || '').toLowerCase().trim()).filter(Boolean),
  ]);
}

/**
 * Pull every proposed contact out of an auto-reply body.
 *
 * Each candidate carries the sentence it was read from, so the review card can
 * show the evidence rather than a bare assertion.
 */
function extractContacts(body, opts = {}) {
  const senderEmail = String(opts.senderEmail || '').toLowerCase().trim();
  const senderDomain = senderEmail.split('@')[1] || '';
  const skipDomains = ownDomains(opts.ownDomains);
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const out = [];
  const seen = new Set();

  for (const sentence of sentences(text)) {
    EMAIL_RE.lastIndex = 0;
    let m;
    while ((m = EMAIL_RE.exec(sentence)) !== null) {
      const email = m[0].toLowerCase().replace(/[.,;:]+$/, '');
      const domain = email.split('@')[1] || '';
      if (email === senderEmail) continue;               // the responder themselves
      if (skipDomains.has(domain)) continue;             // our own quoted footer
      if (seen.has(email)) continue;
      seen.add(email);
      // A "Name <addr>" / "Name (addr)" pairing is syntactically explicit, so
      // it is trusted as written; a name read out of prose has to be
      // corroborated by the address.
      const stated = displayName(sentence, m.index, m[0]) || nameBefore(sentence, m.index, email);
      const inferred = stated ? '' : nameFromLocalPart(email);
      // A name appears in the sentence but nothing ties it to this address.
      // Worth the reviewer's eye rather than a silent blank.
      const unverified = !stated && !inferred
        && capitalisedRuns(sentence, m.index).length > 0
        && !isFunctionalMailbox(email);
      out.push({
        name: stated || inferred,
        // True when the name came from the address rather than the sentence.
        // The review card labels it, because "Megan Gibson" read off
        // megan.gibson@ is an inference and the reviewer should see that.
        nameInferred: Boolean(inferred),
        nameUnverified: unverified,
        email,
        quote: sentence.slice(0, 400),
        // Same employer as the responder is the common case ("my colleague
        // X"), and it is a guess, so it is offered as a default rather than
        // asserted -- the reviewer sees the company field prefilled.
        sameDomainAsSender: Boolean(senderDomain) && domain === senderDomain,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

// Strip the auto-reply wrapper so the same reply hashes identically whether it
// arrived as a CSV row ("Automatic reply: X") or straight off IMAP.
function normaliseSubject(subject) {
  let s = String(subject || '').toLowerCase();
  s = s.replace(/\[[^\]]{1,20}\]/g, ' ');                       // [EXT], [EXTERNAL]
  let prev;
  do {
    prev = s;
    s = s.replace(/^\s*(?:re|fwd?|aw|tr|rif)\s*:\s*/i, '');
    s = s.replace(AUTO_SUBJECT, '');
    s = s.replace(/^\s*[:-]\s*/, '');
  } while (s !== prev);
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * A stable id for one auto-reply, from sender + subject + calendar day.
 *
 * Deliberately not derived from the extracted addresses: when the extractor
 * improves and finds a fourth contact in a reply already in the queue, that has
 * to update the existing row, not open a second one beside it. The trade is
 * that two different auto-replies from one sender on one day about the same
 * subject merge, which is the right answer anyway.
 *
 * It also means a CSV upload and the IMAP scan of the same reply converge on
 * one row instead of duplicating -- the two doors are safe to run together.
 */
function suggestionId({ sender, subject, date }) {
  const day = (() => {
    const t = Date.parse(date);
    return Number.isNaN(t) ? String(date || '') : new Date(t).toISOString().slice(0, 10);
  })();
  const key = [String(sender || '').toLowerCase().trim(), normaliseSubject(subject), day].join('|');
  return 'ooo_' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

module.exports = {
  isAutoReply, isFunctionalMailbox, isPlausibleEmail, nameMatchesEmail,
  gate, extractContacts, sentences, nameBefore, capitalisedRuns, trimRun, nameFromLocalPart,
  normaliseSubject, suggestionId,
  STALE_MONTHS_DEFAULT,
};
