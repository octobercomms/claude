// What has to be true before a release can be pitched.
//
// There were two gates on this and they disagreed, which is the worst number
// of gates to have:
//
//   the editor      enabled "Create pitch campaign" once the reporting read
//                   as done — its own comment says "the pitch gate used to be
//                   'a client approved it'. It is now 'the reporting is done'"
//   the endpoint    required status IN ('approved','sent')
//
// Nothing in the agency UI can set 'approved'. The only writer is
// prPress.approveByToken, reached from the public review link in
// routes/prPortal — a client clicking approve. So a release Daniel wrote and
// finished showed an enabled button that answered 400, and the only way past
// it was to send the client a review link and wait for them.
//
// Neither half was wrong on its own, which is why it survived: the editor's
// gate is the useful one and the endpoint's was a leftover. This reads the
// source of both and fails if they drift apart again.
//
//   node tests/press-campaign-gate.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'pr.js'), 'utf8');
const editor = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'PressReleaseEditor.jsx'), 'utf8');
const prPress = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'prPress.js'), 'utf8');

// The handler body, from its route line to the end of its try block.
const start = route.indexOf("router.post('/press-releases/:prId/create-campaign'");
assert.ok(start > -1, 'the create-campaign route is gone entirely');
const end = route.indexOf('});', route.indexOf('res.status(201)', start));
const handler = route.slice(start, end);

console.log('pitching a release');

check('a client sign-off is not required to build the campaign', () => {
  assert.ok(!/status\)|\bp\.status\b/.test(handler) || !/'approved'/.test(handler),
    'the handler is gating on the release status again. The only thing that sets '
    + "'approved' is a client clicking the public review link, so this blocks the "
    + 'person who wrote the release from pitching their own work.');
});

check('there is still nothing to pitch without a body', () => {
  assert.ok(/body_html/.test(handler) && /Draft the release body first/.test(handler),
    'an empty release should not create a campaign and a four-step send sequence');
});

check('it stays idempotent', () => {
  assert.ok(/campaign_id\)\s*return res\.json\(\{ campaign_id/.test(handler.replace(/\s+/g, ' '))
    || /if \(p\.campaign_id\)/.test(handler),
    'clicking twice must return the existing campaign, not make a second one');
});

check('the editor is where the reporting gate lives', () => {
  // If this moves, the handler is the only gate left and the comment above is
  // no longer true.
  assert.ok(/disabled:\s*reading\.verdict === 'not_ready'/.test(editor),
    'the editor no longer gates the pitch button on the reporting verdict — '
    + 'with the status check gone from the endpoint there would be no gate at all');
});

check('approval is still only ever a client action', () => {
  // The premise of removing the gate: no agency control sets this. If an
  // agency-side approve appears, the endpoint gate becomes arguable again and
  // this test should be revisited rather than quietly passing.
  const writers = [...route.matchAll(/status\s*=\s*'approved'/g)].length;
  assert.strictEqual(writers, 0,
    'routes/pr.js now sets a release to approved itself — the reasoning for '
    + 'dropping the endpoint gate assumed only the client portal could');
  assert.ok(/approveByToken/.test(prPress),
    'the client sign-off path is gone; it is meant to stay available, just not be a gate');
});

check('the client review flow still exists', () => {
  const portal = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'prPortal.js'), 'utf8');
  assert.ok(/approveByToken/.test(portal),
    'the public review link no longer records a sign-off. Removing the gate was '
    + 'meant to stop it blocking the writer, not to delete the client step.');
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
