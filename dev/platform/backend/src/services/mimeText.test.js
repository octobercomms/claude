// Guard — a reply is read as the journalist wrote it.
//
// Every case here is taken from, or modelled directly on, a message that was
// in October's own press@ mailbox and came out wrong: the multipart boundary
// stored as the reply text, two base64 bodies never decoded, a gb2312 part
// read as UTF-8. The last two matter beyond legibility, because the opt-out
// keyword scan reads the same text: an undecoded body cannot match "please
// remove me", so that opt-out was silently missed.
//
// No database, no network. Runs in CI.

const mime = require('./mimeText');
const replies = require('./outreachReplies');

let pass = 0;
let fail = 0;

function check(name, got, want) {
  const ok = typeof want === 'function' ? want(got) : got === want;
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, '\n  got:  ', JSON.stringify(got)?.slice(0, 400)); }
}

const contains = (needle) => (got) => String(got).includes(needle);
const lacks = (needle) => (got) => !String(got).includes(needle);

// ---------------------------------------------------------------------------
// 1. The defect that started this: a multipart boundary read as the body.

const gmailMultipart = [
  'From: Jessica Furseth <jessica.furseth@gmail.com>',
  'Subject: Re: Indie.Art launched Hotel Art this month',
  'Content-Type: multipart/alternative; boundary="00000000000009241706"',
  '',
  '--00000000000009241706',
  'Content-Type: text/plain; charset="UTF-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hi Daniel, thanks for sending this - in answer to your questions, I don=27t',
  'usually write stories directly following news but I enjoy getting releases',
  'like so I can pick up on wider trends.',
  '',
  'Jess',
  '',
  '--00000000000009241706',
  'Content-Type: text/html; charset="UTF-8"',
  '',
  '<div dir="ltr">Hi Daniel, thanks for sending this</div>',
  '',
  '--00000000000009241706--',
  '',
].join('\r\n');

const jess = mime.bodyText(gmailMultipart);
check('the boundary line is gone', jess, lacks('--00000000000009241706'));
check('the part headers are gone', jess, lacks('Content-Transfer-Encoding'));
check('no Content-Type leaks in', jess, lacks('Content-Type'));
check('the journalist’s words survive', jess, contains('I enjoy getting releases'));
check('quoted-printable is decoded', jess, contains("I don't"));
check('the plain part wins over the HTML one', jess, lacks('<div'));

// ---------------------------------------------------------------------------
// 2. Base64. Two of the six on the review screen were this.

const typed = 'Hi Daniel,\r\n\r\nThanks for getting in touch. Please remove me from this list.\r\n\r\nBest, Johanna';
const base64Outlook = [
  'From: Johanna Baker-Dowdell <johanna@strawberrycommunications.com.au>',
  'Subject: Re: The properties pulling ahead',
  'Content-Type: multipart/alternative; boundary="_000_SYCPR01MB3182_"',
  '',
  '--_000_SYCPR01MB3182_',
  'Content-Type: text/plain; charset="utf-8"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from(typed, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
  '--_000_SYCPR01MB3182_--',
  '',
].join('\r\n');

const johanna = mime.bodyText(base64Outlook);
check('base64 is decoded', johanna, contains('Thanks for getting in touch'));
check('no base64 residue', johanna, lacks('Q29udGVudC'));

// The reason this is not cosmetic: the opt-out scan reads this same text.
check(
  'an opt-out typed in a base64 body is now caught',
  replies.looksLikeUnsubscribe(johanna, 'Re: The properties pulling ahead'),
  true
);
// And what the old code would have fed it.
const oldWay = base64Outlook.slice(base64Outlook.search(/\r\n\r\n/) + 4).replace(/\s+/g, ' ');
check(
  'the old body-splitting missed that opt-out',
  replies.looksLikeUnsubscribe(oldWay, 'Re: The properties pulling ahead'),
  false
);

// ---------------------------------------------------------------------------
// 3. Charsets other than UTF-8. gb2312 appeared in October's mailbox.

const gbBytes = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);   // "你好" in gb2312
const gbMessage = Buffer.concat([
  Buffer.from('Subject: hi\r\nContent-Type: text/plain; charset="gb2312"\r\n\r\n', 'latin1'),
  gbBytes,
]);
check('gb2312 decodes to the right characters', mime.bodyText(gbMessage), contains('你好'));

const latinMessage = Buffer.concat([
  Buffer.from('Content-Type: text/plain; charset=iso-8859-1\r\n\r\nCaf', 'latin1'),
  Buffer.from([0xe9]),
]);
check('iso-8859-1 decodes', mime.bodyText(latinMessage), contains('Café'));

check('an unknown charset falls back rather than throwing',
  mime.bodyText('Content-Type: text/plain; charset=x-made-up\r\n\r\nplain words'),
  contains('plain words'));

// ---------------------------------------------------------------------------
// 4. Structure the old code never looked at.

const withAttachment = [
  'Content-Type: multipart/mixed; boundary="MIX"',
  '',
  '--MIX',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Happy to cover this. Send images.',
  '--MIX',
  'Content-Type: application/pdf; name="kit.pdf"',
  'Content-Disposition: attachment; filename="kit.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('%PDF-1.4 binary rubbish unsubscribe').toString('base64'),
  '--MIX--',
].join('\r\n');

const attached = mime.bodyText(withAttachment);
check('the typed reply is found beside an attachment', attached, contains('Happy to cover this'));
check('the attachment is not decoded into the reply', attached, lacks('%PDF'));
check('an attachment cannot forge an opt-out',
  replies.looksLikeUnsubscribe(attached, 'Re: pitch'), false);

const nested = [
  'Content-Type: multipart/mixed; boundary="OUT"',
  '',
  '--OUT',
  'Content-Type: multipart/alternative; boundary="IN"',
  '',
  '--IN',
  'Content-Type: text/plain',
  '',
  'Nested but readable.',
  '--IN',
  'Content-Type: text/html',
  '',
  '<p>Nested but readable.</p>',
  '--IN--',
  '--OUT--',
].join('\r\n');
check('nested multipart is walked', mime.bodyText(nested), 'Nested but readable.');

const folded = [
  'Content-Type: multipart/alternative;',
  '\tboundary="FOLDED-BOUNDARY"',
  '',
  '--FOLDED-BOUNDARY',
  'Content-Type: text/plain',
  '',
  'Folded header handled.',
  '--FOLDED-BOUNDARY--',
].join('\r\n');
check('a folded Content-Type still yields its boundary', mime.bodyText(folded), 'Folded header handled.');

// ---------------------------------------------------------------------------
// 5. Plain messages must not regress.

check('a bare message with no Content-Type still reads',
  mime.bodyText('Subject: hi\r\n\r\nJust a plain note.'),
  'Just a plain note.');

check('an HTML-only message is reduced to text',
  mime.bodyText('Content-Type: text/html\r\n\r\n<div>Yes please<br>Geoff</div>'),
  'Yes please\nGeoff');

check('entities are decoded, not left raw',
  mime.htmlToText('<p>Tom &amp; Jerry&#8217;s &quot;piece&quot;</p>'),
  'Tom & Jerry’s "piece"');

check('empty input is empty, not a crash', mime.bodyText(''), '');
check('null input is empty, not a crash', mime.bodyText(null), '');

// ---------------------------------------------------------------------------
// 6. Line structure survives, which is what makes quote-stripping work.

const quoted = [
  'Content-Type: text/plain; charset=utf-8',
  '',
  'No thanks, not for me.',
  '',
  '> Read our release here',
  '> To unsubscribe click this link',
].join('\r\n');

const quotedText = mime.bodyText(quoted);
check('newlines survive the reduction', quotedText, contains('\n'));
check('quoted lines are dropped by replyBodyOnly',
  replies.replyBodyOnly(quotedText).includes('unsubscribe'), false);
check('our own quoted footer no longer reads as an opt-out',
  replies.looksLikeUnsubscribe(quotedText, 'Re: pitch'), false);

// The old collapse-everything behaviour, for contrast: one line, so the ">"
// filter had nothing to match and the footer stayed in.
const oldCollapsed = quoted.slice(quoted.search(/\r\n\r\n/) + 4).replace(/\s+/g, ' ').trim();
check('the old collapse kept our footer in the body',
  replies.replyBodyOnly(oldCollapsed).includes('unsubscribe'), true);

// A genuine opt-out in the part the person typed is still caught.
const realOptOut = mime.bodyText([
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Please remove me from your list, thanks.',
  '',
  '> original release text',
].join('\r\n'));
check('a real opt-out still matches', replies.looksLikeUnsubscribe(realOptOut, 'Re: pitch'), true);

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
