// Measure only says something when the numbers support it.
//
// This panel tells an account lead what to do more of and what to stop. The
// failure that matters is not a missing decision — it is a confident one
// derived from three posts, because that reaches a client as "your carousels
// are working" when nothing of the sort is known.
//
// So most of these check what it refuses to claim.
//
//   node --test tests/socialDecisions.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionsFrom, whyNothing, MIN_POSTS, LIFT, DRAG } from '../src/utils/socialDecisions.js';

const post = (over = {}) => ({
  id: 'p1', platform: 'instagram', kind: 'reel', hook: 'We costed three kitchens',
  is_heater: true, reach_multiple: 3.1, baseline_scope: 'cohort', ...over,
});
const fw = (framework, rate, posts = 5) => ({ framework, avg_engagement_rate: rate, posts });

test('a post that beat its baseline becomes a decision with a brief', () => {
  const { doMore } = decisionsFrom({ winners: [post()] });
  assert.equal(doMore.length, 1);
  assert.match(doMore[0].detail, /3\.1×/);
  assert.match(doMore[0].brief, /We costed three kitchens/,
    'the brief does not carry the hook it is telling you to reuse');
});

test('a post with no baseline claims nothing', () => {
  // socialBaseline sets baseline_scope 'none' and is_heater false when there
  // are too few comparable posts. A multiple off two posts is noise.
  const { doMore } = decisionsFrom({ winners: [post({ is_heater: false, baseline_scope: 'none', reach_multiple: null })] });
  assert.deepEqual(doMore, []);
});

test('a heater flag with no multiple behind it is not trusted either', () => {
  const { doMore } = decisionsFrom({ winners: [post({ reach_multiple: null })] });
  assert.deepEqual(doMore, [], 'is_heater alone was enough to produce a decision');
});

test('a wider baseline is said out loud rather than quietly assumed', () => {
  const { doMore } = decisionsFrom({ winners: [post({ baseline_scope: 'account' })] });
  assert.match(doMore[0].caveat || '', /whole account/);
});

test(`a framework under ${MIN_POSTS} posts is not read at all`, () => {
  const { doMore, doLess, frameworksRead } = decisionsFrom({
    frameworks: [fw('Listicle', 99, MIN_POSTS - 1), fw('Teardown', 0.1, MIN_POSTS - 1)],
  });
  assert.equal(frameworksRead, 0);
  assert.deepEqual(doMore, []);
  assert.deepEqual(doLess, [], 'a one-post framework was reported as dragging');
});

test('one framework alone has nothing to be above or below', () => {
  const { doMore, doLess } = decisionsFrom({ frameworks: [fw('Listicle', 99, 20)] });
  assert.deepEqual([...doMore, ...doLess], []);
});

test('a framework well above the average is a decision', () => {
  const { doMore } = decisionsFrom({ frameworks: [fw('Teardown', 8), fw('Listicle', 2)] });
  assert.equal(doMore.length, 1);
  assert.equal(doMore[0].title, 'Teardown');
  assert.match(doMore[0].brief, /Teardown/);
});

test('a framework well below it is a decision to stop', () => {
  const { doLess } = decisionsFrom({ frameworks: [fw('Teardown', 8), fw('Listicle', 2)] });
  assert.equal(doLess.length, 1);
  assert.equal(doLess[0].title, 'Listicle');
});

test('frameworks inside the band produce nothing, because the difference is not actionable', () => {
  // 5.0 and 4.6 average 4.8; the lift threshold is 6.0 and the drag 3.6.
  const { doMore, doLess } = decisionsFrom({ frameworks: [fw('A', 5.0), fw('B', 4.6)] });
  assert.deepEqual([...doMore, ...doLess], [],
    `a ${Math.round((5.0 / 4.8) * 100) / 100}× difference was reported as a decision (lift ${LIFT}, drag ${DRAG})`);
});

test('(unspecified) is not a framework you can do more of', () => {
  const { doMore, doLess } = decisionsFrom({ frameworks: [fw('(unspecified)', 9), fw('Listicle', 1)] });
  assert.ok(![...doMore, ...doLess].some(d => d.title === '(unspecified)'));
});

test('the list stays short enough to act on', () => {
  const winners = Array.from({ length: 10 }, (_, i) => post({ id: `p${i}` }));
  const { doMore } = decisionsFrom({ winners });
  assert.ok(doMore.length <= 3, `${doMore.length} decisions is a report again`);
});

test('nothing at all is explained specifically, not as "no data"', () => {
  assert.match(whyNothing({ winners: [] }), /publish/i);
  assert.match(whyNothing({ winners: [post({ baseline_scope: 'none', is_heater: false })] }), /too few/i);
  const quiet = whyNothing({ winners: [post({ is_heater: false })], frameworks: [fw('A', 5, 1)] });
  assert.match(quiet, new RegExp(`${MIN_POSTS} posts`),
    'the message does not say how many posts a framework needs');
});

test('an empty call does not throw', () => {
  const r = decisionsFrom();
  assert.deepEqual(r.doMore, []);
  assert.deepEqual(r.doLess, []);
});
