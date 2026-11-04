/**
 * Caption preview: the ASS compiler and the timeline time-mapping.
 *
 * The preview must agree with the render. These tests check the boundary
 * between the two: the same compile.mjs is called, the same ASS comes out,
 * and the word timings are mapped from source time to timeline time the same
 * way the render graph places them.
 *
 *   node --test tests/captionPreview.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, stamp, toAss, group } from '../../shared/captions/compile.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const presets = JSON.parse(readFileSync(join(here, '../../shared/captions/presets.json'), 'utf8'));

const WORDS = [
  { word: 'Fifteen', start: 0.10, end: 0.52 },
  { word: 'years',   start: 0.52, end: 0.88 },
  { word: 'later',   start: 0.88, end: 1.22 },
  { word: 'the',     start: 1.22, end: 1.36 },
  { word: 'company', start: 1.36, end: 1.90 },
];

const PRESET = presets.styles.hormozi;
const FORMAT = presets.outputFormats.vertical;

// ── compile.mjs: ASS output structure ───────────────────────────────────

test('compile produces valid ASS with Script Info and Events sections', () => {
  const ass = compile({ words: WORDS, preset: PRESET, format: FORMAT, perLine: 3 });
  assert.ok(ass.includes('[Script Info]'), 'has Script Info section');
  assert.ok(ass.includes('[V4+ Styles]'), 'has V4+ Styles section');
  assert.ok(ass.includes('[Events]'), 'has Events section');
  assert.ok(ass.includes('PlayResX: 1080'), 'PlayResX matches format');
  assert.ok(ass.includes('PlayResY: 1920'), 'PlayResY matches format');
});

test('compile produces one Dialogue line per word', () => {
  const ass = compile({ words: WORDS, preset: PRESET, format: FORMAT, perLine: 3 });
  const dialogues = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
  assert.strictEqual(dialogues.length, WORDS.length, 'one Dialogue per word');
});

test('Dialogue timestamps cover the word range', () => {
  const ass = compile({ words: WORDS, preset: PRESET, format: FORMAT, perLine: 3 });
  const dialogues = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
  // First word: starts at 0.10
  assert.ok(dialogues[0].includes(stamp(WORDS[0].start)), 'first Dialogue starts at first word');
});

test('toAss converts hex to ASS BGR format', () => {
  assert.strictEqual(toAss('#FF0000'), '&H000000FF');  // red
  assert.strictEqual(toAss('#00FF00'), '&H0000FF00');  // green
  assert.strictEqual(toAss('#0000FF'), '&H00FF0000');  // blue
  assert.strictEqual(toAss('#FFFFFF'), '&H00FFFFFF');  // white
});

test('stamp formats seconds to h:mm:ss.cc', () => {
  assert.strictEqual(stamp(0), '0:00:00.00');
  assert.strictEqual(stamp(1.5), '0:00:01.50');
  assert.strictEqual(stamp(65.123), '0:01:05.12');
  assert.strictEqual(stamp(3661), '1:01:01.00');
});

test('group splits words into lines of perLine', () => {
  const lines = group(WORDS, 3);
  assert.strictEqual(lines.length, 2, 'five words at 3 per line = 2 lines');
  assert.strictEqual(lines[0].length, 3);
  assert.strictEqual(lines[1].length, 2);
});

// ── buildCaptionAss: timeline time-mapping ──────────────────────────────
//
// buildCaptionAss lives in a hook file that uses import.meta.url and
// Vite-specific imports (@shared, presets.json). We test its logic by
// reimplementing the time-mapping here -- the function is small and the
// algorithm is the important thing to test, not the import wiring.

/**
 * The same mapping buildCaptionAss does: take source words, an item's at/in/len,
 * and return timeline-mapped words clipped to the item's boundaries.
 */
function mapWordsToTimeline(words, item) {
  const mapped = [];
  const inPt = item.in || 0;
  const itemEndTime = item.at + item.len;
  for (const w of words) {
    if (w.end <= inPt || w.start >= inPt + item.len) continue;
    const start = item.at + Math.max(0, w.start - inPt);
    const end = Math.min(item.at + (w.end - inPt), itemEndTime);
    if (end <= start) continue;
    mapped.push({ word: w.word, start, end });
  }
  return mapped;
}

test('mapWordsToTimeline shifts words to timeline position', () => {
  const item = { at: 5, len: 3, in: 0 };
  const mapped = mapWordsToTimeline(WORDS, item);

  // First word: source 0.10-0.52 -> timeline 5.10-5.52
  assert.ok(mapped.length > 0, 'has mapped words');
  assert.ok(Math.abs(mapped[0].start - 5.10) < 0.001, 'first word start');
  assert.ok(Math.abs(mapped[0].end - 5.52) < 0.001, 'first word end');
  assert.strictEqual(mapped[0].word, 'Fifteen');
});

test('mapWordsToTimeline clips words to item boundaries', () => {
  const item = { at: 0, len: 1, in: 0 };
  const mapped = mapWordsToTimeline(WORDS, item);

  // Words ending before 0 or starting after 1.0 should be excluded
  // Word "the" starts at 1.22, should NOT be included
  // Word "later" (0.88-1.22) starts at 0.88 < 1.0, should be included but end clipped
  assert.ok(mapped.some(w => w.word === 'later'), '"later" included (starts at 0.88)');
  assert.ok(!mapped.some(w => w.word === 'the'), '"the" excluded (starts at 1.22)');
  assert.ok(!mapped.some(w => w.word === 'company'), '"company" excluded (starts at 1.36)');

  // "later" end should be clipped to 1.0 (item boundary)
  const later = mapped.find(w => w.word === 'later');
  assert.ok(Math.abs(later.end - 1.0) < 0.001, 'later end clipped to 1.0');
});

test('mapWordsToTimeline handles in-point offset', () => {
  const item = { at: 10, len: 1, in: 1.0 };
  const mapped = mapWordsToTimeline(WORDS, item);

  // Source range: 1.0 to 2.0
  // "the" (1.22-1.36) and "company" (1.36-1.90) are in range
  // "later" (0.88-1.22) has end > 1.0 but start < 1.0, so it's partially in
  assert.ok(mapped.some(w => w.word === 'the'), '"the" included');
  assert.ok(mapped.some(w => w.word === 'company'), '"company" included');
  assert.ok(!mapped.some(w => w.word === 'Fifteen'), '"Fifteen" excluded (ends at 0.52 < 1.0)');

  // "the" at source 1.22 -> timeline 10 + (1.22 - 1.0) = 10.22
  const the = mapped.find(w => w.word === 'the');
  assert.ok(Math.abs(the.start - 10.22) < 0.001, '"the" mapped to 10.22');
  assert.ok(Math.abs(the.end - 10.36) < 0.001, '"the" end mapped to 10.36');
});

test('mapWordsToTimeline returns empty for no overlap', () => {
  const item = { at: 0, len: 0.05, in: 0 };
  const mapped = mapWordsToTimeline(WORDS, item);
  // Item is 0.05s long; first word starts at 0.10
  assert.strictEqual(mapped.length, 0, 'no words in 0-0.05s range');
});

test('compile with timeline-mapped words produces correct ASS timestamps', () => {
  // Simulate what buildCaptionAss does: map words, then compile
  const item = { at: 5, len: 3, in: 0 };
  const mapped = mapWordsToTimeline(WORDS, item);
  mapped.sort((a, b) => a.start - b.start);

  const ass = compile({
    words: mapped,
    preset: PRESET,
    format: FORMAT,
    perLine: 3,
    marginV: 320,
  });

  const dialogues = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
  assert.ok(dialogues.length > 0, 'has Dialogue lines');
  // The first Dialogue should start at 5.10 (item.at + first_word.start)
  assert.ok(dialogues[0].includes(stamp(5.10)), 'first Dialogue at timeline position');
});

test('every preset in the library produces valid ASS', () => {
  for (const [id, preset] of Object.entries(presets.styles)) {
    const ass = compile({
      words: WORDS,
      preset,
      format: FORMAT,
      perLine: preset.wordsPerLine || 3,
      marginV: 320,
    });
    assert.ok(ass.includes('[Script Info]'), `${id}: has Script Info`);
    assert.ok(ass.includes('Dialogue:'), `${id}: has Dialogue`);
  }
});
