/**
 * The cross-fade, rendered and measured.
 *
 * Everything else about transitions is arithmetic, which `edl.test.js` checks.
 * This checks the arithmetic against ffmpeg itself, because the spec's warning
 * about this part was that "a plan meets a codec and loses", and an offset
 * that is wrong produces a video whose cuts are in the wrong place without
 * ffmpeg reporting anything.
 *
 * Three solid-colour blocks go in; the colour is sampled out of the render at
 * the instants the model says each block occupies. A fade in the wrong place
 * shows up as the wrong colour at a known time.
 *
 * Needs ffmpeg, which CI gates on for the caption tests already.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const { FFMPEG, FFPROBE } = require('../src/services/ffmpegBin');
const SHARED = path.join(__dirname, '..', '..', 'shared', 'edl.mjs');

let E;
let work;
const BLOCKS = [
  { secs: 6, colour: 'red', hz: 300 },
  { secs: 4, colour: 'green', hz: 500 },
  { secs: 5, colour: 'blue', hz: 700 },
];

test.before(async () => {
  E = await import(pathToFileURL(SHARED).href);
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'edl-trans-'));
  // Built to the same parameters cutEdl normalises its blocks to, because
  // those are exactly what xfade requires of its inputs.
  BLOCKS.forEach((b, i) => {
    b.file = path.join(work, `b${i}.mp4`);
    execFileSync(FFMPEG, ['-y',
      '-f', 'lavfi', '-i', `color=c=${b.colour}:size=240x180:rate=30:duration=${b.secs}`,
      '-f', 'lavfi', '-i', `sine=frequency=${b.hz}:duration=${b.secs}`,
      '-vf', 'setsar=1,fps=30,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '48000', '-b:a', '160k', '-video_track_timescale', '30000',
      '-shortest', b.file], { stdio: 'ignore' });
  });
});

test.after(() => { if (work) fs.rmSync(work, { recursive: true, force: true }); });

function render(graph, out) {
  const args = ['-y'];
  for (const b of BLOCKS) args.push('-i', b.file);
  args.push('-filter_complex', graph.filter,
    '-map', graph.videoOut, '-map', graph.audioOut,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-b:a', '160k', '-movflags', '+faststart', out);
  execFileSync(FFMPEG, args, { stdio: 'ignore' });
}

function durationOf(file) {
  return Number(execFileSync(FFPROBE,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
}

// The average colour of one frame, as a name. Averaged over the whole frame by
// scaling to a single pixel, so a solid block reads as its colour and a
// mid-fade frame reads as a blend of two.
function colourAt(file, t) {
  const buf = execFileSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', file,
    '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
  { maxBuffer: 1 << 20 });
  const [r, g, b] = [buf[0], buf[1], buf[2]];
  if (r > 150 && g < 80 && b < 80) return 'red';
  if (g > 90 && r < 80 && b < 80) return 'green';
  if (b > 150 && r < 80 && g < 80) return 'blue';
  return `blend(${r},${g},${b})`;
}

/**
 * The frame as four columns, so a wipe can be told from a fade: mid-wipe the
 * outer columns are different colours, mid-fade they are the same blend.
 * Without this every transition type renders identically as far as a duration
 * check can tell, and the picker's five options mean nothing.
 *
 * Four columns and not two: scaling 240 pixels down to 2 smears the whole
 * width into both samples and a real wipe reads as a uniform blend. Four keeps
 * the outer columns clear of the boundary. That cost a false failure.
 */
function columnsAt(file, t, cols = 4) {
  const buf = execFileSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', file,
    '-frames:v', '1', '-vf', `scale=${cols}:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
  { maxBuffer: 1 << 20 });
  return Array.from({ length: cols }, (_, i) => [buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]]);
}
const apart = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

const clips = BLOCKS.map((b, i) => ({ url: `b${i}.mp4`, duration: b.secs }));

test('a faded render is exactly as long as the model said', () => {
  let edl = E.edlFromClips(clips);
  edl = E.setTransition(edl, edl.items[1].id, 'fade', 0.5);
  edl = E.setTransition(edl, edl.items[2].id, 'fade', 1);
  const graph = E.xfadeGraph(E.compile(edl, clips));
  const out = path.join(work, 'faded.mp4');
  render(graph, out);

  const want = E.duration(edl);                 // 6 + 4 + 5 - 1.5 = 13.5
  assert.equal(want, 13.5);
  assert.equal(graph.outLen, want, 'the graph and the model agree before ffmpeg runs');
  const got = durationOf(out);
  // One frame at 30fps is 33ms; AAC frames pad a little past the video. More
  // than 100ms apart means the arithmetic is wrong, not the container.
  assert.ok(Math.abs(got - want) < 0.1,
    `rendered ${got.toFixed(3)}s against a model of ${want}s`);
});

test('every block is where the timeline drew it', () => {
  let edl = E.edlFromClips(clips);
  edl = E.setTransition(edl, edl.items[1].id, 'fade', 0.5);
  edl = E.setTransition(edl, edl.items[2].id, 'fade', 1);
  const out = path.join(work, 'placed.mp4');
  render(E.xfadeGraph(E.compile(edl, clips)), out);

  const rows = E.laidOut(edl);
  assert.deepEqual(rows.map(r => [r.start, r.end]), [[0, 6], [5.5, 9.5], [8.5, 13.5]]);

  // Sampled a little inside each block's own stretch, clear of both fades.
  const checks = [
    [2, 'red', 'the middle of the first block'],
    [rows[1].start - 0.3, 'red', 'just before the first fade begins'],
    [rows[1].start + 0.8, 'green', 'just after the first fade ends'],
    [rows[2].start - 0.3, 'green', 'just before the second fade begins'],
    [rows[2].start + 1.3, 'blue', 'just after the second fade ends'],
    [12.5, 'blue', 'the middle of the last block'],
  ];
  for (const [t, want, what] of checks) {
    assert.equal(colourAt(out, t), want,
      `${what} (${Number(t).toFixed(2)}s) should be ${want}`);
  }
});

test('the middle of a fade is actually a blend of both blocks', () => {
  // Without this the fades could be hard cuts at the right times, which looks
  // correct in a duration check and is not a cross-fade.
  let edl = E.edlFromClips(clips);
  edl = E.setTransition(edl, edl.items[1].id, 'fade', 1);
  const out = path.join(work, 'blend.mp4');
  render(E.xfadeGraph(E.compile(edl, clips)), out);

  const rows = E.laidOut(edl);
  const mid = rows[1].start + 0.5;              // halfway through a 1s fade
  const c = colourAt(out, mid);
  assert.match(c, /^blend\(/,
    `the middle of a cross-fade must be neither colour, got ${c} at ${mid}s`);
  const [, r, g] = /blend\((\d+),(\d+),/.exec(c).map(Number);
  assert.ok(r > 40 && g > 30,
    `and must hold some of both blocks, got red ${r} green ${g}`);
});

test('a hard cut is a cut, even inside a faded edit', () => {
  // The chain turns a cut into a one-frame fade, because one pass cannot mix
  // concatenation and xfade. One frame must be invisible: the colour either
  // side of the join is the block's own.
  let edl = E.edlFromClips(clips);
  edl = E.setTransition(edl, edl.items[2].id, 'fade', 1);   // only the LAST join fades
  const graph = E.xfadeGraph(E.compile(edl, clips));
  assert.equal((graph.filter.match(/xfade/g) || []).length, 2,
    'both joins are in the chain');
  const out = path.join(work, 'mixed.mp4');
  render(graph, out);

  const rows = E.laidOut(edl);
  // The cut between block 1 and 2 is at 6s, minus one frame.
  assert.equal(colourAt(out, 5.8), 'red', 'red right up to the cut');
  assert.equal(colourAt(out, 6.2), 'green', 'and green immediately after it');
  assert.ok(Math.abs(durationOf(out) - E.duration(edl)) < 0.15,
    `a one-frame join must not shorten the edit: ${durationOf(out)} vs ${E.duration(edl)}`);
  assert.ok(Math.abs(rows[1].start - 6) < 0.001, 'the cut is drawn at 6s too');
});

test('every transition the picker offers actually renders', () => {
  // An option that fails only at the end of a long render is worse than an
  // option that is not there. Each type is rendered, and each must produce the
  // length the model predicted.
  const made = [];
  for (const type of E.TRANSITIONS.filter(t => t !== 'cut')) {
    const base = E.edlFromClips(clips);
    const e = E.setTransition(base, base.items[1].id, type, 1);
    const g = E.xfadeGraph(E.compile(e, clips));
    assert.ok(g, `${type} produced no graph`);
    render(g, path.join(work, `t-${type}.mp4`));
    const d = durationOf(path.join(work, `t-${type}.mp4`));
    assert.ok(Math.abs(d - E.duration(e)) < 0.1,
      `${type} rendered ${d.toFixed(3)}s against a model of ${E.duration(e)}s`);
    made.push(type);
  }
  assert.deepEqual(made, E.TRANSITIONS.filter(t => t !== 'cut'),
    'every offered type was rendered, not just the first');
  assert.ok(made.length >= 4, `only ${made.length} transition types exist`);
});


test('a wipe is a wipe, not a fade wearing its name', () => {
  // Every xfade type produces the same output LENGTH, so a duration check
  // cannot tell them apart. What distinguishes a wipe is that mid-transition
  // the two sides of the frame are different: one has changed over and the
  // other has not. A fade changes the whole frame together.
  const faded = path.join(work, 'cmp-fade.mp4');
  const wiped = path.join(work, 'cmp-wipe.mp4');
  for (const [type, out] of [['fade', faded], ['wipeleft', wiped]]) {
    const base = E.edlFromClips(clips);
    const e = E.setTransition(base, base.items[1].id, type, 1);
    render(E.xfadeGraph(E.compile(e, clips)), out);
  }
  const base = E.edlFromClips(clips);
  const e = E.setTransition(base, base.items[1].id, 'fade', 1);
  const mid = E.laidOut(e)[1].start + 0.5;

  const f = columnsAt(faded, mid);
  const w = columnsAt(wiped, mid);
  assert.ok(apart(f[0], f[3]) < 40,
    `mid-fade the whole frame is one blend; its edges differ by ${apart(f[0], f[3])}`);
  assert.ok(apart(w[0], w[3]) > 90,
    `mid-wipe the two edges of the frame must differ; they differ by only `
    + `${apart(w[0], w[3])} (left ${w[0]}, right ${w[3]}), which means the wipe `
    + `rendered as a fade`);
});
