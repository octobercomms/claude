// "8 of 8 playback copies" did not mean what it looked like, and then the
// check written to replace it was wrong in its own way.
//
// media-store-status.js counts `play_key IS NOT NULL`, which says a remux
// happened. It cannot say the remux produced a usable index, and the three
// recordings remuxed on ffmpeg 4.4 all had a play_key — which is exactly why
// remux-backfill.js needs --force to redo them. So "8 of 8 ready recordings
// have a seekable playback copy" was printed on a box where nobody could say
// whether any of the eight were still indexed at the tail, and it read as
// finished.
//
// cues-audit.js answers that. Its first version asked the Matroska question
// of every playback copy, and `recordingRemux.argsFor` makes MP4s too: a WebM
// capture is remuxed to WebM with -cues_to_front, anything else to MP4 with
// -movflags +faststart. So it reported the box's five MP4 copies as having "no
// Cues element at all" — five healthy recordings read as broken, from a script
// written to stop exactly that kind of false reassurance running the other
// way. That is why the container split below is tested against real files of
// both kinds rather than only the pure functions.
//
// Three groups:
//
//   classifyWebm / classifyMp4  the judgements, pure, so the cases read as a
//                               table
//   detectContainer             from magic bytes, because a key's extension
//                               can lie and this is the branch that got it
//                               wrong
//   judge() on real files       that the offsets and box orders fed to those
//                               functions mean what they are supposed to —
//                               the half a pure test cannot reach
//
// The real-file group needs an ffmpeg with -cues_to_front (6.0+) and fails
// rather than skips without one: a silent skip here would be the same class
// of lie as the count it exists to correct.
//
//   node tests/cues-audit.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  classifyWebm, classifyMp4, detectContainer, judge, CUES, CLUSTER,
} = require('../scripts/cues-audit');
const { ebmlOffset, mp4Boxes } = require('../scripts/ffmpeg-check');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

// ── Matroska judgement ──────────────────────────────────────────────────────

ok('Cues before the first Cluster is the good case', () => {
  assert.strictEqual(classifyWebm(471, 493), 'front');
});

ok('Cues after the first Cluster is the bug the upgrade was for', () => {
  assert.strictEqual(classifyWebm(16329148, 465), 'tail');
});

ok('no Cues at all is its own answer, not tail', () => {
  // Distinct because the remedy reads differently: a tail index is a scrub
  // that costs a range request, no index is a scrub that re-reads the file.
  assert.strictEqual(classifyWebm(-1, 471), 'no-cues');
  assert.notStrictEqual(classifyWebm(-1, 471), 'tail');
});

ok('no Cluster is not silently called front', () => {
  // cues=471, cluster=-1 satisfies a naive `cues < cluster` only if -1 were
  // treated as "far away". It must not be.
  assert.strictEqual(classifyWebm(471, -1), 'no-cluster');
});

ok('equal Matroska offsets are not a pass', () => {
  // Two elements cannot start at the same byte, so this is a malformed read
  // rather than a good file. The comparison is strict for it.
  assert.strictEqual(classifyWebm(500, 500), 'tail');
});

// ── MP4 judgement ───────────────────────────────────────────────────────────

ok('moov before mdat is the faststart case', () => {
  assert.strictEqual(classifyMp4(['ftyp', 'moov', 'free', 'mdat']), 'front');
});

ok('mdat before moov is an MP4 indexed at the tail', () => {
  // The MP4 equivalent of the whole problem: the player fetches the end of
  // the file before it can seek.
  assert.strictEqual(classifyMp4(['ftyp', 'mdat', 'moov']), 'tail');
});

ok('an MP4 with no moov is not called front', () => {
  assert.strictEqual(classifyMp4(['ftyp', 'mdat']), 'no-moov');
});

ok('an MP4 with no mdat is not called front', () => {
  // indexOf returns -1 for mdat; `moov < mdat` would be false here anyway,
  // but the answer has to name the missing box rather than say "tail".
  assert.strictEqual(classifyMp4(['ftyp', 'moov']), 'no-mdat');
});

ok('an empty box list is not front', () => {
  assert.strictEqual(classifyMp4([]), 'no-moov');
});

// ── container detection ─────────────────────────────────────────────────────

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cues-audit-'));

ok('detectContainer does not guess from the name', () => {
  // The exact fault: a file named .mp4 is read as what it is, and so is one
  // named .webm. Both of these are lies about their contents.
  const fakeMp4 = path.join(dir, 'liar.mp4');
  fs.writeFileSync(fakeMp4, Buffer.concat([
    Buffer.from('1a45dfa3', 'hex'), Buffer.alloc(16),
  ]));
  assert.strictEqual(detectContainer(fakeMp4), 'webm');

  const fakeWebm = path.join(dir, 'liar.webm');
  fs.writeFileSync(fakeWebm, Buffer.concat([
    Buffer.alloc(4), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(8),
  ]));
  assert.strictEqual(detectContainer(fakeWebm), 'mp4');
});

ok('something that is neither is reported as neither, not as a fault', () => {
  const junk = path.join(dir, 'junk.bin');
  fs.writeFileSync(junk, Buffer.from('this is not a video at all', 'latin1'));
  assert.strictEqual(detectContainer(junk), null);
  assert.strictEqual(judge(junk).state, 'unknown-container');
});

ok('a file too short to have a header is not misread', () => {
  const stub = path.join(dir, 'tiny.webm');
  fs.writeFileSync(stub, Buffer.from('1a45', 'hex'));
  assert.strictEqual(detectContainer(stub), null);

  // The case that actually needs the length guard: the full EBML magic and
  // nothing after it. A partial magic comes back null whatever the guard
  // does, because the bytes do not match; this one matches and must still be
  // refused, because five bytes cannot be a playback copy. A truncated
  // upload looks exactly like this.
  const truncated = path.join(dir, 'truncated.webm');
  fs.writeFileSync(truncated, Buffer.concat([
    Buffer.from('1a45dfa3', 'hex'), Buffer.from([0x01]),
  ]));
  assert.strictEqual(detectContainer(truncated), null,
    'a 5-byte file with the EBML magic was accepted as a WebM');
});

ok('a missing file is not a crash', () => {
  assert.strictEqual(detectContainer(path.join(dir, 'nope.webm')), null);
});

// ── the offsets and box orders those judgements run on ──────────────────────

function ffmpegWithCuesToFront() {
  for (const bin of [process.env.FFMPEG_PATH, 'ffmpeg'].filter(Boolean)) {
    try {
      const help = execFileSync(bin, ['-hide_banner', '-h', 'muxer=webm'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (help.includes('cues_to_front')) return bin;
    } catch { /* try the next candidate */ }
  }
  return null;
}

const bin = ffmpegWithCuesToFront();
if (!bin) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.error('cues-audit: no ffmpeg with -cues_to_front found (tried FFMPEG_PATH, then PATH).');
  console.error('The pure checks passed; the real-file checks did not run, so this is not a pass.');
  process.exit(1);
}

const run = (args) => execFileSync(bin, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

try {
  const rawWebm = path.join(dir, 'raw.webm');
  const frontWebm = path.join(dir, 'front.webm');
  const tailWebm = path.join(dir, 'tail.webm');
  const rawMp4 = path.join(dir, 'raw.mp4');
  const frontMp4 = path.join(dir, 'front.mp4');
  const tailMp4 = path.join(dir, 'tail.mp4');

  run(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=6',
       '-c:v', 'libvpx', '-b:v', '200k', rawWebm]);
  run(['-i', rawWebm, '-c', 'copy', '-cues_to_front', '1', frontWebm]);
  run(['-i', rawWebm, '-c', 'copy', tailWebm]);

  // The two MP4s are built with the same arguments recordingRemux uses: the
  // faststart one is its non-webm branch, the other is what you get without
  // the flag, which is the default layout and the one to catch.
  run(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=6',
       '-c:v', 'libx264', '-pix_fmt', 'yuv420p', rawMp4]);
  run(['-i', rawMp4, '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', frontMp4]);
  run(['-i', rawMp4, '-c', 'copy', '-f', 'mp4', tailMp4]);

  ok('a -cues_to_front remux really is front-indexed', () => {
    const v = judge(frontWebm);
    assert.strictEqual(v.container, 'webm', `read as ${v.container}`);
    assert.strictEqual(v.state, 'front', `front.webm judged ${v.state}: ${v.detail}`);
  });

  ok('a WebM remux without the flag really is tail-indexed', () => {
    const v = judge(tailWebm);
    assert.strictEqual(v.container, 'webm', `read as ${v.container}`);
    assert.strictEqual(v.state, 'tail', `tail.webm judged ${v.state}: ${v.detail}`);
  });

  ok('the two WebMs are told apart, which a substring search would not do', () => {
    // The guard against the original bug. Both files carry the Cues id early,
    // inside SeekHead, so indexOf finds it near byte 100 in both and reports
    // both as front-indexed. The structural walk must put them on opposite
    // sides.
    const f = { cues: ebmlOffset(frontWebm, CUES), cluster: ebmlOffset(frontWebm, CLUSTER) };
    const t = { cues: ebmlOffset(tailWebm, CUES), cluster: ebmlOffset(tailWebm, CLUSTER) };
    assert.notStrictEqual(classifyWebm(f.cues, f.cluster), classifyWebm(t.cues, t.cluster),
      'both WebMs classified the same way — the walk is not reading structure');
    assert.ok(t.cues > f.cues * 10,
      `the tail file's Cues (${t.cues}) should be far past the front file's (${f.cues})`);
  });

  ok('a +faststart MP4 is front-indexed, and judged as an MP4', () => {
    // The regression this file exists for: an MP4 must not be asked the
    // Matroska question. If it were, this would come back 'no-cues'.
    const v = judge(frontMp4);
    assert.strictEqual(v.container, 'mp4', `read as ${v.container}`);
    assert.strictEqual(v.state, 'front', `front.mp4 judged ${v.state}: ${v.detail}`);
    assert.notStrictEqual(v.state, 'no-cues',
      'an MP4 was judged by Matroska rules — this is the exact bug');
  });

  ok('an MP4 without +faststart is tail-indexed', () => {
    const v = judge(tailMp4);
    assert.strictEqual(v.container, 'mp4', `read as ${v.container}`);
    assert.strictEqual(v.state, 'tail', `tail.mp4 judged ${v.state}: ${v.detail}`);
  });

  ok('the MP4 box order is what the verdict rests on', () => {
    const f = mp4Boxes(frontMp4);
    const t = mp4Boxes(tailMp4);
    assert.ok(f.includes('moov') && f.includes('mdat'), `front.mp4 boxes: ${f.join(' ')}`);
    assert.ok(t.includes('moov') && t.includes('mdat'), `tail.mp4 boxes: ${t.join(' ')}`);
    assert.ok(f.indexOf('moov') < f.indexOf('mdat'), `front.mp4 boxes: ${f.join(' ')}`);
    assert.ok(t.indexOf('mdat') < t.indexOf('moov'), `tail.mp4 boxes: ${t.join(' ')}`);
  });

  ok('neither container is judged by the other\'s rules', () => {
    // Cross-check: a real WebM has no moov/mdat and a real MP4 has no
    // Cues/Cluster, so a branch that fell through to the wrong reader would
    // produce a cannot-judge answer rather than a wrong verdict. Both must
    // come back 'front'.
    assert.strictEqual(judge(frontWebm).state, 'front');
    assert.strictEqual(judge(frontMp4).state, 'front');
    assert.strictEqual(ebmlOffset(frontMp4, CUES), -1, 'an MP4 reported a Cues element');
    assert.ok(!mp4Boxes(frontWebm).includes('moov'), 'a WebM reported a moov box');
  });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`cues-audit: ${passed} checks passed (real files built with ${bin})`);
