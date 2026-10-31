// The truncation the preview shows a client.
//
// The frame is approximate on purpose, but the clipping is not: "your
// headline gets cut at 40 characters on Facebook" is the thing a client is
// being asked to judge, and getting it wrong would be worse than showing no
// preview, because it would be confidently wrong.
//
//   node --test tests/adPreview.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const file = readFileSync(path.join(SRC, 'components', 'AdPlatformPreview.jsx'), 'utf8');

// Lifted by name rather than imported, so this runner stays clear of React.
function lift(name) {
  const start = file.indexOf(`export function ${name}`);
  assert.ok(start > -1, `${name} is no longer exported from AdPlatformPreview.jsx`);
  const end = file.indexOf('\n}', start) + 2;
  const src = file.slice(start, end).replace('export function', 'function');
  return eval(`(() => { ${src}; return ${name}; })()`);
}
const clip = lift('clip');
const bestImageFor = lift('bestImageFor');

const SURFACES = JSON.parse(JSON.stringify(
  eval('(' + file.slice(file.indexOf('{', file.indexOf('export const SURFACES')),
                        file.indexOf('\n};', file.indexOf('export const SURFACES')) + 2) + ')')
));

test('every surface declares a ratio, a limit and a note', () => {
  for (const [key, s] of Object.entries(SURFACES)) {
    assert.ok(s.label, `${key} has no label`);
    assert.match(s.ratio, /^\d+ \/ \d+$/, `${key} ratio`);
    assert.ok(typeof s.bodyLimit === 'number', `${key} bodyLimit`);
    assert.ok(s.note, `${key} must say what it is approximating`);
  }
});

test('the three surfaces are the ones the ads actually run on', () => {
  assert.deepEqual(Object.keys(SURFACES), ['instagram_feed', 'instagram_story', 'facebook_feed']);
  assert.equal(SURFACES.instagram_feed.ratio, '1 / 1');
  assert.equal(SURFACES.instagram_story.ratio, '9 / 16');
  assert.equal(SURFACES.facebook_feed.ratio, '4 / 5');
});

test('short copy is left alone', () => {
  assert.deepEqual(clip('Short headline', 40), { text: 'Short headline', clipped: false });
});

test('long copy is cut and reported as cut', () => {
  const long = 'x'.repeat(60);
  const out = clip(long, 40);
  assert.equal(out.text.length, 40);
  assert.equal(out.clipped, true);
});

test('a null limit means no limit, for a surface with no headline', () => {
  const long = 'x'.repeat(500);
  assert.deepEqual(clip(long, null), { text: long, clipped: false });
});

test('clipping never leaves a trailing space before the ellipsis', () => {
  const out = clip('abcdefgh ijkl', 9);
  assert.equal(out.text, 'abcdefgh');
  assert.equal(out.clipped, true);
});

test('empty and missing copy do not crash the preview', () => {
  assert.deepEqual(clip('', 40), { text: '', clipped: false });
  assert.deepEqual(clip(null, 40), { text: '', clipped: false });
  assert.deepEqual(clip(undefined, 40), { text: '', clipped: false });
});

test('exactly at the limit is not clipped', () => {
  // Off by one here would put "… more" on copy that fits, which tells a
  // client to cut something that does not need cutting.
  const out = clip('x'.repeat(125), 125);
  assert.equal(out.clipped, false);
});

// ── picking the asset ──────────────────────────────────────────────────

const IMAGES = [
  { id: 1, aspect_ratio: '1:1' },
  { id: 2, aspect_ratio: '4:5' },
  { id: 3, aspect_ratio: '9:16' },
];

test('each surface shows the asset rendered for its shape', () => {
  assert.equal(bestImageFor(IMAGES, 'instagram_feed').id, 1);
  assert.equal(bestImageFor(IMAGES, 'facebook_feed').id, 2);
  assert.equal(bestImageFor(IMAGES, 'instagram_story').id, 3);
});

test('with no matching size it falls back rather than showing nothing', () => {
  const onlySquare = [{ id: 9, aspect_ratio: '1:1' }];
  assert.equal(bestImageFor(onlySquare, 'instagram_story').id, 9);
});

test('no assets at all answers null, so the frame can say so', () => {
  assert.equal(bestImageFor([], 'instagram_feed'), null);
  assert.equal(bestImageFor(null, 'instagram_feed'), null);
});
