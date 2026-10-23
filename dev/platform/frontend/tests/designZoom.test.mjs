// Stepping through the zoom ladder.
//
// The scale in front of you is rarely one of the steps: a 1080x1350 page
// fitted to the frame sits at 0.459, so zooming in from there has to find the
// next step up rather than multiply what is already on screen. A fixed ladder
// is also what makes in-then-out land back where it started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZOOMS, nextZoom } from '../src/utils/designSizes.js';

test('100% is on the ladder', () => {
  assert.ok(ZOOMS.includes(1), 'judging type at 46% is how a headline ships too small');
});

test('the ladder only goes up', () => {
  for (let i = 1; i < ZOOMS.length; i += 1) assert.ok(ZOOMS[i] > ZOOMS[i - 1]);
});

test('in and out step one rung', () => {
  assert.equal(nextZoom(1, 1), 1.5);
  assert.equal(nextZoom(1, -1), 0.75);
});

test('a scale between rungs finds the next one either way', () => {
  // where a fitted 1080x1350 page sits
  assert.equal(nextZoom(0.459, 1), 0.5);
  assert.equal(nextZoom(0.459, -1), 0.25);
});

test('in then out comes back to the same place', () => {
  for (const z of ZOOMS.slice(1, -1)) assert.equal(nextZoom(nextZoom(z, 1), -1), z);
});

test('it stops at both ends rather than running off', () => {
  assert.equal(nextZoom(ZOOMS[ZOOMS.length - 1], 1), ZOOMS[ZOOMS.length - 1]);
  assert.equal(nextZoom(ZOOMS[0], -1), ZOOMS[0]);
  assert.equal(nextZoom(99, 1), ZOOMS[ZOOMS.length - 1]);
  assert.equal(nextZoom(0.001, -1), ZOOMS[0]);
});

test('a rung is not mistaken for being between rungs', () => {
  // floating point: 0.75 reached by arithmetic is not always exactly 0.75
  assert.equal(nextZoom(0.1 + 0.65, 1), 1);
});
