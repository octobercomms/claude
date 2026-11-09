/**
 * Labelling the spoken shape of somebody else's reel.
 *
 * The plan's row reads "transcribe, then Claude labels the archetype", and
 * the half that is testable without a model is the half that matters: the
 * labelling is CHECKED against the transcript it claims to describe. A span
 * covering no words, a solution before its problem, a hook nine seconds in,
 * or no call to action where "link in bio" is plainly said — each is caught
 * here rather than passed on as a reading.
 *
 * The call-to-action lexicon is the part that replaces a judgement with a
 * search. There are perhaps thirty phrases that ask a viewer for something
 * and almost nothing else does, so finding them is a measurement, and a
 * labelling that disagrees with a measurement is reported rather than
 * trusted.
 *
 *   node tests/structure-label.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const SL = require('../../shared/structureLabel.mjs');

/** Words at four a second, so a time is easy to reason about. */
function say(sentence, from = 0) {
  return sentence.split(/\s+/).map((word, i) => ({
    word,
    start: +(from + i * 0.25).toFixed(2),
    end: +(from + i * 0.25 + 0.2).toFixed(2),
  }));
}

const REEL = say(
  'this extension cost ninety grand and everyone told us it would be double '
  + 'the trick was buying the glazing direct and keeping the steel simple '
  + 'if you want the cost breakdown the link in bio has all of it'
);

// ── the lexicon ───────────────────────────────────────────────────────

describe('finding the ask in the words', () => {
  it('finds every phrase it ships with', () => {
    // Each one earns its place by firing. A phrase in the list that nothing
    // matches is a phrase nobody checked.
    for (const phrase of SL.CTA_PHRASES) {
      const words = say(`and so ${phrase} right now`);
      const cues = SL.ctaCues(words);
      assert.ok(
        cues.some((c) => c.phrase === phrase),
        `"${phrase}" did not fire on "and so ${phrase} right now"`
      );
    }
  });

  it('reports when it was said, not where in the string', () => {
    const cues = SL.ctaCues(REEL);
    assert.equal(cues.length, 1);
    assert.equal(cues[0].phrase, 'link in bio');
    const linkIndex = REEL.findIndex((w) => w.word === 'link');
    assert.equal(cues[0].at, REEL[linkIndex].start);
  });

  it('respects word boundaries', () => {
    // "subscriber" is not "subscribe", and "unfollow for more" is not
    // "follow for more". Without the boundary check both fire.
    assert.deepEqual(SL.ctaCues(say('we passed ten thousand subscribers today')), []);
    assert.deepEqual(SL.ctaCues(say('people who unfollow for morestuff')), []);
    assert.equal(SL.ctaCues(say('please subscribe')).length, 1);
  });

  it('does not fire on ordinary speech', () => {
    // A bare "comment" is deliberately not in the list: it occurs in normal
    // speech and only the directive forms carry the intent.
    assert.deepEqual(SL.ctaCues(say('the planning comment was about the ridge height')), []);
    assert.deepEqual(SL.ctaCues(say('we followed the detail through to the eaves')), []);
    assert.deepEqual(SL.ctaCues(say('this is a house in hackney')), []);
  });

  it('reads through punctuation and capitals', () => {
    const words = [
      { word: 'Link', start: 1, end: 1.2 },
      { word: 'in', start: 1.3, end: 1.4 },
      { word: 'bio!', start: 1.5, end: 1.8 },
    ];
    assert.equal(SL.ctaCues(words)[0].phrase, 'link in bio');
  });

  it('finds several, earliest first', () => {
    // In the order they were SAID, not the order the lexicon is written in.
    // "save this" is listed above "book a call", so a sentence that says them
    // the other way round is the one that can tell the difference: the first
    // version of this said them in lexicon order and passed with no sort at
    // all, which a mutation sweep caught.
    const words = say('book a call or if you are not ready yet just save this');
    const cues = SL.ctaCues(words);
    assert.deepEqual(cues.map((c) => c.phrase), ['book a call', 'save this']);
    assert.ok(cues[0].at < cues[1].at);
  });

  it('answers nothing for an empty transcript', () => {
    assert.deepEqual(SL.ctaCues([]), []);
    assert.deepEqual(SL.ctaCues([{ word: '...', start: 0, end: 1 }]), []);
  });
});

describe('flattening a transcript', () => {
  it('maps every character back to the word it came from', () => {
    const { text, offsets } = SL.flatten(say('one two three'));
    assert.equal(text, 'one two three');
    assert.equal(offsets[text.indexOf('two')], 1);
    assert.equal(offsets[text.indexOf('three')], 2);
  });

  it('drops words that are nothing but punctuation', () => {
    const { text } = SL.flatten([
      { word: 'yes', start: 0, end: 1 },
      { word: '—', start: 1, end: 1.1 },
      { word: 'really', start: 1.2, end: 1.6 },
    ]);
    assert.equal(text, 'yes really');
  });
});

// ── the labelling contract ────────────────────────────────────────────

describe('checking a labelling against the transcript', () => {
  const ok = [
    { label: 'hook', start: 0, end: 2.5 },
    { label: 'solution', start: 2.5, end: 9 },
    { label: 'cta', start: 9, end: 12.5 },
  ];

  it('accepts a good one', () => {
    assert.deepEqual(SL.validateLabelling(ok, REEL), []);
  });

  it('refuses a label outside the four', () => {
    const errs = SL.validateLabelling([{ label: 'proof', start: 0, end: 2 }], REEL);
    assert.match(errs.join(' '), /unknown label "proof"/);
    assert.match(errs.join(' '), /hook, problem, solution, cta/);
  });

  it('refuses the same section twice', () => {
    const errs = SL.validateLabelling([
      { label: 'hook', start: 0, end: 2 },
      { label: 'hook', start: 2, end: 4 },
    ], REEL);
    assert.match(errs.join(' '), /a second "hook"/);
  });

  it('refuses a solution before the problem it solves', () => {
    const errs = SL.validateLabelling([
      { label: 'solution', start: 0, end: 2 },
      { label: 'problem', start: 2, end: 4 },
    ], REEL);
    assert.match(errs.join(' '), /"problem" comes after "solution"/);
  });

  it('refuses overlapping spans', () => {
    const errs = SL.validateLabelling([
      { label: 'hook', start: 0, end: 5 },
      { label: 'solution', start: 3, end: 8 },
    ], REEL);
    assert.match(errs.join(' '), /overlaps the section before it/);
  });

  it('refuses a span that covers no words', () => {
    // A label on silence is a label on nothing. This is the check that makes
    // the instruction's "your spans are checked against the transcript"
    // true rather than a form of words.
    const errs = SL.validateLabelling([
      { label: 'hook', start: 0, end: 2 },
      { label: 'cta', start: 400, end: 404 },
    ], REEL);
    assert.match(errs.join(' '), /covers no words/);
  });

  it('refuses a span that starts after the last word', () => {
    const errs = SL.validateLabelling([{ label: 'hook', start: 90, end: 95 }], REEL);
    assert.match(errs.join(' '), /after the last word/);
  });

  it('refuses times that are not times', () => {
    assert.match(
      SL.validateLabelling([{ label: 'hook', start: 'early', end: 3 }], REEL).join(' '),
      /must be seconds/
    );
    assert.match(
      SL.validateLabelling([{ label: 'hook', start: 5, end: 3 }], REEL).join(' '),
      /end after start/
    );
  });

  it('refuses a field nothing reads', () => {
    const errs = SL.validateLabelling(
      [{ label: 'hook', start: 0, end: 2, confidence: 0.9 }], REEL
    );
    assert.match(errs.join(' '), /reports confidence, which nothing reads/);
  });

  it('refuses an empty labelling, rather than calling it a shape', () => {
    assert.deepEqual(SL.validateLabelling([], REEL), ['no sections']);
    assert.deepEqual(SL.validateLabelling(null, REEL), ['not a list of sections']);
  });

  it('allows a gap, because a passage can be none of the four', () => {
    const errs = SL.validateLabelling([
      { label: 'hook', start: 0, end: 2.5 },
      { label: 'cta', start: 7.5, end: 9.75 },
    ], REEL);
    assert.deepEqual(errs, []);
  });
});

// ── the reading ───────────────────────────────────────────────────────

describe('what the reading says', () => {
  // The reel is forty words at four a second, so it ends at 9.75s and "link
  // in bio" is said at 8s. The spans are inside it, because a labelling that
  // runs past the last word is one of the things the validator refuses.
  const clean = [
    { label: 'hook', start: 0, end: 2.5, says: 'the price, stated flat' },
    { label: 'solution', start: 2.5, end: 7.5, says: 'how the saving was made' },
    { label: 'cta', start: 7.5, end: 9.75, says: 'the breakdown is in the bio' },
  ];

  it('names the shape as the sequence of its sections', () => {
    const r = SL.readStructure(clean, REEL);
    assert.equal(r.archetype, 'hook-solution-cta');
    assert.deepEqual(r.disagreements, []);
    assert.ok(r.confidence > 0.6, `read ${r.confidence}`);
  });

  it('carries each section with its length and its word count', () => {
    const r = SL.readStructure(clean, REEL);
    assert.equal(r.sections[0].seconds, 2.5);
    assert.ok(r.sections[0].words > 5);
    assert.equal(r.sections[0].says, 'the price, stated flat');
  });

  it('says so when a hook does not start at the start', () => {
    // Positional, not semantic. A hook is the first thing said, so a span
    // beginning six seconds in is describing something else whatever it was
    // called.
    const r = SL.readStructure([
      { label: 'hook', start: 6, end: 7.5 },
      { label: 'cta', start: 7.5, end: 9.75 },
    ], REEL);
    assert.match(r.disagreements.join(' '), /the hook was placed at 6s/);
    assert.match(r.disagreements.join(' '), /first thing said/);
  });

  it('says so when nothing was labelled a hook', () => {
    const r = SL.readStructure([{ label: 'solution', start: 0, end: 9.5 }], REEL);
    assert.match(r.disagreements.join(' '), /nothing was labelled a hook/);
  });

  it('catches a missed call to action, and quotes the words', () => {
    // THE DISAGREEMENT THAT MATTERS. The lexicon found "link in bio"; the
    // labelling did not. One of them is wrong and the operator is told which
    // words to go and listen to.
    const r = SL.readStructure([
      { label: 'hook', start: 0, end: 2.5 },
      { label: 'solution', start: 2.5, end: 9.75 },
    ], REEL);
    assert.match(r.disagreements.join(' '), /no call to action was labelled/);
    assert.match(r.disagreements.join(' '), /"link in bio" is said at/);
  });

  it('accepts a call to action nobody spoke, and says it is on screen', () => {
    // A CTA can be entirely a card, a handle or an arrow. Allowed, and worth
    // saying, because a template built from it needs a text slot rather than
    // a line of narration.
    const quiet = say('the brickwork took four weeks and the pointing another two');
    const r = SL.readStructure([
      { label: 'hook', start: 0, end: 2 },
      { label: 'cta', start: 2, end: 2.6 },
    ], quiet);
    assert.match(r.disagreements.join(' '), /on screen rather than spoken/);
  });

  it('says so when the call to action is nowhere near the words that ask', () => {
    // The ask is at 8s. A CTA labelled at four is labelling something else,
    // and the figure in the message is what sends somebody to the right
    // moment of the audio.
    const r = SL.readStructure([
      { label: 'hook', start: 0, end: 2.5 },
      { label: 'solution', start: 2.5, end: 4 },
      { label: 'cta', start: 4, end: 5.5 },
    ], REEL);
    assert.match(
      r.disagreements.join(' '),
      /the call to action was placed at 4s but "link in bio" is said at 8s/
    );
  });

  it('says so when most of what was said carries no label', () => {
    const r = SL.readStructure([{ label: 'hook', start: 0, end: 2 }], REEL);
    assert.match(r.disagreements.join(' '), /carries a label/);
    assert.ok(r.confidence < 0.4, `and is unsure: ${r.confidence}`);
  });

  it('is less confident the more it disagrees with the transcript', () => {
    // At EQUAL COVERAGE, so it is the disagreement doing the work. The first
    // version compared a full labelling against a sparse one and the coverage
    // term alone explained the gap, so a sweep that deleted the disagreement
    // term entirely walked straight through it.
    const good = SL.readStructure(clean, REEL);
    const missedTheAsk = SL.readStructure([
      { label: 'hook', start: 0, end: 2.5 },
      { label: 'solution', start: 2.5, end: 9.75 },
    ], REEL);
    assert.equal(missedTheAsk.disagreements.length, 1);
    assert.ok(
      missedTheAsk.confidence < good.confidence - 0.1,
      `${missedTheAsk.confidence} against ${good.confidence} at the same coverage`
    );
  });

  it('never claims certainty, whatever it was given', () => {
    // Nothing in a reading is measured off the file. The ceiling is the
    // coefficient rather than a clamp on top of it, because a clamp that
    // cannot bite is code a sweep walks through.
    const everything = SL.readStructure(clean, REEL);
    assert.deepEqual(everything.disagreements, []);
    assert.ok(everything.confidence <= 0.85, `read ${everything.confidence}`);
  });

  it('refuses the whole reading when the labelling is not usable', () => {
    const r = SL.readStructure([{ label: 'epilogue', start: 0, end: 2 }], REEL);
    assert.equal(r.archetype, null);
    assert.equal(r.confidence, 0);
    assert.match(r.says, /not usable/);
    assert.match(r.says, /unknown label "epilogue"/);
  });

  it('reads as a sentence somebody writing a brief can use', () => {
    const r = SL.readStructure(clean, REEL);
    assert.match(r.says, /3 sections: hook 2\.5s, solution 5s, cta 2\.25s\./);
    assert.match(r.says, /asks for the click in words: "link in bio"/);
  });

  it('says when nothing in the words asks for a click', () => {
    const quiet = say('the brickwork took four weeks');
    const r = SL.readStructure([{ label: 'hook', start: 0, end: 1.4 }], quiet);
    assert.match(r.says, /Nothing in the words asks for a click/);
  });
});
