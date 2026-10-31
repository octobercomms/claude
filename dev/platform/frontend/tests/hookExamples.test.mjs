import test from 'node:test';
import assert from 'node:assert/strict';
import { HOOK_EXAMPLES, FRAMEWORKS, examplesByFramework } from '../src/components/social/hookExamples.js';

test('every example names a framework the vault filters by', () => {
  // The vault's framework dropdown is built from this list. An example naming
  // a framework that is not in it would be invisible the moment somebody
  // filtered, which is the first thing you do on a list of six.
  const { unknown } = examplesByFramework();
  assert.deepEqual(unknown, [], 'an example names a framework the filter does not offer');
});

test('every framework the filter offers has at least one example', () => {
  // Otherwise filtering to that framework on an empty vault shows nothing,
  // and "no examples" reads as "this framework has no good openings".
  const { groups } = examplesByFramework();
  assert.deepEqual([...groups.keys()].sort(), [...FRAMEWORKS].sort());
});

test('every example says why it works', () => {
  // The whole point. A list of six good hooks with no reasoning is the thing
  // that was already there and did not teach anybody anything.
  for (const e of HOOK_EXAMPLES) {
    assert.ok(e.why && e.why.length > 40, `no reasoning on: ${e.hook}`);
  }
});

test('no example is a generic marketing line', () => {
  // These render inside a real client's vault. A hook about growth hacking or
  // crushing it teaches an architecture practice nothing about its own voice,
  // and reads as filler, which is how examples get ignored.
  const banned = /growth hack|crush|game.?chang|unlock|skyrocket|revolutioni|10x|guru|ninja/i;
  for (const e of HOOK_EXAMPLES) {
    assert.ok(!banned.test(e.hook), `generic line: ${e.hook}`);
    assert.ok(!banned.test(e.why), `generic reasoning: ${e.hook}`);
  }
});

test('an unknown framework is surfaced rather than dropped', () => {
  // The guard above is only useful if a typo actually reaches `unknown`
  // instead of being filtered into silence.
  const { unknown, groups } = examplesByFramework([
    { hook: 'x', framework: 'AIDA', why: 'y'.repeat(50) },
    { hook: 'z', framework: 'Typo-Framework', why: 'y'.repeat(50) },
  ]);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].framework, 'Typo-Framework');
  assert.deepEqual([...groups.keys()], ['AIDA']);
});
