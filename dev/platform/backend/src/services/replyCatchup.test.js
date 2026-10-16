// Standalone tests for the reply catch-up's opt-out reading. Runs with
//   node src/services/replyCatchup.test.js
// and exits non-zero on the first failure. No DB connection is opened — the pg
// Pool is constructed lazily and nothing here queries.
//
// This file exists for one function. unsubPhrase() decides whether a reply
// means "stop emailing me", and the catch-up applies that decision across
// months of backlog in one press. A false negative leaves someone on a list
// they asked to leave; a false positive drops a journalist who was only
// talking about the unsubscribe link. Both are expensive, neither shows up in
// a build.

const assert = require('assert');
const { unsubPhrase } = require('./replyCatchup');

let passed = 0;
function check(name, cond) {
  assert.ok(cond, `FAILED: ${name}`);
  passed++;
}

// ── Plain opt-outs ──────────────────────────────────────────────────────────
check('remove me', unsubPhrase('Please remove me from your list.', 'Re: release') === 'remove me');
check('take me off', unsubPhrase('Take me off this list please.', 'Re: release') === 'take me off');
check('unsubscribe in the body', unsubPhrase('unsubscribe', 'Re: release') === 'unsubscribe');
check('stop sending', unsubPhrase('Please stop sending these.', 'Re: release') === 'stop sending');
check('no longer wish to receive',
  unsubPhrase('I no longer wish to receive these emails.', 'Re: release') === 'no longer wish to receive');
// When several phrases match, the one reported is whichever comes first in
// UNSUB_PHRASES. That is an arbitrary but stable choice, and what matters to
// the caller is that an opt-out was detected at all, so assert that.
check('not my beat, worded as removal, is detected',
  unsubPhrase('Not my beat — please remove from the list.', 'Re: x') !== null);

// ── The One-Click case ──────────────────────────────────────────────────────
// A mail client acting on List-Unsubscribe sends "unsubscribe" as the SUBJECT
// with an empty body. Reading only the body missed every one of those, which is
// how a journalist who pressed Unsubscribe in Gmail carried on being emailed.
check('subject-only opt-out', unsubPhrase('', 'unsubscribe') === 'unsubscribe');
check('subject-only with an empty body and no match elsewhere',
  unsubPhrase('   ', 'Unsubscribe') === 'unsubscribe');

// ── Not opt-outs ────────────────────────────────────────────────────────────
check('an interested reply is not an opt-out',
  unsubPhrase('Great, send me the images at print resolution.', 'Re: release') === null);
check('a question is not an opt-out',
  unsubPhrase('What is the embargo on this?', 'Re: release') === null);
check('empty is not an opt-out', unsubPhrase('', '') === null);

// ── Our own quoted footer ───────────────────────────────────────────────────
// Every reply carries a copy of the mail it answers, and ours ends with an
// unsubscribe line. Matching the whole body would mark every single reply as an
// opt-out, including "yes please".
const quoted = [
  'Yes please, send them over.',
  '',
  'On Mon, 12 Oct 2026, October Communications wrote:',
  '> Hotels spend seven figures on design, then hang stock art.',
  "> If this isn't relevant to your beat, no hard feelings — unsubscribe here.",
  '> To be removed from the list, click unsubscribe.',
].join('\n');
check('a quoted footer below a positive reply is ignored', unsubPhrase(quoted, 'Re: release') === null);

const quotedDash = [
  'Happy to take a look.',
  '-----Original Message-----',
  'From: October Communications',
  'Please remove from your list if this is not relevant.',
].join('\n');
check('an Outlook-style quote block is ignored', unsubPhrase(quotedDash, 'Re: release') === null);

// A real opt-out ABOVE a quoted footer must still be caught — the quote
// stripping must not swallow the message.
const realAboveQuote = [
  'Please take me off this list.',
  '',
  'On Mon, October Communications wrote:',
  '> the release text',
].join('\n');
check('a genuine opt-out above a quote is still caught',
  unsubPhrase(realAboveQuote, 'Re: release') === 'take me off');

// ── Case and spacing ────────────────────────────────────────────────────────
check('case-insensitive', unsubPhrase('PLEASE REMOVE ME.', 'Re: x') === 'remove me');
check('hyphenated opt-out', unsubPhrase('I want to opt-out.', 'Re: x') === 'opt-out');

console.log(`replyCatchup: ${passed} checks passed.`);
