// "Needs attention" has to mean something, or it becomes a number nobody looks
// at. Two ways that happens: letting nice-to-haves raise the alarm, and calling
// something stale when the age is not actually known.
//
//   node tests/strategist-attention.test.js

const assert = require('assert');
const { summariseAttention, ageInDays } = require('../src/services/strategist/attention');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const NOW = new Date('2026-10-29T12:00:00Z');
const daysAgo = n => new Date(NOW.getTime() - n * 86400000).toISOString();

console.log('summariseAttention');

check('a client past the threshold is stale and counted', () => {
  const r = summariseAttention([
    { client_id: 'c1', client_name: 'Falcon', crucial_open: 2, oldest_raised_at: daysAgo(23) },
  ], { now: NOW });
  assert.strictEqual(r.stale, 1);
  assert.strictEqual(r.total, 1);
  assert.strictEqual(r.clients[0].oldest_days, 23);
  assert.strictEqual(r.clients[0].stale, true);
});

check('a client inside the threshold counts as open but not stale', () => {
  const r = summariseAttention([
    { client_id: 'c1', client_name: 'Falcon', crucial_open: 4, oldest_raised_at: daysAgo(3) },
  ], { now: NOW });
  assert.strictEqual(r.stale, 0, 'three days is work in progress, not slipping');
  assert.strictEqual(r.total, 1, 'but it is still open');
  assert.strictEqual(r.clients[0].stale, false);
});

check('the threshold is a boundary, not a range', () => {
  const at = summariseAttention([{ client_id: 'c', client_name: 'x', crucial_open: 1, oldest_raised_at: daysAgo(14) }], { now: NOW });
  const under = summariseAttention([{ client_id: 'c', client_name: 'x', crucial_open: 1, oldest_raised_at: daysAgo(13) }], { now: NOW });
  assert.strictEqual(at.stale, 1, 'exactly 14 days is stale');
  assert.strictEqual(under.stale, 0, '13 days is not');
});

check('a client with one old item outranks one with four new ones', () => {
  const r = summariseAttention([
    { client_id: 'new', client_name: 'New', crucial_open: 4, oldest_raised_at: daysAgo(1) },
    { client_id: 'old', client_name: 'Old', crucial_open: 1, oldest_raised_at: daysAgo(30) },
  ], { now: NOW });
  assert.strictEqual(r.clients[0].client_id, 'old', 'age is the signal that something is being avoided');
  assert.strictEqual(r.clients[1].client_id, 'new');
});

check('same age falls back to the number of items', () => {
  const r = summariseAttention([
    { client_id: 'few', client_name: 'Few', crucial_open: 1, oldest_raised_at: daysAgo(20) },
    { client_id: 'many', client_name: 'Many', crucial_open: 6, oldest_raised_at: daysAgo(20) },
  ], { now: NOW });
  assert.strictEqual(r.clients[0].client_id, 'many');
});

check('a client with no open crucial items does not appear at all', () => {
  const r = summariseAttention([
    { client_id: 'clean', client_name: 'Clean', crucial_open: 0, oldest_raised_at: daysAgo(40) },
  ], { now: NOW });
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.stale, 0);
  assert.deepStrictEqual(r.clients, []);
});

check('an unknown age is never called stale', () => {
  for (const bad of [null, undefined, '', 'not a date']) {
    const r = summariseAttention([
      { client_id: 'c', client_name: 'x', crucial_open: 2, oldest_raised_at: bad },
    ], { now: NOW });
    assert.strictEqual(r.clients[0].oldest_days, null, String(bad));
    assert.strictEqual(r.clients[0].stale, false, `${bad} must not raise an alarm`);
    assert.strictEqual(r.stale, 0);
    assert.strictEqual(r.total, 1, 'it is still open, just of unknown age');
  }
});

check('no clients at all is zero, not a crash', () => {
  for (const empty of [[], null, undefined]) {
    const r = summariseAttention(empty, { now: NOW });
    assert.strictEqual(r.stale, 0);
    assert.strictEqual(r.total, 0);
    assert.deepStrictEqual(r.clients, []);
  }
});

check('the threshold is overridable, and reported back', () => {
  const rows = [{ client_id: 'c', client_name: 'x', crucial_open: 1, oldest_raised_at: daysAgo(8) }];
  assert.strictEqual(summariseAttention(rows, { now: NOW, staleDays: 7 }).stale, 1);
  assert.strictEqual(summariseAttention(rows, { now: NOW }).stale, 0);
  assert.strictEqual(summariseAttention(rows, { now: NOW }).stale_days, 14);
});

check('a count arriving as a string from pg still counts', () => {
  const r = summariseAttention([
    { client_id: 'c', client_name: 'x', crucial_open: '3', oldest_raised_at: daysAgo(20) },
  ], { now: NOW });
  assert.strictEqual(r.clients[0].crucial_open, 3);
  assert.strictEqual(r.stale, 1);
});

console.log('\nageInDays');

check('a future timestamp is zero, never negative', () => {
  assert.strictEqual(ageInDays(new Date(NOW.getTime() + 86400000).toISOString(), NOW), 0);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
