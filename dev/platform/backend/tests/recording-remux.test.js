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
const { argsFor, containerFor } = require('../src/services/recordingRemux');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
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

try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
