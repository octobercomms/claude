// Ticks decide what the step after Review acts on, so the edges matter
// more than the happy path: a batch whose posts have not loaded, a post
// deleted while ticked, and the difference between "all of them" and
// "none of them".
import assert from 'assert';
import { tickedIds, toggleTick, tickSummary } from '../src/utils/ticks.js';

const posts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

// A fresh batch acts on everything.
assert.deepStrictEqual([...tickedIds(null, posts)].sort(), ['a', 'b', 'c']);
assert.deepStrictEqual(tickSummary(null, posts), { count: 3, total: 3, all: true, none: false });

// Unticking one leaves the rest, rather than clearing the lot.
const minusB = toggleTick(null, posts, 'b');
assert.deepStrictEqual([...minusB].sort(), ['a', 'c']);
assert.deepStrictEqual(tickSummary(minusB, posts), { count: 2, total: 3, all: false, none: false });

// Ticking it back restores all of them.
assert.deepStrictEqual(tickSummary(toggleTick(minusB, posts, 'b'), posts).all, true);

// Unticking everything is a real state, not a reset to all.
let none = null;
for (const p of posts) none = toggleTick(none, posts, p.id);
assert.strictEqual(none.size, 0);
assert.deepStrictEqual(tickSummary(none, posts), { count: 0, total: 3, all: false, none: true });
assert.deepStrictEqual([...tickedIds(none, posts)], []);

// A post deleted while ticked does not reach the next step.
const stale = new Set(['a', 'gone']);
assert.deepStrictEqual([...tickedIds(stale, posts)], ['a']);
assert.deepStrictEqual(tickSummary(stale, posts), { count: 1, total: 3, all: false, none: false });

// Posts not loaded yet: "all" cannot be seeded from an empty list, which
// is why null is not a set.
assert.deepStrictEqual([...tickedIds(null, [])], []);
assert.deepStrictEqual(tickSummary(null, []), { count: 0, total: 0, all: false, none: true });
assert.deepStrictEqual([...tickedIds(null, undefined)], []);

// Nothing mutates its input.
const held = new Set(['a']);
toggleTick(held, posts, 'b');
assert.deepStrictEqual([...held], ['a']);

console.log('ok  ticks: 13 assertions');
