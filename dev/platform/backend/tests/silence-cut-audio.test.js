/**
 * Dead air decided by BOTH signals, not one.
 *
 * planCuts worked from word timings alone, so every gap between two words
 * read as silence and was offered for removal however loud it was. A cough,
 * a door, a chair or room tone is a gap between words and is not dead air,
 * and cutting it removes a sound the viewer heard.
 *
 * Volume alone is worse: one measurement on a 34-minute recording produced
 * roughly 800 choppy cuts from volume thresholds against 120 from
 * transcript-driven ones. So the timings pick the candidates and the audio
 * confirms each one, and neither is trusted on its own.
 *
 * The threshold is swept from the file rather than fixed, because the right
 * one is a property of the recording. On one measured file -40 dB found no
 * silences, -30 dB found 13 and -25 dB found 21.
 *
 *   node tests/silence-cut-audio.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { planCuts, pickSilenceDb, quietFraction } = require('../../shared/silenceCut.mjs');

const HOP = 0.05;

/**
 * An envelope for a clip: speech during the word spans, `gapDb` between.
 * Values are dBFS, in the source clip's timebase.
 */
function envelopeFor(totalS, wordSpans, { speechDb = -15, gapDb = -50 } = {}) {
  const n = Math.ceil(totalS / HOP);
  const dbs = new Array(n).fill(gapDb);
  for (const [from, to] of wordSpans) {
    for (let i = Math.floor(from / HOP); i < Math.ceil(to / HOP) && i < n; i += 1) {
      dbs[i] = speechDb;
    }
  }
  return { hop: HOP, dbs };
}

// Two words, then a four-second gap, then two more.
const WORDS = [
  { word: 'every', start: 0.0, end: 0.4 },
  { word: 'map', start: 0.5, end: 0.9 },
  { word: 'showed', start: 5.0, end: 5.5 },
  { word: 'nothing', start: 5.6, end: 6.2 },
];
const SPANS = WORDS.map((w) => [w.start, w.end]);
const OPTS = { media_s: 7, keep_first_s: 0 };

describe('pickSilenceDb', () => {
  it('puts the floor a margin below where this file speaks', () => {
    const got = pickSilenceDb(envelopeFor(7, SPANS, { speechDb: -15, gapDb: -50 }));
    assert.ok(got, 'a threshold was chosen');
    assert.equal(got.db, -45, '-15 dB speech, 30 dB margin');
    assert.match(got.why, /speech sits near -15/);
  });

  it('moves with the file rather than staying constant', () => {
    const quiet = pickSilenceDb(envelopeFor(7, SPANS, { speechDb: -30, gapDb: -60 }));
    assert.equal(quiet.db, -60, 'a quieter recording gets a lower floor');
  });

  it('clamps, so a silent file does not put the floor under everything', () => {
    const got = pickSilenceDb(envelopeFor(7, SPANS, { speechDb: -70, gapDb: -80 }));
    assert.equal(got.db, -60);
    assert.equal(got.clamped, true);
    assert.match(got.why, /clamped/);
  });

  it('is null with no envelope, so the caller can tell it never measured', () => {
    assert.equal(pickSilenceDb(null), null);
    assert.equal(pickSilenceDb({ hop: HOP, dbs: [] }), null);
  });
});

describe('quietFraction', () => {
  const env = envelopeFor(7, SPANS, { speechDb: -15, gapDb: -50 });

  it('is 1 across a span that is entirely under the level', () => {
    assert.equal(quietFraction(env, 1.0, 4.9, -45), 1);
  });

  it('is 0 across a span that is entirely over it', () => {
    assert.equal(quietFraction(env, 0.0, 0.4, -45), 0);
  });

  it('is null when there is no measurement for the span', () => {
    assert.equal(quietFraction(null, 1, 2, -45), null);
    assert.equal(quietFraction(env, 100, 200, -45), null,
      'past the end of the envelope is no measurement, not silence');
  });
});

describe('planCuts with audio evidence', () => {
  it('cuts a gap the audio agrees is empty', () => {
    const plan = planCuts(WORDS, {
      ...OPTS,
      envelope: envelopeFor(7, SPANS, { speechDb: -15, gapDb: -50 }),
    });
    const silences = plan.cuts.filter((c) => c.kind === 'silence');
    assert.ok(silences.some((c) => c.from > 0.8 && c.to < 5.1), 'the long gap is offered');
    assert.deepEqual(plan.rejected_loud, [], 'nothing was refused');
    assert.equal(plan.silence_db, -45);
  });

  it('REFUSES a gap with something audible in it, and says why', () => {
    // The same timings, but the gap is not quiet: a cough, a door, room tone.
    const plan = planCuts(WORDS, {
      ...OPTS,
      envelope: envelopeFor(7, SPANS, { speechDb: -15, gapDb: -18 }),
    });
    const inGap = plan.cuts.filter(
      (c) => c.kind === 'silence' && c.from > 0.8 && c.to < 5.1
    );
    assert.equal(
      inGap.length, 0,
      'a gap between two words is not dead air just because no word is in it'
    );
    assert.equal(plan.rejected_loud.length, 1, 'and the refusal is reported');
    assert.match(plan.rejected_loud[0].why, /is audible in it/);
    assert.ok(plan.rejected_loud[0].quiet_frac < 0.85);
  });

  it('is unchanged without an envelope, which is what keeps the browser working', () => {
    const withAudio = planCuts(WORDS, OPTS);
    assert.ok(
      withAudio.cuts.some((c) => c.kind === 'silence' && c.from > 0.8 && c.to < 5.1),
      'timings-only still offers the gap'
    );
    assert.equal(withAudio.silence_db, null, 'and says it never measured');
    assert.deepEqual(withAudio.rejected_loud, []);
  });

  it('honours a caller-supplied threshold over the swept one', () => {
    const plan = planCuts(WORDS, {
      ...OPTS,
      envelope: envelopeFor(7, SPANS, { speechDb: -15, gapDb: -50 }),
      silent_db: -55,
    });
    assert.equal(plan.silence_db, -55);
    assert.match(plan.silence_db_why, /caller supplied/);
    // At -55 the -50 dB gap is no longer quiet enough.
    assert.equal(plan.rejected_loud.length, 1);
  });

  it('still needs media_s to avoid truncating at the last word', () => {
    // The guard that was already here, re-pinned because the tighten route
    // was calling planCuts without media_s and silently losing everything
    // after the last word Whisper heard.
    const withLen = planCuts(WORDS, { ...OPTS, media_s: 20 });
    const withoutLen = planCuts(WORDS, { ...OPTS, media_s: null });
    assert.equal(withLen.original_s, 20);
    assert.ok(
      withoutLen.original_s < 7.0,
      'with no length the plan ends at the last word, which is the fault'
    );
  });
});
