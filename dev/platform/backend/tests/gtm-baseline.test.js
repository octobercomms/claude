const { summariseAttention, STALE_DAYS } = require('../src/services/strategist/attention');
const assert = require('assert');

const now = new Date('2026-11-04T12:00:00Z');

const rows = [
  { client_id: 'c1', client_name: 'Falcon', slug: 'falcon', crucial_open: 3, oldest_raised_at: '2026-10-10T00:00:00Z' },
  { client_id: 'c2', client_name: 'Acme', slug: 'acme', crucial_open: 1, oldest_raised_at: '2026-11-01T00:00:00Z' },
  { client_id: 'c3', client_name: 'Clean', slug: 'clean', crucial_open: 2, oldest_raised_at: '2026-10-01T00:00:00Z' },
];

const result = summariseAttention(rows, { now });

assert.strictEqual(result.total, 3, 'three clients with open crucial items');
assert.strictEqual(result.stale, 2, 'two clients are stale (Falcon 25d, Clean 34d)');
assert.strictEqual(result.stale_days, STALE_DAYS);

assert.strictEqual(result.clients[0].client_name, 'Clean', 'oldest first');
assert.strictEqual(result.clients[0].stale, true);
assert.strictEqual(result.clients[0].oldest_days, 34);

assert.strictEqual(result.clients[1].client_name, 'Falcon');
assert.strictEqual(result.clients[1].stale, true);
assert.strictEqual(result.clients[1].oldest_days, 25);

assert.strictEqual(result.clients[2].client_name, 'Acme');
assert.strictEqual(result.clients[2].stale, false);
assert.strictEqual(result.clients[2].oldest_days, 3);

// Zero crucial items should not appear
const empty = summariseAttention([], { now });
assert.strictEqual(empty.total, 0);
assert.strictEqual(empty.stale, 0);

// A null oldest_raised_at should not be called stale
const unknown = summariseAttention([
  { client_id: 'c4', client_name: 'Unknown', slug: 'u', crucial_open: 1, oldest_raised_at: null },
], { now });
assert.strictEqual(unknown.clients[0].stale, false, 'unknown age is not stale');

console.log('gtm-baseline: 10 assertions passed');
