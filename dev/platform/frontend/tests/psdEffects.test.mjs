// What a Color Overlay is allowed to do to an imported layer.
//
// The colour of a background from Adobe Express lives in this effect and not
// in the layer's pixels, so reading it right is the difference between the
// brand colour and a white page. The rules it has to hold to: switched-off
// effects do nothing, a blend mode that depends on what is underneath is left
// alone, and opacity is honoured in either of the two shapes it arrives in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colourOverlay } from '../src/utils/psdImport.js';

const fx = (over) => ({ scale: 1, solidFill: [{ enabled: true, color: { r: 209, g: 73, b: 0 }, opacity: 1, blendMode: 'normal', ...over }] });

test('an enabled overlay gives its colour', () => {
  assert.deepEqual(colourOverlay(fx()), { colour: 'rgb(209, 73, 0)', opacity: 1 });
});

test('a switched-off overlay is ignored', () => {
  assert.equal(colourOverlay(fx({ enabled: false })), null);
});

test('no effects at all is not an error', () => {
  assert.equal(colourOverlay(undefined), null);
  assert.equal(colourOverlay({ scale: 1 }), null);
  assert.equal(colourOverlay({ scale: 1, dropShadow: [{ enabled: true }] }), null);
});

test('an overlay with no colour is ignored', () => {
  assert.equal(colourOverlay({ solidFill: [{ enabled: true }] }), null);
});

test('a blend mode that needs what is underneath is left alone', () => {
  assert.equal(colourOverlay(fx({ blendMode: 'multiply' })), null);
  assert.equal(colourOverlay(fx({ blendMode: 'screen' })), null);
});

test('opacity comes through as a fraction either way it is written', () => {
  assert.equal(colourOverlay(fx({ opacity: 0.4 })).opacity, 0.4);
  // Some writers use 0-100 instead of 0-1.
  assert.equal(colourOverlay(fx({ opacity: 40 })).opacity, 0.4);
  assert.equal(colourOverlay(fx({ opacity: 0 })).opacity, 0);
});

test('an out-of-range opacity is clamped rather than trusted', () => {
  assert.equal(colourOverlay(fx({ opacity: 140 })).opacity, 1);
  assert.equal(colourOverlay(fx({ opacity: -3 })).opacity, 0);
});

test('the first enabled overlay wins when several are written', () => {
  assert.equal(colourOverlay({ solidFill: [
    { enabled: false, color: { r: 0, g: 0, b: 0 } },
    { enabled: true, color: { r: 1, g: 2, b: 3 } },
  ] }).colour, 'rgb(1, 2, 3)');
});
