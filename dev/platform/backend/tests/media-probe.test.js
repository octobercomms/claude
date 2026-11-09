// Guard — what an uploaded file says about itself, read off the file.
//
// Three places needed this and there were two copies of it. `routes/compose.js`
// probed clips, probed audio with a second narrower copy of the same spawn,
// and `routes/assets.js` — the Library drop target, which is how footage
// actually enters OMI — recorded no width, no height and no duration at all.
//
// The cost of that was not a missing field. `pickAsset` in the editor reads
// `asset.duration_s` and falls back to `STILL_DEFAULT_LEN` (3.2s) when there
// is none, so a 90-second clip from the Library arrived on the timeline three
// seconds long and rendered truncated, with nothing failing anywhere.
//
// This probes real footage that ffmpeg makes here, rather than a stub. A
// mocked ffprobe would have passed every day the bug existed, because the
// route never called one.
//
//   node tests/media-probe.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { parseFraction, probeMedia, probeForRecord } = require('../src/services/mediaProbe');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omi-probe-'));
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= tol;

const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'ignore' });

(async () => {
  try {
    // A two-second clip, a photograph, a sound, and one at 29.97 — which is
    // the rate every camera in the building shoots and the only reason
    // parseFraction exists.
    const clip = path.join(DIR, 'clip.mp4');
    const still = path.join(DIR, 'still.png');
    const sound = path.join(DIR, 'sound.wav');
    const ntsc = path.join(DIR, 'ntsc.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-t', '2', '-pix_fmt', 'yuv420p', clip]);
    ff(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=1', '-frames:v', '1', still]);
    ff(['-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1.5', sound]);
    ff(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30000/1001', '-t', '1',
      '-r', '30000/1001', '-pix_fmt', 'yuv420p', ntsc]);

    // ── The probe itself ──────────────────────────────────────────────
    const p = await probeMedia(clip);
    check('a clip reports its real length', near(p.duration, 2, 0.15), `duration ${p.duration}`);
    check('and its real frame size', p.width === 320 && p.height === 240, `${p.width}x${p.height}`);
    check('and its frame rate', p.fps === 30, `fps ${p.fps}`);

    const n = await probeMedia(ntsc);
    check('29.97 comes back as 30 rather than 0 or NaN', n.fps === 30,
      `fps ${n.fps} — ffprobe reports this as the ratio 30000/1001, and an unparsed `
      + 'ratio is the kind of value that reaches a render as "0 fps"');

    // ── What the asset row keeps ──────────────────────────────────────
    const rowClip = await probeForRecord(clip, 'video/mp4');
    check('the row gets the clip duration the editor needs',
      near(rowClip.duration_s, 2, 0.15), `duration_s ${rowClip.duration_s}`);
    check('with the dimensions', rowClip.width === 320 && rowClip.height === 240,
      `${rowClip.width}x${rowClip.height}`);

    const rowStill = await probeForRecord(still, 'image/png');
    check('a photograph gets its size', rowStill.width === 640 && rowStill.height === 360,
      `${rowStill.width}x${rowStill.height}`);
    check('and no duration, because it has none of its own',
      rowStill.duration_s === null,
      `duration_s ${rowStill.duration_s} — ffprobe reads a photograph as a one-frame video `
      + "stream, so this field is whatever that frame's header happened to say. The "
      + "item's length on the timeline is the editor's choice.");

    const rowSound = await probeForRecord(sound, 'audio/wav');
    check('a sound gets its duration', near(rowSound.duration_s, 1.5, 0.15),
      `duration_s ${rowSound.duration_s}`);
    check('and no frame size', rowSound.width === null && rowSound.height === null,
      `${rowSound.width}x${rowSound.height}`);

    // ── Failure, which the batch upload must survive ──────────────────
    const missing = path.join(DIR, 'not-here.mp4');
    const rowMissing = await probeForRecord(missing, 'video/mp4');
    check('an unreadable file costs that file its duration, not the request',
      rowMissing.duration_s === null && rowMissing.width === null,
      `${JSON.stringify(rowMissing)} — 25 files go up at a time and one bad header `
      + 'must not take the other 24 rows with it');

    let threw = false;
    await probeMedia(missing).catch(() => { threw = true; });
    check('while the clip upload still fails loudly on one', threw,
      'a clip whose length nobody knows cannot be placed on a timeline, so that route '
      + 'has always rejected rather than guessed, and this keeps it doing so');

    // ── The ratio parser, which is only reachable through the probe ───
    check('and the ratio parser is the one the probe uses',
      parseFraction('30000/1001') === 30 && parseFraction('24000/1001') === 24
      && parseFraction('') === 30 && parseFraction('30/0') === 30,
      'exported from the service rather than copied into a test file, which is how the '
      + 'previous version of this assertion could not have noticed its deletion');
  } catch (e) {
    fail += 1;
    console.log('FAIL  the guard itself did not run\n ', e.message);
  } finally {
    fs.rmSync(DIR, { recursive: true, force: true });
  }

  console.log('---');
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
  console.log('A FILE SAYS HOW LONG IT IS');
  assert.ok(pass > 0);
})();
