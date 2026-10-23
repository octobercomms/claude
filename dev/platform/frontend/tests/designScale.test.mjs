// Resizing a set rescales every page in it. The maths is where a mistake is
// invisible until someone opens a design and finds the headline half the size
// it was, so it lives in its own pure module and is checked here.
//
//   node tests/designScale.test.mjs

import { rescaleScene, scaleFor } from '../src/utils/designScale.js';
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? (pass++, console.log('PASS ', n)) : (fail++, console.log('FAIL ', n, d ? `\n  ${d}` : '')); };
const sq = { width: 1080, height: 1080 };
const portrait = { width: 1080, height: 1350 };
const story = { width: 1080, height: 1920 };

check('a taller target scales by width and centres vertically', (() => {
  const { scale, dx, dy } = scaleFor(portrait, story);
  return scale === 1 && dx === 0 && dy === 285;
})(), JSON.stringify(scaleFor(portrait, story)));

check('a smaller target scales down', (() => {
  const { scale } = scaleFor(story, portrait);
  return Math.abs(scale - 1350 / 1920) < 1e-9;
})());

const scene = { objects: [
  { type: 'image', left: 0, top: 0, scaleX: 1, scaleY: 1 },
  { type: 'textbox', left: 100, top: 200, fontSize: 80, width: 800, scaleX: 2, scaleY: 2 },
] };
const out = rescaleScene(scene, portrait, story);
check('an image keeps its position relative to the page',
  out.objects[0].left === 0 && out.objects[0].top === 285, JSON.stringify(out.objects[0]));
check('text is scaled by font size, not by object scale',
  out.objects[1].fontSize === 80 && out.objects[1].scaleX === 1 && out.objects[1].scaleY === 1,
  JSON.stringify(out.objects[1]));
check('and its box scales with it', out.objects[1].width === 800);

const down = rescaleScene(scene, story, sq);
const r = 1080 / 1920;
check('scaling down halves the font size with everything else',
  Math.abs(down.objects[1].fontSize - 80 * r) < 1e-9, String(down.objects[1].fontSize));
check('nothing lands outside the page',
  down.objects.every(o => o.left >= 0 && o.top >= 0),
  JSON.stringify(down.objects.map(o => [o.left, o.top])));

check('same size is left alone', rescaleScene(scene, portrait, portrait) === scene);
check('a scene with no objects survives', rescaleScene({}, portrait, story).objects === undefined);
check('a zero dimension is refused rather than dividing by it',
  rescaleScene(scene, { width: 0, height: 0 }, story) === scene);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
