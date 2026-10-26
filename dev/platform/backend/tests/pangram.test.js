/**
 * The detector client, tested where it can be: the parts that run without a
 * key, a network or a bill.
 *
 * The field names this parses were taken from Pangram's published pages, not
 * from a live response, because the environment it was written in cannot reach
 * pangram.com. These assertions therefore prove the parser handles the SHAPES
 * it was designed for — flat, nested, fraction, percentage — and not that those
 * are the shapes the provider sends. The first real call settles that, which is
 * why an unreadable response is surfaced on screen rather than swallowed.
 */
const pangram = require('../src/services/pangram');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label); failures += 1; }
};

console.log('Pricing matches the published rate');
ok(pangram.estimateUsd('w '.repeat(100)) === 0.05, '$0.05 for 100 words');
ok(Math.abs(pangram.estimateUsd('w '.repeat(672)) - 0.336) < 0.0001,
  'a 672-word release is $0.34, as the pricing page implies');
ok(pangram.estimateUsd('') === 0, 'nothing costs nothing');

console.log('\nThe fingerprint is what stops a second bill for the same text');
const a = pangram.fingerprint('The wall is 28 metres tall.');
ok(a === pangram.fingerprint('  The wall is 28 metres tall.  '),
  'surrounding whitespace does not count as a change');
ok(a !== pangram.fingerprint('The wall is 29 metres tall.'),
  'an edited number does');

console.log('\nThe documented response is read correctly');
// Shape taken verbatim from docs.pangram.com/quickstart-rest.
const DOC = {
  stage: 'STAGE_SUCCESS', version: '4.0', headline: 'AI Detected',
  prediction: 'We believe that this text is a mix of AI and human content.',
  prediction_short: 'AI',
  fraction_ai: 0.87, fraction_ai_assisted: 0.05, fraction_human: 0.08,
  num_ai_segments: 3, num_ai_assisted_segments: 1, num_human_segments: 1,
  windows: [{
    text: 'Each pair is designed to the guest\u2019s own taste', label: 'AI',
    ai_assistance_score: 0.98, confidence: 'High',
    start_index: 0, end_index: 45, word_count: 9,
    is_humanized: false, humanizer_score: 0.0,
  }],
};
const read = pangram.readResult(DOC);
ok(read.pct === 87, 'fraction_ai is the figure the dashboard shows as % AI');
ok(read.pct_human === 8, 'and the human fraction comes through too');
ok(read.headline === 'AI Detected', 'the headline is the summary classification');
ok(read.segments_ai === 3, 'the segment counts are read');

console.log('\nSegment offsets survive, because they are what gets highlighted');
ok(read.windows.length === 1, 'windows are read');
ok(read.windows[0].start_index === 0 && read.windows[0].end_index === 45,
  'with their character offsets intact');
ok(read.windows[0].confidence === 'High' && read.windows[0].label === 'AI',
  'and their label and confidence');

console.log('\nA human-written result reads the other way');
const human = pangram.readResult({
  stage: 'STAGE_SUCCESS', headline: 'Human Written', prediction_short: 'Human',
  fraction_ai: 0.0, fraction_ai_assisted: 0.0, fraction_human: 1.0,
  num_ai_segments: 0, num_human_segments: 1, windows: [],
});
ok(human.pct === 0 && human.pct_human === 100, 'nothing AI, all human');
ok(human.headline === 'Human Written', 'and the headline says so');

console.log('\nNothing is invented from a response that lacks the fields');
ok(pangram.readResult({}).pct === null, 'a missing fraction_ai is null, never a guess');
ok(pangram.readResult(null).pct === null, 'null does not throw');
ok(pangram.readResult({ windows: 'nope' }).windows.length === 0, 'a bad windows field is empty');

console.log('\nThe documented status codes say what to do about them');
ok(/API key/i.test(pangram.describeStatus(401, '')), '401 names the key');
ok(/credits/i.test(pangram.describeStatus(402, '')), '402 names the credits');
ok(/not enabled/i.test(pangram.describeStatus(403, '')), '403 names the model entitlement');
ok(/rate limit/i.test(pangram.describeStatus(429, '')), '429 names the rate limit');

// --- the check has to see what is on screen -----------------------------------
//
// The server reads body_html from the row, so an unsaved edit is invisible to
// it. For the detector that was worse than invisible: the stored text was
// unchanged, its fingerprint matched the last check, and the answer came back
// from cache saying "Unchanged since the last check". Edit a paragraph, press
// Check again, and it reported that nothing had changed.
//
// Every server-side action on a release has the same shape, so all three flush
// the editor first.
const fs = require('fs');
const path = require('path');
const editor = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'PressReleaseEditor.jsx'), 'utf8');

console.log('\nThe editor saves before it asks the server about the text');
ok(/async function flush\(\)/.test(editor) && /onSave\(\{ quiet: true \}\)/.test(editor),
  'there is one flush, and it saves quietly');
ok((editor.match(/if \(!\(await flush\(\)\)\) return;/g) || []).length === 3,
  'the detector, the brief and the claim check all use it');
ok(/Could not save, so nothing was sent to check/.test(editor),
  'a failed save stops the call rather than billing a check on stale text');

const parent = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'ClientPRPage.jsx'), 'utf8');
ok(/savePR\(extra, \{ quiet = false \} = \{\}\)/.test(parent)
  && /if \(!extra && !quiet\)/.test(parent),
  'the parent can save without a toast for each of those three');
ok(/onClick=\{\(\) => onSave\(\)\}/.test(editor),
  'the Save button passes no argument, so a click event cannot land in the options');

// --- putting the detector's segments back where they came from ----------------
//
// The segment list was only ever shown as cards in the rail, which left 32
// quotations to hunt for by eye in the release. These locate each one in the
// text so it can be marked, and report the ones that are no longer there.
//
// Both sides of the comparison start from the same stripHtml, so the fixtures
// below build the segment the way the route does: strip the body, then slice
// out of the result. That is the real round trip, not an approximation of it.
async function segments() {
  const m = await import(require('url').pathToFileURL(
    require('../src/services/humanity').MODULE_PATH).href);
  const { stripHtml, flatten, locateSegment } = m;

  const BODY = '<p>In 2011 Gavi Wolf co-founded Indiewalls in Brooklyn.</p>'
    + '<p>The company has paid more than $10&nbsp;million directly to independent artists.</p>'
    + '<p>“Clients were paying for the service,” says Wolf.</p>'
    + '<p>Fifteen years later the company’s programs run in six countries.</p>';
  const plain = stripHtml(BODY);
  const hay = flatten(plain);
  const find = (seg) => locateSegment(hay, plain, seg);

  console.log('\nA segment is found in the text it came from');
  const seg = plain.slice(plain.indexOf('The company'), plain.indexOf('artists.') + 8);
  const hit = find(seg);
  ok(hit && hit.length === 1, 'one paragraph, one needle');
  ok(hit && plain.includes(hit[0]), 'and the needle is the release’s own characters');

  console.log('\nA segment running across a paragraph break comes back split');
  const across = plain.slice(plain.indexOf('In 2011'), plain.indexOf('artists.') + 8);
  const split = find(across);
  ok(split && split.length === 2, 'two needles, because a mark cannot span two paragraphs');
  ok(split && split.every((t) => !/\n/.test(t)), 'and neither carries a line break');

  console.log('\nTypography that survived one path and not the other is not an edit');
  ok(find('"Clients were paying for the service," says Wolf.'),
    'straight quotes match the curly ones in the release');
  ok(find('more than $10 million directly'), 'a non-breaking space matches an ordinary one');
  ok(find("later the company's programs run"), 'a straight apostrophe matches a typographic one');
  // Defensive rather than observed: the detector has not been seen to re-space
  // what it sends back. If it ever does, a doubled space would otherwise read
  // as the passage having been rewritten.
  ok(find('has paid  more  than $10 million'), 'and a run of spaces is not a difference');

  console.log('\nA passage that is no longer there reports as gone, which is the point');
  ok(find('Wolf tried renting art to hotels and offices.') === null,
    'text that was rewritten or cut is not located');
  ok(find('short') === null, 'and a fragment too short to place is not guessed at');

  console.log('\nThe editor wires both of them to the page');
  const fs = require('fs');
  const path = require('path');
  const ed = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src',
    'components', 'PressReleaseEditor.jsx'), 'utf8');
  ok(/cls: 'oc-machine'/.test(ed), 'there is a layer for what the detector flagged');
  const hl = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src',
    'utils', 'releaseHighlight.js'), 'utf8');
  ok(/mark\.oc-bare, mark\.oc-tell, mark\.oc-fact, mark\.oc-machine/.test(hl),
    'and unmark strips it, so our marks are never saved into the release');
  ok(/found: !!lines/.test(ed) && /rewritten since this check/.test(ed),
    'a flagged passage that has gone says so on its card');
  ok(/function goToSegment\(i\)/.test(ed) && /data-oc-doc/.test(ed),
    'and a card jumps to the passage it names');

  // Paint order, which decides whether the layer appears at all. A detector
  // segment runs to a whole paragraph, so anything painted before it has
  // already split the text nodes it needs to match against, and it silently
  // marks nothing. tests/browser/highlight.mjs proves that in a real DOM; this
  // holds the order the editor actually declares.
  const keys = [...ed.slice(ed.indexOf('const LAYERS = ['), ed.indexOf('\n];'))
    .matchAll(/key: '(\w+)'/g)].map((m) => m[1]);
  ok(keys[0] === 'machine', `the detector's segments are painted first · ${keys.join(' > ')}`);
  ok(keys.indexOf('thin') < keys.indexOf('phrasing'),
    'and a whole sentence still goes down before the phrases inside it');
}

segments().then(() => {
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}).catch((e) => { console.log('  FAIL ', e.message); process.exit(1); });

