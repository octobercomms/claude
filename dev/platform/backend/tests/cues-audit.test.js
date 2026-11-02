// "8 of 8 playback copies" did not mean what it looked like.
//
// media-store-status.js counts `play_key IS NOT NULL`, which says a remux
// happened. It cannot say the remux produced a usable index, and the three
// recordings remuxed on ffmpeg 4.4 all had a play_key — which is exactly why
// remux-backfill.js needs --force to redo them. So on 2 November, with the
// upgrade long since done, "8 of 8 ready recordings have a seekable playback
// copy" was printed on a box where nobody could say whether any of the eight
// were still indexed at the tail, and it read as finished.
//
// scripts/cues-audit.js is the answer to that question and this guards it.
// Two halves:
//
//   classify()  the judgement, pure, so the table of cases is readable
//   real files  that the offsets fed to it mean what they are supposed to,
//               which is the half a pure test cannot reach: the first version
//               of this check searched for the Cues id with indexOf and
//               "passed" on a tail-indexed file, because SeekHead carries a
//               pointer to Cues near byte 100.
//
// The real-file half needs an ffmpeg with -cues_to_front (6.0+) and is skipped
// without one, loudly — a silent skip here would be the same class of lie as
// the count it exists to correct.
//
//   node tests/cues-audit.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { classify, CUES, CLUSTER } = require('../scripts/cues-audit');
const { ebmlOffset } = require('../scripts/ffmpeg-check');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

// ── the judgement ───────────────────────────────────────────────────────────

ok('Cues before the first Cluster is the good case', () => {
  assert.strictEqual(classify(471, 493), 'front');
});

ok('Cues after the first Cluster is the bug this upgrade was for', () => {
  assert.strictEqual(classify(16329148, 465), 'tail');
});

ok('no Cues at all is reported as its own case, not as tail', () => {
  // Distinct because the remedy reads differently: a tail index is a scrub
  // that costs a range request, no index is a scrub that re-reads the file.
  assert.strictEqual(classify(-1, 471), 'no-cues');
  assert.notStrictEqual(classify(-1, 471), 'tail');
});

ok('no Cluster is not silently called front', () => {
  // cues=471, cluster=-1 would satisfy a naive `cues < cluster` only if -1
  // were treated as "far away". It must not be.
  assert.strictEqual(classify(471, -1), 'no-cluster');
});

ok('equal offsets cannot both be the same element, so they are not front', () => {
  // Defensive: two elements cannot start at the same byte, so this is a
  // malformed read rather than a pass. `cues < cluster` is strict for it.
  assert.strictEqual(classify(500, 500), 'tail');
});

// ── the offsets those numbers come from ─────────────────────────────────────

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
  // Loud, and a failure rather than a pass, because the whole point of this
  // file is that a reassuring message about something unverified is worse
  // than no message. CI installs ffmpeg; a box that cannot run this should
  // say so rather than print a green line.
  console.error('cues-audit: no ffmpeg with -cues_to_front found (tried FFMPEG_PATH, then PATH).');
  console.error('The pure checks passed; the real-file checks did not run, so this is not a pass.');
  process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cues-audit-'));
const run = (args) => execFileSync(bin, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

try {
  const raw = path.join(dir, 'raw.webm');
  const front = path.join(dir, 'front.webm');
  const tail = path.join(dir, 'tail.webm');

  run(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=6',
       '-c:v', 'libvpx', '-b:v', '200k', raw]);
  run(['-i', raw, '-c', 'copy', '-cues_to_front', '1', front]);
  run(['-i', raw, '-c', 'copy', tail]);

  const read = (f) => ({ cues: ebmlOffset(f, CUES), cluster: ebmlOffset(f, CLUSTER) });

  ok('a -cues_to_front remux really is front-indexed', () => {
    const { cues, cluster } = read(front);
    assert.ok(cues > -1, 'no Cues element found in the front-indexed file');
    assert.ok(cluster > -1, 'no Cluster element found in the front-indexed file');
    assert.strictEqual(classify(cues, cluster), 'front',
      `front.webm judged wrong: Cues ${cues}, Cluster ${cluster}`);
  });

  ok('a remux without the flag really is tail-indexed', () => {
    const { cues, cluster } = read(tail);
    assert.ok(cues > -1, 'no Cues element found in the tail-indexed file');
    assert.strictEqual(classify(cues, cluster), 'tail',
      `tail.webm judged wrong: Cues ${cues}, Cluster ${cluster}`);
  });

  ok('the two files are told apart, which indexOf would not do', () => {
    // The guard against the original bug. Both files contain the Cues id
    // early on, inside SeekHead, so a substring search finds it near byte 100
    // in both and reports both as front-indexed. The structural walk must put
    // them on opposite sides.
    const f = read(front);
    const t = read(tail);
    assert.notStrictEqual(classify(f.cues, f.cluster), classify(t.cues, t.cluster),
      'both files classified the same way — the walk is not reading structure');
    assert.ok(t.cues > f.cues * 10,
      `the tail file's Cues (${t.cues}) should be far past the front file's (${f.cues})`);
  });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`cues-audit: ${passed} checks passed (real files built with ${bin})`);
