// What an MP4 export is allowed to cost.
//
// The library holds a 997 MB export of a 33 MB recording. Not a bug in the
// obvious sense — it is a legitimate render that someone asked for — but the
// product of a quality target with no ceiling meeting a source that was
// bitrate-capped on the way in.
//
// The recorder caps itself at 2.5 Mbps (frontend/src/utils/captureSettings.js).
// A busy recording therefore arrives full of compression artefacts, and CRF 20
// with no maxrate spends whatever it takes to reproduce them. Measured on a
// 60 s 1080p30 high-entropy source: 313.7 MB uncapped, 60.8 MB with an 8 Mbps
// ceiling. On a realistic near-static screen recording the ceiling changes
// nothing at all — 1.78 MB either way, SSIM identical to six decimals.
//
// So the ceiling is free on every normal export and only engages on the one
// that would otherwise run away. This test is here because that is invisible
// from reading the args: "crf 20" looks like a size decision and is not one.
//
//   node tests/recording-export.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { mp4Args, MP4_MAXRATE, MP4_BUFSIZE } = require('../src/services/recordingExport');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('exporting a recording to MP4');

const args = mp4Args('/in/rec.webm', '/out/rec.mp4');
const at = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };

check('the encoder has an upper bound, not only a quality target', () => {
  assert.ok(args.includes('-maxrate'),
    'no -maxrate: CRF alone lets a noisy source produce an export many times '
    + 'its own size. This is how a 33 MB recording became a 997 MB MP4.');
  assert.ok(args.includes('-bufsize'),
    '-maxrate without -bufsize gives x264 no VBV window, so the ceiling is '
    + 'advisory rather than enforced');
});

check('the ceiling is above anything screen content needs', () => {
  // Generous on purpose: the point is to stop a runaway, not to compress.
  // A realistic 1080p screen recording encodes at well under 1 Mbps.
  const mbps = parseFloat(at('-maxrate'));
  assert.ok(/M$/.test(at('-maxrate')), `-maxrate is ${at('-maxrate')}, expected megabits`);
  assert.ok(mbps >= 6 && mbps <= 12,
    `-maxrate is ${mbps} Mbps. Below 6 starts costing quality on a busy `
    + 'recording; above 12 stops being a ceiling worth having.');
});

check('the buffer is twice the ceiling', () => {
  const rate = parseFloat(MP4_MAXRATE), buf = parseFloat(MP4_BUFSIZE);
  assert.strictEqual(buf, rate * 2,
    `bufsize ${MP4_BUFSIZE} against maxrate ${MP4_MAXRATE}: a one-second window `
    + 'makes the encoder lurch on scene changes, and a very large one lets the '
    + 'average drift above the ceiling for long enough to matter');
});

check('quality and compatibility are unchanged', () => {
  // The ceiling was the whole change. If CRF or the pixel format moved too,
  // the measurement behind it no longer describes what ships.
  assert.strictEqual(at('-crf'), '20', 'the quality target moved');
  assert.strictEqual(at('-pix_fmt'), 'yuv420p', 'yuv420p is what every player handles');
  assert.strictEqual(at('-c:v'), 'libx264');
  assert.strictEqual(at('-c:a'), 'aac');
  assert.strictEqual(at('-movflags'), '+faststart',
    'without faststart the moov sits at the tail and the export will not stream');
});

check('the paths are the first input and the last argument', () => {
  assert.strictEqual(args[args.indexOf('-i') + 1], '/in/rec.webm');
  assert.strictEqual(args[args.length - 1], '/out/rec.mp4');
});

check('the recorder cap this reasons about is still what the recorder does', () => {
  // The ceiling exists because the SOURCE is capped. If capture stops capping,
  // the reasoning above needs revisiting rather than silently still applying.
  const capture = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'captureSettings.js'), 'utf8');
  assert.ok(/videoBitsPerSecond:\s*2_?500_?000/.test(capture),
    'the recorder no longer caps video at 2.5 Mbps — the export ceiling was '
    + 'measured against a source that did');
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
