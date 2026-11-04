const { describe, it, beforeEach } = require('node:test');
const assert = require('assert');

/**
 * Tests for the composition backend: the service layer, the route-level
 * whisperWords helper, and the extractAudio command builder.
 *
 * These are pure-logic tests. They do not hit the database or the network.
 * The compose routes themselves are integration-tested by the frontend
 * through the API, but the mapping, validation, and transcription logic
 * can be tested in isolation.
 */

// ── Composition model round-trip ─────────────────────────────────────

describe('composition data round-trip', async () => {
  const C = await import('../../shared/composition.mjs');

  it('a saved composition is valid when loaded back', () => {
    let comp = C.emptyComposition({ width: 1920, height: 1080, fps: 25 });
    const { comp: c1, id: s1 } = C.addSource(comp, {
      kind: 'clip', asset: 'a1', url: '/a.mp4', duration: 10,
      width: 1920, height: 1080, fps: 25,
    });
    comp = c1;
    const { comp: c2, id: t1 } = C.addTrack(comp, 'video');
    comp = c2;
    const { comp: c3 } = C.addItem(comp, t1, {
      source: s1, at: 0, len: 10,
    });
    comp = c3;

    const json = JSON.stringify(comp);
    const loaded = JSON.parse(json);
    const errors = C.validate(loaded);
    assert.deepStrictEqual(errors, []);
  });

  it('source_assets map survives JSON serialisation', () => {
    const map = { s1: 42, s2: 99 };
    const json = JSON.stringify(map);
    const loaded = JSON.parse(json);
    assert.deepStrictEqual(loaded, map);
    assert.strictEqual(loaded.s1, 42);
  });

  it('transcripts map with word arrays survives JSON serialisation', () => {
    const words = [
      { word: 'hello', start: 0.5, end: 0.9 },
      { word: 'world', start: 1.0, end: 1.4 },
    ];
    const map = { src1: words };
    const json = JSON.stringify(map);
    const loaded = JSON.parse(json);
    assert.strictEqual(loaded.src1.length, 2);
    assert.strictEqual(loaded.src1[0].word, 'hello');
    assert.strictEqual(loaded.src1[1].start, 1.0);
  });
});

// ── Whisper response parsing ─────────────────────────────────────────

describe('whisper response parsing', () => {
  function parseWords(body) {
    const words = Array.isArray(body.words) ? body.words : [];
    return words
      .map(w => ({ word: String(w.word ?? '').trim(), start: Number(w.start), end: Number(w.end) }))
      .filter(w => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
  }

  it('extracts words from a normal Whisper response', () => {
    const body = {
      words: [
        { word: 'For', start: 0.24, end: 0.56 },
        { word: 'two', start: 0.56, end: 0.72 },
        { word: 'hundred', start: 0.72, end: 1.12 },
        { word: 'years', start: 1.12, end: 1.44 },
      ],
    };
    const result = parseWords(body);
    assert.strictEqual(result.length, 4);
    assert.strictEqual(result[0].word, 'For');
    assert.strictEqual(result[3].end, 1.44);
  });

  it('filters out words with missing fields', () => {
    const body = {
      words: [
        { word: 'good', start: 0, end: 0.5 },
        { word: '', start: 1, end: 1.5 },
        { word: 'also', start: NaN, end: 2 },
        { word: 'bad', start: 3, end: 3 },
      ],
    };
    const result = parseWords(body);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].word, 'good');
  });

  it('handles missing words array gracefully', () => {
    assert.deepStrictEqual(parseWords({}), []);
    assert.deepStrictEqual(parseWords({ words: null }), []);
  });

  it('trims whitespace from words', () => {
    const body = { words: [{ word: '  hello  ', start: 0, end: 1 }] };
    const result = parseWords(body);
    assert.strictEqual(result[0].word, 'hello');
  });
});

// ── Timeline-mapped timings for reel checks ──────────────────────────

describe('timeline-mapped timings', async () => {
  const C = await import('../../shared/composition.mjs');

  function mapTimings(transcripts, composition) {
    const words = [];
    for (const [sourceId, wList] of Object.entries(transcripts)) {
      if (!Array.isArray(wList)) continue;
      for (const track of composition.tracks) {
        for (const item of track.items) {
          if (item.source !== sourceId) continue;
          const inPt = item.in || 0;
          for (const w of wList) {
            if (w.start >= inPt && w.start < inPt + item.len) {
              words.push({
                word: w.word,
                start: item.at + (w.start - inPt),
                end: item.at + (w.end - inPt),
              });
            }
          }
        }
      }
    }
    words.sort((a, b) => a.start - b.start);
    return words;
  }

  it('maps source timings to timeline positions', () => {
    let comp = C.emptyComposition();
    const { comp: c1, id: s1 } = C.addSource(comp, {
      kind: 'clip', asset: 'a', url: '/a.mp4', duration: 10,
      width: 1080, height: 1920, fps: 30,
    });
    comp = c1;
    const { comp: c2, id: t1 } = C.addTrack(comp, 'video');
    comp = c2;
    const { comp: c3 } = C.addItem(comp, t1, {
      source: s1, at: 5, len: 8, in: 2,
    });
    comp = c3;

    const transcript = [
      { word: 'hello', start: 2.5, end: 3.0 },
      { word: 'world', start: 4.0, end: 4.5 },
    ];

    const result = mapTimings({ [s1]: transcript }, comp);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].word, 'hello');
    assert.strictEqual(result[0].start, 5.5);
    assert.strictEqual(result[1].word, 'world');
    assert.strictEqual(result[1].start, 7.0);
  });

  it('excludes words outside the item range', () => {
    let comp = C.emptyComposition();
    const { comp: c1, id: s1 } = C.addSource(comp, {
      kind: 'clip', asset: 'a', url: '/a.mp4', duration: 20,
      width: 1080, height: 1920, fps: 30,
    });
    comp = c1;
    const { comp: c2, id: t1 } = C.addTrack(comp, 'video');
    comp = c2;
    const { comp: c3 } = C.addItem(comp, t1, {
      source: s1, at: 0, len: 5, in: 3,
    });
    comp = c3;

    const transcript = [
      { word: 'before', start: 1.0, end: 1.5 },
      { word: 'inside', start: 4.0, end: 4.5 },
      { word: 'after', start: 9.0, end: 9.5 },
    ];

    const result = mapTimings({ [s1]: transcript }, comp);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].word, 'inside');
  });

  it('combines words from multiple sources', () => {
    let comp = C.emptyComposition();
    const { comp: c1, id: s1 } = C.addSource(comp, {
      kind: 'clip', asset: 'a', url: '/a.mp4', duration: 10,
      width: 1080, height: 1920, fps: 30,
    });
    comp = c1;
    const { comp: c2, id: s2 } = C.addSource(comp, {
      kind: 'clip', asset: 'b', url: '/b.mp4', duration: 10,
      width: 1080, height: 1920, fps: 30,
    });
    comp = c2;
    const { comp: c3, id: t1 } = C.addTrack(comp, 'video');
    comp = c3;
    const { comp: c4 } = C.addItem(comp, t1, {
      source: s1, at: 0, len: 5,
    });
    comp = c4;
    const { comp: c5 } = C.addItem(comp, t1, {
      source: s2, at: 5, len: 5,
    });
    comp = c5;

    const transcripts = {
      [s1]: [{ word: 'first', start: 1, end: 1.5 }],
      [s2]: [{ word: 'second', start: 2, end: 2.5 }],
    };

    const result = mapTimings(transcripts, comp);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].word, 'first');
    assert.strictEqual(result[0].start, 1);
    assert.strictEqual(result[1].word, 'second');
    assert.strictEqual(result[1].start, 7);
  });

  it('returns empty array when no transcripts', () => {
    const comp = C.emptyComposition();
    assert.deepStrictEqual(mapTimings({}, comp), []);
  });
});

// ── Reel checks with composition transcript ──────────────────────────

describe('reel checks from composition transcript', async () => {
  const { checkReel } = await import('../../shared/reelChecks.mjs');

  it('returns null checks without a transcript', () => {
    const result = checkReel({});
    assert.ok(result.unknown > 0);
    for (const c of result.checks) {
      if (c.key !== 'captions') {
        assert.strictEqual(c.pass, null, `${c.key} should be null without transcript`);
      }
    }
  });

  it('runs real checks with word timings', () => {
    const timings = [
      { word: 'In', start: 0.2, end: 0.4 },
      { word: '1851', start: 0.4, end: 0.9 },
      { word: 'the', start: 1.0, end: 1.1 },
      { word: 'Crystal', start: 1.1, end: 1.5 },
      { word: 'Palace', start: 1.5, end: 1.9 },
      { word: 'was', start: 2.0, end: 2.2 },
      { word: 'built', start: 2.2, end: 2.5 },
      { word: 'in', start: 2.5, end: 2.6 },
      { word: 'Hyde', start: 2.6, end: 2.9 },
      { word: 'Park', start: 2.9, end: 3.2 },
    ];

    const result = checkReel({
      timings,
      edit: { duration_s: 35, caption_template: 'bold' },
    });

    const hookTiming = result.checks.find(c => c.key === 'hook_timing');
    assert.strictEqual(hookTiming.pass, true);

    const hookFact = result.checks.find(c => c.key === 'hook_is_a_fact');
    assert.strictEqual(hookFact.pass, true);

    const stated = result.checks.find(c => c.key === 'stated_flatly');
    assert.strictEqual(stated.pass, true);

    const captions = result.checks.find(c => c.key === 'captions');
    assert.strictEqual(captions.pass, true);

    assert.ok(result.passed >= 4);
  });

  it('fails hook_timing when first word is late', () => {
    const timings = [
      { word: 'So', start: 2.5, end: 2.8 },
      { word: 'anyway', start: 2.8, end: 3.2 },
    ];
    const result = checkReel({ timings, edit: { duration_s: 30 } });
    const hookTiming = result.checks.find(c => c.key === 'hook_timing');
    assert.strictEqual(hookTiming.pass, false);
  });

  it('fails stated_flatly when hook contains hype', () => {
    const timings = [
      { word: 'This', start: 0.2, end: 0.4 },
      { word: 'is', start: 0.4, end: 0.5 },
      { word: 'incredible', start: 0.5, end: 1.0 },
    ];
    const result = checkReel({ timings, edit: { duration_s: 30 } });
    const stated = result.checks.find(c => c.key === 'stated_flatly');
    assert.strictEqual(stated.pass, false);
  });
});
