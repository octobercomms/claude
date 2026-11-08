/**
 * The QC verdict, and the parsers that feed it.
 *
 * A batch of thirty is reviewed by a person who will not watch thirty videos.
 * The verdict's only job is to answer "which of these do I watch first", so
 * the assertions that matter here are not "does it detect black" — ffmpeg
 * detects black — but:
 *
 *   - does a CORRECT render come out clean, including the awkward correct
 *     ones: a video that fades from black, a silent one, a flat end card;
 *   - does a broken one come out broken, and say which thing is broken;
 *   - and does nothing read as broken for a reason the operator cannot act
 *     on, because a checklist that cries wolf is switched off within a
 *     fortnight. That is the reelChecks lesson, written down in that file.
 *
 * Two of these guards exist because running the gate on real renders caught
 * it being wrong:
 *
 *   - a solid-colour still zoomed is pixel-for-pixel identical, so the motion
 *     measure correctly read zero and the gate failed a render that was
 *     perfect. Flat pictures are now unmeasurable rather than broken.
 *   - `ebur128` logs a running figure per frame as well as a summary, so the
 *     first `I:` in its output is the first frame's. A sine measured at
 *     −21.8 LUFS was read as −70 and would have reported 54 LU too quiet.
 *
 *   node tests/render-qc.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  judge, summarise, movingWindows, QC, QC_FINGERPRINT,
} = require('../../shared/renderQc.mjs');
const {
  parseBlack, parseFreeze, parseSilence, parseLoudness,
} = require('../src/services/renderQc');

// ── fixtures ─────────────────────────────────────────────────────────

/** A 20-second 1080x1920 render that is correct in every way. */
const good = (over = {}) => ({
  width: 1080,
  height: 1920,
  fps: 30,
  videoDuration: 20,
  audioDuration: 20,
  blackRuns: [],
  freezeRuns: [],
  silenceRuns: [],
  loudnessLufs: -16.2,
  truePeakDb: -1.4,
  // Four samples a second of a textured, moving picture.
  motion: Array.from({ length: 80 }, (_, i) => ({
    start: i / 4, end: (i + 1) / 4, delta: 4.2, detail: 40,
  })),
  ...over,
});

const want = (over = {}) => ({
  width: 1080, height: 1920, fps: 30, duration: 20, movingWindows: [], ...over,
});

const check = (v, id) => v.checks.find((c) => c.id === id);

// ── a correct render is clean ────────────────────────────────────────

describe('a correct render', () => {
  it('passes', () => {
    const v = judge(good(), want());
    assert.equal(v.verdict, 'pass', v.says);
    assert.equal(v.says, 'Nothing measurably wrong.');
  });

  it('passes even though it fades from and to black', () => {
    // A fade in and a fade out are the correct way to start and stop. A naive
    // black-frame check fails every properly faded video, which is most of
    // them.
    const v = judge(good({
      blackRuns: [{ start: 0, end: 0.6 }, { start: 19.4, end: 20 }],
    }), want());
    assert.equal(v.verdict, 'pass', v.says);
    assert.match(check(v, 'black').says, /no black in the middle/);
  });

  it('passes with no audio at all, rather than failing an audio check', () => {
    const v = judge(good({
      audioDuration: null, loudnessLufs: null, truePeakDb: null, silenceRuns: [],
    }), want());
    assert.equal(v.verdict, 'pass', v.says);
    assert.equal(check(v, 'audio').level, 'skipped');
    assert.equal(check(v, 'drift'), undefined, 'and no drift check against nothing');
  });

  it('passes when the picture is too flat to measure', () => {
    // Found by running the gate for real: a solid colour zoomed is identical
    // frame to frame, so the delta is zero however hard the camera moved. The
    // render was perfect and the gate called it broken.
    const v = judge(good({
      motion: Array.from({ length: 80 }, (_, i) => ({
        start: i / 4, end: (i + 1) / 4, delta: 0, detail: 0.5,
      })),
      freezeRuns: [{ start: 2, end: 18 }],
    }), want({ movingWindows: [{ start: 0, end: 20, why: 'push-in' }] }));
    assert.equal(check(v, 'motion').level, 'pass');
    assert.match(check(v, 'motion').says, /too flat to measure/);
    assert.equal(
      check(v, 'freeze').level, 'look',
      'and a freeze where the picture is flat anyway is a look, not a failure'
    );
    assert.notEqual(v.verdict, 'fail');
  });

  it('reports loudness without grading it', () => {
    // Nothing in this pipeline normalises loudness: `loudnorm` appears once
    // in the repo, in the list of filters the ffmpeg check verifies, and no
    // service uses it. Grading on a target nothing targets fails almost
    // everything for a reason nobody can act on.
    const v = judge(good({ loudnessLufs: -31 }), want());
    assert.equal(check(v, 'loudness').level, 'info');
    assert.match(check(v, 'loudness').says, /-31 LUFS/);
    assert.match(check(v, 'loudness').says, /15 LU quieter/);
    assert.equal(v.verdict, 'pass', 'and it does not affect the verdict');
  });
});

// ── a broken render is broken, and says which ────────────────────────

describe('a broken render', () => {
  it('fails on black in the middle', () => {
    const v = judge(good({ blackRuns: [{ start: 8, end: 11 }] }), want());
    assert.equal(v.verdict, 'fail');
    assert.equal(check(v, 'black').level, 'fail');
    assert.match(v.says, /black for 3s at 8s/);
    assert.equal(check(v, 'black').at, 8, 'and says where to look');
  });

  it('ignores a blink of black too short to see', () => {
    const v = judge(good({ blackRuns: [{ start: 8, end: 8.2 }] }), want());
    assert.equal(v.verdict, 'pass');
  });

  it('fails on a stuck frame', () => {
    const v = judge(good({ freezeRuns: [{ start: 5, end: 9 }] }), want());
    assert.equal(v.verdict, 'fail');
    assert.match(check(v, 'freeze').says, /frozen for 4s at 5s/);
  });

  it('fails the wrong resolution, and says what was asked for', () => {
    const v = judge(good({ width: 1920, height: 1080 }), want());
    assert.equal(v.verdict, 'fail');
    assert.match(check(v, 'resolution').says, /1920×1080, but the composition is 1080×1920/);
  });

  it('allows 29.97 against 30, which is the same frame rate', () => {
    assert.equal(judge(good({ fps: 30000 / 1001 }), want()).verdict, 'pass');
    assert.equal(judge(good({ fps: 25 }), want()).verdict, 'fail');
  });

  it('fails a camera move that did not happen, and names the preset', () => {
    // The check that is ours rather than borrowed. A transform that silently
    // did not apply produces a file that passes everything else here.
    const v = judge(good({
      motion: Array.from({ length: 80 }, (_, i) => ({
        start: i / 4, end: (i + 1) / 4, delta: 0.01, detail: 40,
      })),
    }), want({
      movingWindows: [{ start: 0, end: 3.5, why: 'push-in' }, { start: 3.5, end: 7, why: 'drift' }],
    }));
    assert.equal(v.verdict, 'fail');
    assert.match(check(v, 'motion').says, /2 shots that should move did not/);
    assert.match(check(v, 'motion').says, /push-in/, 'naming the preset, not "something"');
  });

  it('takes the MEDIAN inside a window, so one cut cannot hide a still shot', () => {
    // A hard cut is one enormous frame delta. A mean over the window would be
    // dragged above the floor by it and the shot would read as moving.
    const samples = Array.from({ length: 40 }, (_, i) => ({
      start: i / 4, end: (i + 1) / 4, delta: 0.01, detail: 40,
    }));
    samples[20] = { ...samples[20], delta: 200 };
    const v = judge(good({ motion: samples }), want({
      movingWindows: [{ start: 0, end: 10, why: 'push-in' }],
    }));
    assert.equal(check(v, 'motion').level, 'fail');
  });

  it('counts how much is wrong, so the worst video is first in the queue', () => {
    const one = judge(good({ blackRuns: [{ start: 8, end: 11 }] }), want());
    const many = judge(good({
      blackRuns: [{ start: 8, end: 11 }],
      freezeRuns: [{ start: 2, end: 5 }],
      width: 720,
    }), want());
    assert.ok(many.rank > one.rank, `${many.rank} should outrank ${one.rank}`);
    assert.ok(one.rank > judge(good(), want()).rank, 'and both outrank a clean one');
  });
});

// ── worth a look, but not broken ─────────────────────────────────────

describe('worth a look', () => {
  it('flags a long silent tail', () => {
    const v = judge(good({ silenceRuns: [{ start: 17, end: 20 }] }), want());
    assert.equal(v.verdict, 'look');
    assert.match(v.says, /3s of silence at the end/);
  });

  it('does not flag silence in the middle, which is speech pausing', () => {
    const v = judge(good({ silenceRuns: [{ start: 8, end: 12 }] }), want());
    assert.equal(v.verdict, 'pass');
  });

  it('flags audio and video of different lengths', () => {
    const v = judge(good({ audioDuration: 17 }), want());
    assert.equal(v.verdict, 'look');
    assert.match(check(v, 'drift').says, /3s apart/);
  });

  it('flags a peak close to clipping', () => {
    assert.equal(judge(good({ truePeakDb: -0.2 }), want()).verdict, 'look');
    assert.equal(judge(good({ truePeakDb: -0.6 }), want()).verdict, 'pass');
  });

  it('never calls a look a fail', () => {
    const v = judge(good({ truePeakDb: -0.2, audioDuration: 17 }), want());
    assert.equal(v.verdict, 'look');
    assert.match(v.says, /^Worth a look/);
  });
});

// ── what the operator is told ────────────────────────────────────────

describe('the sentence', () => {
  it('names the one problem when there is one', () => {
    assert.equal(
      summarise('fail', [{ id: 'black', level: 'fail', says: 'black for 3s at 8s' }]),
      'Broken: black for 3s at 8s.'
    );
  });

  it('names the first and counts the rest', () => {
    assert.equal(
      summarise('fail', [
        { id: 'black', level: 'fail', says: 'black for 3s at 8s' },
        { id: 'freeze', level: 'fail', says: 'frozen' },
        { id: 'fps', level: 'fail', says: 'wrong fps' },
      ]),
      'Broken: black for 3s at 8s, and 2 other problems.'
    );
  });

  it('says nothing is wrong without claiming the edit is good', () => {
    // The machine cannot tell you whether the video is any good, only that
    // nothing it can measure is wrong. Overclaiming here is how somebody
    // stops watching them.
    assert.equal(summarise('pass', []), 'Nothing measurably wrong.');
  });
});

// ── which parts were asked to move ───────────────────────────────────

describe('movingWindows', () => {
  const comp = (items, sources = {}) => ({
    tracks: [{ kind: 'video', items }],
    sources: { a: { kind: 'clip' }, ...sources },
  });

  it('finds an item with an animated scale', () => {
    const w = movingWindows(comp([
      { at: 0, len: 3, source: 'a', scale: { from: 1, to: 1.12 }, beat: 'push-in' },
    ]));
    assert.deepEqual(w, [{ start: 0, end: 3, why: 'push-in' }]);
  });

  it('ignores an item with a STATIC scale, which is a crop not a move', () => {
    assert.deepEqual(movingWindows(comp([{ at: 0, len: 3, source: 'a', scale: 1.08 }])), []);
  });

  it('ignores a caption source, which has no picture of its own', () => {
    const w = movingWindows(comp(
      [{ at: 0, len: 3, source: 'c', scale: { from: 1, to: 1.2 } }],
      { c: { kind: 'captions' } }
    ));
    assert.deepEqual(w, []);
  });

  it('is read off the timeline, so it cannot drift from what was rendered', () => {
    // If this were passed in by the caller, a batch could tell the gate one
    // thing and the renderer another.
    const w = movingWindows(comp([
      { at: 6, len: 3, source: 'a', pos: { from: { x: -0.03, y: 0 }, to: { x: 0.03, y: 0 } }, beat: 'drift' },
      { at: 0, len: 3, source: 'a', scale: { from: 1, to: 1.12 }, beat: 'push-in' },
    ]));
    assert.deepEqual(w.map((x) => x.start), [0, 6], 'and in time order');
  });

  it('survives a composition with no tracks', () => {
    assert.deepEqual(movingWindows({}), []);
    assert.deepEqual(movingWindows(null), []);
  });
});

// ── the parsers, on ffmpeg's own words ───────────────────────────────

describe('the parsers', () => {
  it('reads blackdetect', () => {
    // Copied from a real run, not invented.
    const log = '[blackdetect @ 0x7f6390001540] black_start:0 black_end:2 black_duration:2\n';
    assert.deepEqual(parseBlack(log), [{ start: 0, end: 2 }]);
  });

  it('reads freezedetect, which prints its parts on separate lines', () => {
    const log = [
      '[freezedetect @ 0x55d4fe67d680] lavfi.freezedetect.freeze_start: 0',
      '[freezedetect @ 0x55d4fe67d680] lavfi.freezedetect.freeze_duration: 2',
      '[freezedetect @ 0x55d4fe67d680] lavfi.freezedetect.freeze_end: 2',
    ].join('\n');
    assert.deepEqual(parseFreeze(log, 5), [{ start: 0, end: 2 }]);
  });

  it('closes a freeze that runs to the end of the file', () => {
    // The commonest shape of a real freeze: the filter never sees it finish,
    // so it prints a start and no end. Dropping it would miss the one that
    // matters most.
    const log = '[freezedetect] lavfi.freezedetect.freeze_start: 12';
    assert.deepEqual(parseFreeze(log, 20), [{ start: 12, end: 20 }]);
  });

  it('reads silencedetect, and clamps a negative start', () => {
    const log = [
      '[silencedetect @ 0x1] silence_start: -0.00022',
      '[silencedetect @ 0x1] silence_end: 1.2 | silence_duration: 1.2',
    ].join('\n');
    assert.deepEqual(parseSilence(log, 20), [{ start: 0, end: 1.2 }]);
  });

  it('reads loudness from the SUMMARY, not the first frame', () => {
    // The fault this guards. ebur128 logs a running figure per frame as well
    // as a summary, so the first `I:` in its output is the first frame's. On
    // a file that starts quiet that is −70, and a sine measured at −21.8 was
    // read as −70: 54 LU out.
    const log = [
      '[Parsed_ebur128_0 @ 0x1] t: 0.1 TARGET:-23 LUFS M: -70.0 S:-70.0 I: -70.0 LUFS LRA: 0.0 LU',
      '[Parsed_ebur128_0 @ 0x1] t: 0.2 TARGET:-23 LUFS M: -30.0 S:-30.0 I: -30.0 LUFS LRA: 0.0 LU',
      '[Parsed_ebur128_0 @ 0x1] Summary:',
      '',
      '  Integrated loudness:',
      '    I:         -21.8 LUFS',
      '    Threshold: -31.8 LUFS',
      '',
      '  True peak:',
      '    Peak:      -17.7 dBFS',
    ].join('\n');
    assert.deepEqual(parseLoudness(log), { loudnessLufs: -21.8, truePeakDb: -17.7 });
  });

  it('returns nulls rather than guesses when ebur128 said nothing', () => {
    assert.deepEqual(parseLoudness(''), { loudnessLufs: null, truePeakDb: null });
  });
});

// ── the rule set is identifiable ─────────────────────────────────────

describe('the thresholds', () => {
  it('have a fingerprint, so a threshold change is visible', () => {
    // The reelChecks arrangement: a rule set that changed its numbers without
    // changing its name would otherwise read as the same rule set, and a
    // verdict stored last week would be compared with one judged by different
    // rules.
    assert.match(QC_FINGERPRINT, /^[0-9a-f]+$/);
  });

  it('keep black and freeze thresholds a human would recognise', () => {
    assert.equal(QC.edge_grace_s, 1.0, 'a fade is about a second');
    assert.equal(QC.freeze_min_s, 2.0);
    assert.equal(QC.tail_silence_s, 1.2);
  });
});
