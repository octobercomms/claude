// What the playback remux has to actually do to a file.
//
// The recorder cannot write a seekable file. It is streaming bytes out as it
// records, so it has no chance to go back and put an index at the front:
// MediaRecorder emits a fragmented file, a short header followed by moof/mdat
// pairs with the random-access index last. Measured against real Chromium
// captures before this was written:
//
//   recorder.mp4   ftyp  moov(695)  moof mdat  moof mdat  mfra        <- index last
//   recorder.webm  no Cues element at all, and ffprobe reports duration=N/A
//                  even with the whole file in hand
//
// services/recordingRemux.js fixes both with a stream copy. The assertions
// below are about structure rather than about ffmpeg's exit code, because the
// first version of this change "worked" — exit 0, a slightly larger file, every
// test green — while leaving an MP4 just as fragmented as it went in.
//
// ffmpeg is required rather than skipped round, matching the render guards: a
// guard that skips is a guard that is not running.
//
//   node tests/recording-remux.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { argsFor, containerFor, probeCuesToFront } = require('../src/services/recordingRemux');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

let failed = 0;
// Checks that return a promise are waited for. Without this they resolve after
// the summary has printed, an assertion failure inside one becomes an
// unhandled rejection, and the suite reports all passed — which is worse than
// having no check at all.
const pending = [];
function check(name, fn) {
  let r;
  try { r = fn(); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); return; }
  if (r && typeof r.then === 'function') {
    pending.push(r.then(
      () => console.log(`  ok   ${name}`),
      (e) => { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }));
    return;
  }
  console.log(`  ok   ${name}`);
}

function ff(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`ffmpeg exited ${r.status}: ${(r.stderr || '').slice(-400)}`);
}

// Walk the top-level ISO-BMFF boxes. A progressive MP4 is ftyp, moov, mdat; a
// fragmented one has moof boxes and a moov with no sample tables.
function mp4Boxes(file) {
  const b = fs.readFileSync(file);
  const out = [];
  let o = 0;
  while (o + 8 <= b.length) {
    let size = b.readUInt32BE(o), hdr = 8;
    const type = b.toString('latin1', o + 4, o + 8);
    if (size === 1) { size = Number(b.readBigUInt64BE(o + 8)); hdr = 16; }
    if (size === 0) size = b.length - o;
    if (size < hdr) break;
    out.push({ type, offset: o, size });
    o += size;
  }
  return out;
}

// Byte offset of a Matroska element id, or -1. Cues is 0x1C53BB6B, the seek
// index; Cluster is 0x1F43B675, the media data.
function ebmlOffset(file, idHex) {
  const b = fs.readFileSync(file);
  return b.indexOf(Buffer.from(idHex, 'hex'));
}

const codecOf = (file) => execFileSync('ffprobe',
  ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name',
   '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).trim();

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'remux-test-'));

console.log('the playback remux');

check('ffmpeg is available, so none of the assertions below silently skip', () => {
  const r = spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' });
  assert.ok(!r.error && r.status === 0,
    `${FFMPEG} is not runnable; the structural assertions would not run at all`);
});

check('both containers are copied, never re-encoded', () => {
  // A remux that re-encodes would take minutes per recording instead of
  // seconds and would lose quality for nothing. -c copy is the whole point.
  for (const container of ['mp4', 'webm']) {
    const args = argsFor(container, 'in', 'out');
    assert.ok(args.includes('-c') && args[args.indexOf('-c') + 1] === 'copy',
      `${container}: the remux must pass -c copy, got ${args.join(' ')}`);
    for (const flag of ['-c:v', '-c:a', '-crf', '-b:v', '-preset']) {
      assert.ok(!args.includes(flag),
        `${container}: ${flag} re-encodes; this is meant to be a container rewrite`);
    }
  }
});

check('each container gets the flag that moves its index to the front', () => {
  const mp4 = argsFor('mp4', 'in', 'out');
  assert.ok(mp4.includes('-movflags') && mp4[mp4.indexOf('-movflags') + 1].includes('faststart'),
    'mp4 needs +faststart, or the moov stays where the recorder left it');
  const webm = argsFor('webm', 'in', 'out');
  assert.ok(webm.includes('-cues_to_front') && webm[webm.indexOf('-cues_to_front') + 1] === '1',
    'webm needs -cues_to_front 1, or the file has no seek index a player can reach');
});

check('the WebM flag is asked for, not assumed', () => {
  // -cues_to_front arrived in ffmpeg 6.0. The platform box runs 4.4, where it
  // is not ignored: ffmpeg refuses the whole command with "Unrecognized option
  // 'cues_to_front'" before opening the input. Three of eight recordings in
  // the first backfill failed exactly that way, and they were the WebM ones.
  //
  // So the service probes the muxer and passes the answer in. Both answers are
  // exercised here; the probe itself is checked against a fake ffmpeg below.
  const withFlag = argsFor('webm', 'in', 'out', true);
  assert.ok(withFlag.includes('-cues_to_front'), 'the flag is dropped even where it is supported');
  const without = argsFor('webm', 'in', 'out', false);
  assert.ok(!without.includes('-cues_to_front'),
    'the flag survives the fallback, so an old ffmpeg still refuses the command');
  assert.ok(without.includes('-c') && without[without.indexOf('-c') + 1] === 'copy',
    'the fallback must still be a stream copy');
  assert.ok(without.includes('-f') && without[without.indexOf('-f') + 1] === 'webm',
    'the fallback must still write WebM');
});

check('the fallback command is one ffmpeg will actually run', () => {
  // The point of the fallback is that it works where the flag does not. A
  // fallback nobody has run is a second way to fail.
  const src = path.join(work, 'fb-src.webm');
  const out = path.join(work, 'fb-out.webm');
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i',
    'testsrc2=s=320x240:r=10:d=2', '-c:v', 'libvpx', '-b:v', '200k', src]);
  ff(argsFor('webm', src, out, false));
  assert.ok(fs.statSync(out).size > 0, 'the fallback produced nothing');
});

check('the probe answers no for an ffmpeg without the option', () => {
  // A stub printing what 4.4 prints for `-h muxer=webm`: reserve_index_space
  // is there, cues_to_front is not. If the probe matched loosely it would say
  // yes here and the box would keep failing.
  const stub = path.join(work, 'ffmpeg-old');
  fs.writeFileSync(stub, [
    '#!/bin/sh',
    "echo 'Muxer webm [WebM]:'",
    "echo '  -reserve_index_space <int>  E.......... Reserve a given amount of space (in bytes) at the beginning of the file for the index (cues).'",
    "echo '  -dash <boolean>             E.......... create a WebM file conforming to WebM DASH specification'",
  ].join('\n') + '\n');
  fs.chmodSync(stub, 0o755);
  return probeCuesToFront(stub).then(v => {
    assert.strictEqual(v, false, 'the probe said yes to an ffmpeg that has no such option');
  });
});

check('the probe answers yes for this ffmpeg, which has it', () => {
  // The positive control. Without it the probe could return false always and
  // every assertion above would still pass.
  return probeCuesToFront(FFMPEG).then(v => {
    assert.strictEqual(v, true,
      `${FFMPEG} reports no -cues_to_front. If that is genuinely true of the ffmpeg `
      + 'running this suite, the structural WebM assertions below are not testing '
      + 'what ships on a box that does support it.');
  });
});

check('a fragmented MP4 comes out progressive', () => {
  const frag = path.join(work, 'frag.mp4');
  const out = path.join(work, 'out.mp4');
  // frag_keyframe+empty_moov is how a streaming writer emits MP4, which is what
  // MediaRecorder is doing.
  ff(['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof', frag]);

  const before = mp4Boxes(frag).map(b => b.type);
  assert.ok(before.includes('moof'),
    `the fixture is not fragmented, so this proves nothing: ${before.join(' ')}`);

  ff(argsFor('mp4', frag, out));
  const after = mp4Boxes(out);
  const types = after.map(b => b.type);

  assert.ok(!types.includes('moof'),
    `the output is still fragmented: ${types.join(' ')}`);
  const moov = after.find(b => b.type === 'moov');
  const mdat = after.find(b => b.type === 'mdat');
  assert.ok(moov && mdat, `expected both moov and mdat, got ${types.join(' ')}`);
  assert.ok(moov.offset < mdat.offset,
    'moov must come before mdat, or the player has to fetch the tail before it can start');

  // The fragmented moov carries no sample tables, so it is tiny. A real one
  // describing every frame is substantially bigger; that size difference is the
  // index the player needs.
  const fragMoov = mp4Boxes(frag).find(b => b.type === 'moov');
  assert.ok(moov.size > fragMoov.size,
    `the output moov (${moov.size}B) is no bigger than the fragmented one `
    + `(${fragMoov.size}B), so it still has no sample tables`);

  assert.strictEqual(codecOf(out), codecOf(frag), 'the video was re-encoded');
});

check('a WebM comes out with its seek index at the front', () => {
  const src = path.join(work, 'src.webm');
  const out = path.join(work, 'out.webm');
  ff(['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2',
      '-c:v', 'libvpx-vp9', '-b:v', '200k', '-deadline', 'realtime', '-cpu-used', '8', src]);

  ff(argsFor('webm', src, out));

  const cues = ebmlOffset(out, '1c53bb6b');
  const cluster = ebmlOffset(out, '1f43b675');
  assert.ok(cues > -1, 'the output has no Cues element, so a player cannot seek');
  assert.ok(cluster > -1, 'no Cluster found, so this file has no media in it');
  assert.ok(cues < cluster,
    `Cues at ${cues} must come before the first Cluster at ${cluster}, `
    + 'or seeking needs the end of the file first');

  // And the duration has to be readable, which is the thing a real capture is
  // missing entirely.
  const dur = execFileSync('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', out],
    { encoding: 'utf8' }).trim();
  assert.ok(Number(dur) > 1, `the output reports duration "${dur}"; a player shows no length for that`);

  assert.strictEqual(codecOf(out), codecOf(src), 'the video was re-encoded');
});

check('the container is read from the stored mime, not assumed', () => {
  // The two flag sets are not interchangeable: a WebM handed +faststart fails
  // outright, and an MP4 handed -cues_to_front does too. So a hardcoded
  // container would silently stop remuxing half the library — which is a
  // mutation that got through the first version of this test, because the
  // choice was buried in the database path where nothing could reach it.
  assert.strictEqual(containerFor('video/mp4'), 'mp4');
  assert.strictEqual(containerFor('video/mp4;codecs=avc1.42E01E,mp4a.40.2'), 'mp4',
    'a full codec string is still mp4');
  assert.strictEqual(containerFor('video/webm'), 'webm');
  assert.strictEqual(containerFor('video/quicktime'), 'mp4',
    '.mov is ISO-BMFF like .mp4, so it takes +faststart, not -cues_to_front');
  assert.strictEqual(containerFor(null), 'webm', 'a missing mime must not throw');
});

check('the two flag sets are genuinely not interchangeable', () => {
  // The reason containerFor matters at all. If ffmpeg ever starts accepting
  // either flag on either container, the test above stops meaning anything and
  // this says so.
  const mp4 = path.join(work, 'x.mp4');
  ff(['-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=15:duration=1',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', mp4]);
  let threw = false;
  try { ff(argsFor('webm', mp4, path.join(work, 'wrong.webm'))); }
  catch { threw = true; }
  assert.ok(threw, 'an MP4 pushed through the webm flags succeeded; containerFor would be pointless');
});

// The summary waits for the async checks, so a failure inside one counts.
Promise.all(pending).then(() => {
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log('\nall passed');
});
