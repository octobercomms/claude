// A failed cleanup has to be deletable, and has to say why in English.
//
// Three real failures from the Audio screen on 18 November, verbatim from the
// red box the operator was shown:
//
//   401 {"detail":{"type":"invalid_request","code":"quota_exceeded",...}}
//   400 {"detail":{"type":"validation_error","code":"audio_too_short",...}}
//
// None of it reads as an instruction, two of the three offered a "Try again"
// that could never work, and none of them could be deleted at all: the Delete
// button lived inside the `status === 'ready'` branch, so a file that failed
// stayed in the list for good.
//
// This pins the two halves that are testable without a browser: the duration
// floor that stops a too-short recording ever being stored, and the wording
// the screen puts in front of somebody. The Delete button's placement is
// asserted by reading the page, which is crude but catches the exact
// regression that caused this.
//
//   node tests/audio-failures.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };

const PAGE = fs.readFileSync(
  path.join(__dirname, '../../frontend/src/pages/AudioPage.jsx'), 'utf8');
const ROUTE = fs.readFileSync(
  path.join(__dirname, '../src/routes/audio.js'), 'utf8');

ok('a failed recording can be deleted', () => {
  // The error branch, up to the next top-level branch, must offer Delete.
  const start = PAGE.indexOf("current.status === 'error'");
  assert.ok(start > 0, 'the error branch is gone from AudioPage');
  const next = PAGE.indexOf("current.status === 'ready'", start);
  assert.ok(next > start, 'the ready branch is gone from AudioPage');
  const errorBranch = PAGE.slice(start, next);

  assert.ok(/remove\(current\.id\)/.test(errorBranch),
    'the error branch no longer offers Delete — a cleanup that failed cannot '
    + 'be removed, which is the state Daniel hit on 18 November with three '
    + 'failed files stuck in the list');
});

ok('a too-short recording is not offered a pointless retry', () => {
  const start = PAGE.indexOf("current.status === 'error'");
  const next = PAGE.indexOf("current.status === 'ready'", start);
  const errorBranch = PAGE.slice(start, next);
  assert.ok(/retryable/.test(errorBranch),
    'Try again is unconditional again — it is shown on a recording that is '
    + 'simply too short, where the same file fails the same way every time');
});

ok('the real failures translate into something actionable', () => {
  // Pull the translator out of the page and run it, so the assertions are
  // against the shipped function rather than a copy that can drift.
  const fnStart = PAGE.indexOf('function explainAudioError');
  assert.ok(fnStart > 0, 'explainAudioError is gone from AudioPage');
  const after = PAGE.slice(fnStart);
  const end = after.indexOf('\n}\n');
  assert.ok(end > 0, 'could not read explainAudioError');
  // eslint-disable-next-line no-new-func
  const explain = new Function(`${after.slice(0, end + 2)}; return explainAudioError;`)();

  const tooShort = explain('ElevenLabs Audio Isolation 400: {"detail":{"type":"validation_error",'
    + '"code":"audio_too_short","message":"Audio duration is 4.3 seconds, which is below the '
    + 'minimum of 4.6 seconds.","status":"invalid_audio_duration"}}');
  assert.ok(/too short/i.test(tooShort.message), 'the too-short case is not explained');
  assert.ok(tooShort.message.includes('4.3') && tooShort.message.includes('4.6'),
    'the explanation dropped the actual durations, which are the useful part');
  assert.strictEqual(tooShort.retryable, false,
    'a too-short recording was marked retryable — the same file fails identically');

  const quota = explain('ElevenLabs Audio Isolation 401: {"detail":{"type":"invalid_request",'
    + '"code":"quota_exceeded","message":"This request exceeds your quota of 10000. You have '
    + '2000 credits remaining, while 2207 credits are required for this request."}}');
  assert.ok(/credits/i.test(quota.message), 'the quota case is not explained');
  assert.ok(quota.message.includes('2000') && quota.message.includes('2207'),
    'the explanation dropped the credit figures, which say how much to top up');
  assert.strictEqual(quota.retryable, true,
    'topping up and retrying is exactly what fixes a quota failure');

  // Anything unrecognised keeps its text. Flattening it would throw away the
  // request id, which is the only thing a support conversation can use.
  const odd = explain('ElevenLabs Audio Isolation 503: upstream exploded, request_id abc123');
  assert.ok(odd.message.includes('abc123'),
    'an unrecognised error lost its original text, and with it the request id');
  assert.strictEqual(odd.retryable, true);
});

ok('a too-short upload is refused before anything is stored', () => {
  assert.ok(/MIN_DURATION_S\s*=\s*4\.6/.test(ROUTE),
    'the duration floor is gone or no longer matches ElevenLabs\' own 4.6s');

  const postStart = ROUTE.indexOf("router.post('/'");
  assert.ok(postStart > 0, 'the upload route is gone');
  const body = ROUTE.slice(postStart, postStart + 2500);

  const checkAt = body.indexOf('durationBelowMinimum');
  const saveAt = body.indexOf('saveBuffer');
  const insertAt = body.indexOf('INSERT INTO audio_cleanups');
  assert.ok(checkAt > 0, 'the upload no longer checks duration before accepting');
  assert.ok(saveAt > checkAt,
    'the file is stored before the duration is checked, so a recording that '
    + 'cannot be cleaned still takes up space');
  assert.ok(insertAt > checkAt,
    'the row is created before the duration is checked, which is what left '
    + 'undeletable failed rows in the list');
});

ok('the duration check fails open', () => {
  const fnStart = ROUTE.indexOf('async function durationBelowMinimum');
  assert.ok(fnStart > 0, 'durationBelowMinimum is gone');
  const fn = ROUTE.slice(fnStart, ROUTE.indexOf('\n}\n', fnStart));
  assert.ok(/catch\s*\{\s*\n\s*return null;/.test(fn),
    'the probe no longer fails open — a missing ffprobe or an unreadable '
    + 'container would now block an upload that would have worked');
  assert.ok(/duration > 0/.test(fn),
    'a zero duration is being treated as too short; ffprobe reports zero when '
    + 'it read the container but found no duration, which is not the same thing');
});

console.log(`\n${passed} passed, 0 failed`);
