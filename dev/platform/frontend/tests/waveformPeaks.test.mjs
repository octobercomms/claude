/**
 * Guards on the waveform arithmetic.
 *
 * You cut on speech, so a waveform offset from the footage is worse than no
 * waveform: it moves the cut confidently to the wrong place. These check that
 * a loud moment is drawn where it actually happens, which is the only thing
 * this drawing has to be right about.
 */
import test from 'node:test';
import assert from 'node:assert';
import { peaksFromChannel, peaksForBlock, peaksPath, CLIP_BUCKETS } from '../src/utils/waveformPeaks.js';

// A ten-second channel at 1000 samples a second, silent apart from one loud
// burst from 6s to 7s. If the arithmetic is right, that burst stays at 60% of
// the way through the clip wherever it is sliced.
const RATE = 1000;
const channel = new Float32Array(10 * RATE);
for (let i = 6 * RATE; i < 7 * RATE; i++) channel[i] = 0.9;

test('peaks take the loudest sample in each bucket, not the average', () => {
  // A bucket holding one loud sample among a thousand quiet ones must read
  // loud. An average would read as silence and draw a flat line through the
  // middle of a sentence.
  const spike = new Float32Array(1000);
  spike[500] = 1;
  assert.equal(peaksFromChannel(spike, 1)[0], 1);
  assert.ok(peaksFromChannel(spike, 10)[5] === 1, 'and in the right bucket');
});

test('a loud moment lands where it happened', () => {
  const peaks = peaksFromChannel(channel, 100);
  assert.equal(peaks.length, 100);
  // Buckets 60 to 69 cover 6s to 7s.
  for (let i = 60; i < 70; i++) assert.ok(peaks[i] > 0.8, `bucket ${i} should be loud, got ${peaks[i]}`);
  for (const i of [0, 30, 59, 70, 99]) {
    assert.ok(peaks[i] < 0.01, `bucket ${i} should be quiet, got ${peaks[i]}`);
  }
});

test('the end of a clip is read, whatever its length', () => {
  // An integer stride leaves the tail unread whenever the sample count is not
  // a multiple of the bucket count, which silently drops the end of almost
  // every real clip.
  const tail = new Float32Array(1007);
  tail[1006] = 1;
  const peaks = peaksFromChannel(tail, 10);
  assert.equal(peaks[9], 1, 'the very last sample must reach the last bucket');
  const head = new Float32Array(1007);
  head[0] = 1;
  assert.equal(peaksFromChannel(head, 10)[0], 1);
});

test('peaks are magnitudes, so a negative swing is as loud as a positive one', () => {
  const neg = new Float32Array(100);
  neg[50] = -0.8;
  assert.ok(Math.abs(peaksFromChannel(neg, 1)[0] - 0.8) < 1e-6);
});

test('a sample over full scale is clamped rather than drawn off the top', () => {
  const hot = new Float32Array(10);
  hot[5] = 3.5;
  assert.equal(peaksFromChannel(hot, 1)[0], 1);
});

test('an empty or missing channel gives nothing, and does not throw', () => {
  assert.deepEqual(peaksFromChannel(new Float32Array(0), 10), []);
  assert.deepEqual(peaksFromChannel(null, 10), []);
  assert.deepEqual(peaksFromChannel(undefined), []);
  assert.equal(peaksFromChannel(channel, 0).length, 1, 'zero buckets is read as one');
  assert.equal(peaksFromChannel(channel, -5).length, 1);
});

// ---- slicing to a block ------------------------------------------------

const wave = { peaks: peaksFromChannel(channel, CLIP_BUCKETS), duration: 10 };

test('a whole clip draws the burst 60% of the way along', () => {
  const cols = peaksForBlock(wave, 0, 10, 100);
  assert.equal(cols.length, 100);
  for (let i = 60; i < 70; i++) assert.ok(cols[i] > 0.8, `column ${i} should be loud`);
  assert.ok(cols[10] < 0.01 && cols[90] < 0.01);
});

test('a trim moves the burst to where it now sits on the block', () => {
  // 5 → 10 of the clip: the burst at 6s is now a fifth of the way in.
  const cols = peaksForBlock(wave, 5, 10, 100);
  assert.ok(cols[0] < 0.01, 'the start of the block is quiet');
  for (let i = 21; i < 39; i++) assert.ok(cols[i] > 0.8, `column ${i} should be loud, got ${cols[i]}`);
  assert.ok(cols[60] < 0.01, 'and the back of the block is quiet again');
});

test('a block that does not contain the burst is drawn silent', () => {
  const cols = peaksForBlock(wave, 0, 5, 100);
  assert.ok(cols.every(v => v < 0.01), `a block of silence must read silent: max ${Math.max(...cols)}`);
  assert.equal(cols.length, 100, 'and must still have columns to draw');
});

test('a split puts the burst on exactly one side of the cut', () => {
  const left = peaksForBlock(wave, 0, 6.5, 100);
  const right = peaksForBlock(wave, 6.5, 10, 100);
  assert.ok(Math.max(...left) > 0.8, 'the first half holds the first part of the burst');
  assert.ok(Math.max(...right) > 0.8, 'and the second half the rest');
  // The burst is at the very end of the left block and the very start of the
  // right one, which is what a cut through the middle of a word looks like.
  assert.ok(left[99] > 0.8, `the left block ends loud, got ${left[99]}`);
  assert.ok(right[0] > 0.8, `the right block starts loud, got ${right[0]}`);
});

test('a stored edit longer than its clip is clamped, not drawn off the end', () => {
  const cols = peaksForBlock(wave, 0, 30, 100);
  assert.equal(cols.length, 100);
  assert.ok(cols.every(v => Number.isFinite(v)), 'no NaN columns from reading past the array');
  assert.ok(Math.max(...cols) > 0.8, 'the real audio is still drawn');
});

test('a block with no usable length draws nothing', () => {
  assert.deepEqual(peaksForBlock(wave, 0, null, 100), []);
  assert.deepEqual(peaksForBlock(wave, 0, NaN, 100), []);
  assert.deepEqual(peaksForBlock(wave, 4, 4, 100), []);
  assert.deepEqual(peaksForBlock(wave, 8, 2, 100), []);
});

test('a missing wave, or one with no duration, draws nothing', () => {
  assert.deepEqual(peaksForBlock(null, 0, 10, 100), []);
  assert.deepEqual(peaksForBlock({}, 0, 10, 100), []);
  assert.deepEqual(peaksForBlock({ peaks: [], duration: 10 }, 0, 10, 100), []);
  assert.deepEqual(peaksForBlock({ peaks: [0.5], duration: 0 }, 0, 10, 100), [],
    'a duration of zero gives no mapping from seconds to peaks');
  assert.deepEqual(peaksForBlock({ peaks: [0.5] }, 0, 10, 100), []);
});

test('an absent in point means the start of the clip', () => {
  assert.deepEqual(peaksForBlock(wave, null, 5, 50), peaksForBlock(wave, 0, 5, 50));
});

test('slicing does not mutate the clip peaks it was given', () => {
  const before = wave.peaks.join(',');
  peaksForBlock(wave, 2, 8, 100);
  assert.equal(wave.peaks.join(','), before,
    'the same peaks are sliced again for every other block over this clip');
});

// ---- the drawn path ----------------------------------------------------

test('the path draws one bar per column, centred in the box', () => {
  const d = peaksPath([0, 1, 0.5], 30, 20);
  assert.ok(d.startsWith('M'), `expected a path, got ${d.slice(0, 20)}`);
  assert.equal((d.match(/M/g) || []).length, 3, 'one move per column');
  // The loud column reaches the full half-height either side of the middle.
  assert.ok(d.includes('M10 0'), `the full-scale bar starts at the top: ${d}`);
});

test('silence is a visible line, not a gap', () => {
  const d = peaksPath([0, 0, 0], 30, 20);
  assert.ok(d.length > 0, 'silence must still be drawn');
  assert.ok(!/v0h/.test(d), 'a zero-height bar would make the waveform vanish where it is quiet');
});

test('the path holds no NaN, whatever it is given', () => {
  for (const cols of [[NaN], [null], [undefined], ['loud'], [Infinity], [-3]]) {
    const d = peaksPath(cols, 10, 10);
    assert.ok(!/NaN|Infinity|undefined/.test(d), `bad column produced: ${d}`);
  }
});

test('nothing to draw produces no path at all', () => {
  assert.equal(peaksPath([], 10, 10), '');
  assert.equal(peaksPath(null, 10, 10), '');
  assert.equal(peaksPath([0.5], 0, 10), '', 'a box with no width cannot hold a waveform');
  assert.equal(peaksPath([0.5], 10, 0), '');
});

// ---- the decibel curve -------------------------------------------------

test('the drawn height is in decibels, not linear', async () => {
  const { heightOf, FLOOR_DB } = await import('../src/utils/waveformPeaks.js');
  // A sine tone through AAC measures about -18 dBFS, which is 0.13 linear.
  // Drawn linearly that is a one-pixel bar in a sixteen-pixel strip, so real
  // speech would read as a flat line. The whole feature depends on this.
  const tone = heightOf(0.13);
  assert.ok(tone > 0.6, `-18 dBFS should fill most of the strip, got ${tone.toFixed(2)}`);
  assert.ok(tone < 1, 'but not all of it: there is headroom above a tone');
  assert.equal(heightOf(1), 1, 'full scale fills the strip');
  // Monotonic, so louder is always taller.
  let prev = -1;
  for (const v of [0.001, 0.01, 0.05, 0.13, 0.3, 0.6, 1]) {
    const h = heightOf(v);
    assert.ok(h > prev, `heightOf(${v}) = ${h} must exceed heightOf of the step below`);
    prev = h;
  }
  assert.equal(heightOf(0), 0, 'silence has no height');
  assert.equal(heightOf(10 ** (FLOOR_DB / 20)), 0, 'and neither does the floor');
  assert.ok(heightOf(10 ** ((FLOOR_DB + 10) / 20)) > 0, 'ten dB above the floor shows');
});

test('the height curve is safe with nonsense', async () => {
  const { heightOf } = await import('../src/utils/waveformPeaks.js');
  for (const v of [NaN, null, undefined, 'loud', -1, -Infinity, Infinity]) {
    const h = heightOf(v);
    assert.ok(Number.isFinite(h) && h >= 0 && h <= 1, `heightOf(${String(v)}) = ${h}`);
  }
  assert.equal(heightOf(5), 1, 'over full scale is full scale, not off the top');
});

test('a quiet passage and a loud one are visibly different heights', async () => {
  const { peaksPath } = await import('../src/utils/waveformPeaks.js');
  // The whole point of the curve: a -40 dB room and a -18 dB voice must not
  // draw as the same bar.
  const quiet = peaksPath([0.01], 10, 20);
  const loud = peaksPath([0.13], 10, 20);
  const topOf = (d) => Number(/M[\d.]+ ([\d.]+)h/.exec(d)[1]);
  assert.ok(topOf(loud) < topOf(quiet) - 2,
    `loud (${topOf(loud)}) must sit visibly above quiet (${topOf(quiet)})`);
});
