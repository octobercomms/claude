// Mastering has to actually hit the number it claims.
//
// The screen tells the operator a recording was normalised to -16 LUFS, and
// migration 254 stores the figure it started from so that claim is checkable.
// A claim nobody verifies is the failure this repository keeps finding: a
// guard that names a marker rather than the thing the marker is about.
//
// Three ways this breaks quietly, one guard each:
//
//   1. The two passes drift apart. loudnorm's measurement only describes the
//      signal the filters before it produce. If the measuring pass and the
//      applying pass ever run different chains, the measurement describes a
//      file that does not exist and the output lands off target with nothing
//      to show why. So both are built from one constant, and that is asserted.
//
//   2. The measurement stops parsing. ffmpeg prints the JSON to stderr after
//      everything else it has to say, and a future version printing one more
//      block would silently take the wrong one.
//
//   3. It does not actually hit -16. The only honest check is to run both
//      passes over real audio and measure the result with a different filter
//      than the one that did the work.
//
//   node tests/audio-master.test.js

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');
const { _internals } = require('../src/services/audioMaster');
const { FFMPEG } = require('../src/services/ffmpegBin');

const { VOICE_CHAIN, TARGET_LUFS, parseLoudnorm, loudnormFilter } = _internals;

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };

ok('both passes run the same filter chain', () => {
  const measuring = `${VOICE_CHAIN},${loudnormFilter(null)}`;
  const applying = `${VOICE_CHAIN},${loudnormFilter({
    input_i: '-23.4', input_tp: '-5.1', input_lra: '7.2',
    input_thresh: '-33.4', target_offset: '0.0',
  })}`;
  const before = (s) => s.slice(0, s.indexOf('loudnorm='));
  assert.strictEqual(before(measuring), before(applying),
    'the measuring pass and the applying pass no longer share a chain — the '
    + 'measurement would describe a signal the second pass never produces');
  assert.ok(measuring.includes('print_format=json'),
    'the measuring pass stopped asking loudnorm to print its measurement');
  assert.ok(applying.includes('measured_I='),
    'the applying pass stopped being given the measurement, so loudnorm is '
    + 'back to a single-pass estimate and will land off target');
});

ok('the order of the chain is the order that works', () => {
  const i = (f) => VOICE_CHAIN.indexOf(f);
  assert.ok(i('highpass') < i('acompressor'),
    'the high-pass must precede the compressor, or the compressor reacts to '
    + 'rumble that is about to be removed');
  assert.ok(i('acompressor') < i('deesser'),
    'the de-esser must follow the compressor, because compression is what '
    + 'lifts the sibilance it exists to remove');
  assert.ok(!VOICE_CHAIN.includes('loudnorm'),
    'loudnorm belongs after this chain, not inside it — normalising before '
    + 'the compressor sets a loudness the compressor then changes');
});

ok('a real loudnorm payload parses, and the last block wins', () => {
  const real = `[Parsed_loudnorm_3 @ 0x5] \n{\n\t"input_i" : "-47.75",\n\t"input_tp" : "-38.85",\n`
    + `\t"input_lra" : "0.00",\n\t"input_thresh" : "-57.75",\n\t"output_i" : "-16.00",\n`
    + `\t"target_offset" : "0.00"\n}\n`;
  const parsed = parseLoudnorm(real);
  assert.ok(parsed, 'a real loudnorm payload no longer parses');
  assert.strictEqual(parsed.input_i, '-47.75');

  // An earlier JSON-ish block must not win.
  const noisy = `{"something":"else"}\n` + real;
  assert.strictEqual(parseLoudnorm(noisy).input_i, '-47.75',
    'an earlier JSON block was taken instead of loudnorm\'s own');

  assert.strictEqual(parseLoudnorm('no json here'), null,
    'output with no measurement should report none rather than throw');
});

// The real one. Needs ffmpeg; the backend CI job installs it, and a guard that
// skips is a guard that is not running, so this fails rather than skips.
ok('a quiet recording comes out at the target loudness', () => {
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
  } catch {
    assert.fail('ffmpeg missing: the loudness assertion would not run');
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omi-master-test-'));
  const src = path.join(dir, 'in.wav');
  const out = path.join(dir, 'out.mp3');

  // ffmpeg writes its measurement to stderr and still exits 0, so every call
  // here goes through one helper that returns both streams joined.
  const capture = (args) => {
    const r = spawnSync(FFMPEG, args, { encoding: 'utf8' });
    return `${r.stdout || ''}${r.stderr || ''}`;
  };

  // A deliberately quiet, varying signal, far enough below target that
  // nothing but real normalisation reaches -16.
  capture(['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=180:duration=6,volume=0.06',
    '-f', 'lavfi', '-i', 'sine=frequency=3200:duration=6,volume=0.03',
    '-filter_complex', '[0][1]amix=inputs=2,tremolo=f=2:d=0.7',
    '-ar', '44100', '-ac', '1', src, '-y']);
  assert.ok(fs.existsSync(src), 'the test signal was not created');

  const measured = parseLoudnorm(capture(['-hide_banner', '-nostats', '-i', src,
    '-af', `${VOICE_CHAIN},${loudnormFilter(null)}`, '-f', 'null', '-']));
  assert.ok(measured, 'the measuring pass produced no measurement');
  assert.ok(Number(measured.input_i) < -30,
    `the test signal should be far below target, measured ${measured.input_i}`);

  capture(['-hide_banner', '-loglevel', 'error', '-i', src,
    '-af', `${VOICE_CHAIN},${loudnormFilter(measured)}`,
    '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '192k', out, '-y']);
  assert.ok(fs.existsSync(out) && fs.statSync(out).size > 1000,
    'the applying pass produced no audio');

  // Measured with ebur128, not with loudnorm — a different filter from the
  // one that did the work, so this is a check rather than an echo.
  const verify = capture(['-hide_banner', '-nostats', '-i', out,
    '-af', 'ebur128=framelog=quiet', '-f', 'null', '-']);
  const m = verify.match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g);
  assert.ok(m && m.length, 'ebur128 reported no integrated loudness');
  const achieved = Number(m[m.length - 1].match(/(-?\d+(?:\.\d+)?)/)[1]);

  const drift = Math.abs(achieved - TARGET_LUFS);
  assert.ok(drift <= 1.0,
    `mastered audio landed at ${achieved} LUFS, target ${TARGET_LUFS}, `
    + `drift ${drift.toFixed(2)} LU — normalisation is not reaching its target`);
  console.log(`      ${measured.input_i} LUFS in \u2192 ${achieved} LUFS out (target ${TARGET_LUFS})`);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${passed} passed, 0 failed`);
