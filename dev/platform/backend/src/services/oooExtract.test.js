// Standalone tests for out-of-office extraction. No test framework in this
// project, so this runs with plain
//   node src/services/oooExtract.test.js
// and exits non-zero on the first failure. Pure module — no DB, no HTTP.
//
// Most of the sentences below are verbatim from October's own auto-replies.
// They are here because each one broke an earlier version of this code, and
// the failures were the dangerous kind: a plausible-looking wrong answer that a
// reviewer would have approved.

const assert = require('assert');
const x = require('./oooExtract');

let passed = 0;
function check(name, cond) {
  assert.ok(cond, `FAILED: ${name}`);
  passed++;
}
// The name this sentence yields for its (single) address.
function nameFor(sentence, sender) {
  const got = x.extractContacts(sentence, { senderEmail: sender || '' });
  return got.length ? got[0].name : null;
}

// ── Auto-reply detection ────────────────────────────────────────────────────
check('English subject prefix', x.isAutoReply({ subject: 'Automatic reply: Press release' }));
check('out of office', x.isAutoReply({ subject: 'Out of Office Re: Atlanta Design Festival' }));
check('bracket tag before the prefix', x.isAutoReply({ subject: '[EXTERNAL] Automatic reply: hello' }));
check('French', x.isAutoReply({ subject: 'Réponse automatique : Press Release' }));
check('German', x.isAutoReply({ subject: 'Automatische Antwort: Pressemitteilung' }));
check('RFC 3834 header with no telltale subject',
  x.isAutoReply({ subject: 'Thanks for getting in touch', headers: 'Auto-Submitted: auto-replied' }));
check('Auto-Submitted: no is not an auto-reply',
  !x.isAutoReply({ subject: 'Re: your pitch', headers: 'Auto-Submitted: no' }));
check('a human reply is not an auto-reply',
  !x.isAutoReply({ subject: 'Re: Hotels spend seven figures on design' }));
check('"automatic reply" mid-subject does not count',
  !x.isAutoReply({ subject: 'Re: question about your automatic reply' }));

// ── The name must be corroborated by the address ────────────────────────────
// The bug this exists for: the nearest capitalised word is a magazine, not a
// person, and taking it would write "Starboard" into a contact's name.
check('a publication between the name and the address is not the name',
  nameFor('Please contact Hannah Wintle for Sleeper / Starboard at h.wintle@mondiale.co.uk.') === 'Hannah Wintle');
check('and again with a different section name',
  nameFor('Abby Lowe for Supper at a.lowe@mondiale.co.uk.') === 'Abby Lowe');
check('a lowercase connector does not end the name',
  nameFor('If you need immediate assistance, email Alexis Muellner at amuellner@bizjournals.com') === 'Alexis Muellner');
check('a job title before the name is stripped',
  nameFor('please contact Executive Editor Brian Kaberline (bkaberline@bizjournals.com)') === 'Brian Kaberline');
check('a name after a comma still reads',
  nameFor('please reach out to our Student Success Advisor for Interior Design, Shannon Morris, at smorris@scad.edu.') === 'Shannon Morris');
check('an uncorroborated capitalised word is not used as a name',
  nameFor('I am away. Urgent: helper@example.net') === '');
check('a masthead abbreviation is not a person',
  nameFor('Please email the AJ news editor richard.waite@emap.com.') === 'Richard Waite');
check('that one is marked as inferred from the address',
  x.extractContacts('Please email the AJ news editor richard.waite@emap.com.')[0].nameInferred === true);
check('a name stated and corroborated is not marked inferred',
  x.extractContacts('contact Jim Ross at jross@usatodayco.com.')[0].nameInferred === false);
check('an unmatched name in the sentence raises the flag',
  x.extractContacts('I am away. Urgent: helper@example.net')[0].nameUnverified === true);

// ── nameMatchesEmail ────────────────────────────────────────────────────────
check('surname in the local part', x.nameMatchesEmail('Brian Kaberline', 'bkaberline@bizjournals.com'));
check('dotted local part', x.nameMatchesEmail('Megan Gibson', 'megan.gibson@newstatesman.co.uk'));
check('short surname', x.nameMatchesEmail('Rebecca Fox', 'rfox@odt.co.nz'));
check('a magazine does not match a person’s address',
  !x.nameMatchesEmail('Starboard', 'h.wintle@mondiale.co.uk'));
check('a genuine mismatch is rejected',
  !x.nameMatchesEmail('Nichole Hetchkop', 'nicole@serenbe.com'));

// ── Address validity ────────────────────────────────────────────────────────
check('a normal address is plausible', x.isPlausibleEmail('a.lowe@mondiale.co.uk'));
check('no TLD is rejected', !x.isPlausibleEmail('sabine.weinmann@luther-lawfirm'));
check('no domain is rejected', !x.isPlausibleEmail('justaname'));
check('a double dot is rejected', !x.isPlausibleEmail('a..b@example.com'));

// ── Functional mailboxes ────────────────────────────────────────────────────
for (const e of ['jobs@dezeen.com', 'cv@shine.tv', 'newsdesk@theintermediary.co.uk',
  'advertising@astormedia.co.uk', 'contactus@workplacejournal.co.uk', 'info@property118.com',
  'editorial@theatermania.com', 'hitastetestteam@hearst.co.uk', 'us_salesleaders@buzzi.space',
  'housebeautifuldigitalteam@hearst.co.uk']) {
  check(`${e} is a department mailbox`, x.isFunctionalMailbox(e));
}
for (const e of ['h.wintle@mondiale.co.uk', 'jross@usatodayco.com', 'megan.gibson@newstatesman.co.uk',
  'chloe@mixinteriors.com']) {
  check(`${e} is a person`, !x.isFunctionalMailbox(e));
}

// ── Extraction scope ────────────────────────────────────────────────────────
check('the responder’s own address is not proposed back',
  x.extractContacts('I am away, email me at me@x.com', { senderEmail: 'me@x.com' }).length === 0);
check('our own quoted footer is not a contact',
  x.extractContacts('Away. Try helper@example.net. Original message from daniel@octobercomms.com',
    { senderEmail: 's@example.net', ownDomains: ['octobercomms.com'] })
    .every((c) => !/octobercomms\.com$/.test(c.email)));
check('two addresses in one sentence both come out',
  x.extractContacts('If it is urgent, please contact megan.gibson@newstatesman.co.uk or nick.harris@newstatesman.co.uk').length === 2);
check('the same address twice yields one candidate',
  x.extractContacts('email a@b.com. Or a@b.com again.').length === 1);
check('every candidate carries the sentence it came from',
  x.extractContacts('For anything urgent, email robin.searle@travelweekly.co.uk.')[0].quote.includes('urgent'));

// ── Gates ───────────────────────────────────────────────────────────────────
const codes = (c, o) => x.gate(c, o).map((f) => f.code);
check('a named person with no address is flagged',
  codes({ name: 'Simon Lambert', email: '', quote: 'If urgent, please contact Simon Lambert' }).includes('no_email'));
check('a truncated address is flagged invalid',
  codes({ name: 'Sabine Weinmann', email: 'sabine.weinmann@luther-lawfirm', quote: '' }).includes('invalid_email'));
check('a department mailbox is flagged',
  codes({ name: '', email: 'jobs@dezeen.com', quote: 'please contact the Dezeen Jobs team at jobs@dezeen.com' }).includes('functional_mailbox'));
check('an address neither quoted nor matching the name is flagged',
  codes({ name: 'Angelica Colon', email: 'someone.else@scad.edu', quote: 'please reach out to Shannon Morris' }).includes('unsupported_email'));
check('an address present in the quote is not flagged unsupported',
  !codes({ name: '', email: 'chloe@mixinteriors.com', quote: 'please contact chloe@mixinteriors.com.' }).includes('unsupported_email'));
check('a name matching the address is not flagged unsupported',
  !codes({ name: 'Megan Gibson', email: 'megan.gibson@newstatesman.co.uk', quote: 'contact her' }).includes('unsupported_email'));
check('an old reply is flagged stale',
  codes({ name: 'A B', email: 'a.b@x.com', quote: 'a.b@x.com', sourceDate: '2017-03-20' }).includes('stale'));
check('a recent reply is not',
  !codes({ name: 'A B', email: 'a.b@x.com', quote: 'a.b@x.com', sourceDate: new Date().toISOString() }).includes('stale'));
check('the stale window is configurable',
  codes({ name: 'A B', email: 'a.b@x.com', quote: 'a.b@x.com', sourceDate: '2026-01-01' }, { staleMonths: 1 }).includes('stale'));

// ── Identity ────────────────────────────────────────────────────────────────
const idA = x.suggestionId({ sender: 'C.Martin@Mondiale.co.uk', subject: 'Automatic reply: Hotels spend seven figures', date: '2026-10-07' });
const idB = x.suggestionId({ sender: 'c.martin@mondiale.co.uk', subject: 'Hotels spend seven figures', date: '2026-10-07T14:22:00Z' });
check('the CSV row and the IMAP message converge on one id', idA === idB);
check('a different sender is a different id',
  x.suggestionId({ sender: 'other@mondiale.co.uk', subject: 'Automatic reply: Hotels', date: '2026-10-07' }) !== idA);
check('a different day is a different id',
  x.suggestionId({ sender: 'c.martin@mondiale.co.uk', subject: 'Automatic reply: Hotels spend seven figures', date: '2026-10-08' }) !== idA);
check('the id is stable across calls',
  x.suggestionId({ sender: 'a@b.com', subject: 'x', date: '2026-01-01' }) === x.suggestionId({ sender: 'a@b.com', subject: 'x', date: '2026-01-01' }));
check('bracket tags and Re: are stripped from the subject',
  x.normaliseSubject('[EXT] Automatic reply: Re: The properties pulling ahead') === 'the properties pulling ahead');

// ── Sentence splitting ──────────────────────────────────────────────────────
check('a dot inside an address does not split the sentence',
  x.sentences('Email megan.gibson@newstatesman.co.uk today.').length === 1);
check('two sentences split',
  x.sentences('I am away. Contact a@b.com.').length === 2);

console.log(`oooExtract: ${passed} checks passed.`);
