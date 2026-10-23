// What counts as a usable canvas size.
//
// A set's size reaches the database and then every page built on it, so a
// typo here is not a bad render, it is a set that has to be remade. The
// ceiling is memory: a page is held as pixels while it is edited, and 8000
// square is 256MB before a single layer is on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSize } from '../src/utils/designSizes.js';

test('a plain size comes through', () => {
  assert.deepEqual(cleanSize(1080, 1350), { width: 1080, height: 1350 });
});

test('strings from an input are numbers', () => {
  assert.deepEqual(cleanSize('1080', '1920'), { width: 1080, height: 1920 });
});

test('fractions are rounded rather than carried into a canvas', () => {
  assert.deepEqual(cleanSize(1080.4, 1349.6), { width: 1080, height: 1350 });
});

test('nothing, blank or nonsense is refused', () => {
  for (const bad of [[undefined, 1080], ['', 1080], ['abc', 1080], [null, null], [NaN, 10]]) {
    assert.equal(cleanSize(...bad), null, JSON.stringify(bad));
  }
});

test('zero and negative are refused', () => {
  assert.equal(cleanSize(0, 1080), null);
  assert.equal(cleanSize(1080, -10), null);
});

test('below 50 pixels is refused on either side', () => {
  assert.equal(cleanSize(49, 1080), null);
  assert.equal(cleanSize(1080, 49), null);
  assert.deepEqual(cleanSize(50, 50), { width: 50, height: 50 });
});

test('above 8000 pixels is refused on either side', () => {
  assert.equal(cleanSize(8001, 1080), null);
  assert.equal(cleanSize(1080, 8001), null);
  assert.deepEqual(cleanSize(8000, 8000), { width: 8000, height: 8000 });
});

test('Infinity is not a size', () => {
  assert.equal(cleanSize(Infinity, 1080), null);
});
