// Guards the two-endpoint merge behind the Clients page.
//
//   node --test tests/clientList.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeClientList, summariseClients, filterClients, autoSlug } from '../src/utils/clientList.js';

const SPINE = [
  { id: 'a', name: 'Alpha', slug: 'alpha', active: true },
  { id: 'b', name: 'Beta', slug: 'beta', active: true },
  { id: 'z', name: 'Zeta', slug: 'zeta', active: false },
];

const SUMMARY = [
  { id: 'a', name: 'Alpha', connectors: [{ status: 'active' }, { status: 'active' }], last_report: { status: 'sent' } },
  { id: 'b', name: 'Beta', connectors: [{ status: 'active' }, { status: 'expired' }], last_report: null },
];

test('the summary enriches the spine without dropping anyone', () => {
  const rows = mergeClientList(SPINE, SUMMARY);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.id), ['a', 'b', 'z']);
  assert.equal(rows[0].connectors.length, 2);
  assert.equal(rows[0].last_report.status, 'sent');
});

test('an archived client survives with no summary extras', () => {
  const zeta = mergeClientList(SPINE, SUMMARY).find(r => r.id === 'z');
  assert.equal(zeta.active, false);
  assert.equal(zeta.connectors, undefined);
});

test('the spine wins on active, even against a stale summary', () => {
  // The summary was built before Zeta was archived, and still says active.
  const stale = [...SUMMARY, { id: 'z', active: true, connectors: [{ status: 'active' }] }];
  const zeta = mergeClientList(SPINE, stale).find(r => r.id === 'z');
  assert.equal(zeta.active, false, 'the /clients row is the authority on active');
});

test('a missing summary leaves the spine intact', () => {
  const rows = mergeClientList(SPINE, null);
  assert.equal(rows.length, 3);
  assert.equal(rows.every(r => r.connectors === undefined), true);
  assert.deepEqual(rows.map(r => r.active), [true, true, false]);
});

test('headline figures count active clients only', () => {
  const s = summariseClients(mergeClientList(SPINE, SUMMARY));
  assert.equal(s.activeCount, 2);
  assert.equal(s.archivedCount, 1);
  assert.equal(s.connTotal, 4);
  assert.equal(s.connActive, 3);
  assert.equal(s.healthPct, 75);
});

test('an archived client with connectors never dilutes health', () => {
  const rows = mergeClientList(SPINE, [...SUMMARY, { id: 'z', connectors: [{ status: 'error' }, { status: 'error' }] }]);
  const s = summariseClients(rows);
  assert.equal(s.connTotal, 4, 'archived connectors are excluded from the total');
  assert.equal(s.healthPct, 75);
});

test('no connectors anywhere reads 0%, not NaN', () => {
  const s = summariseClients([{ id: 'a', active: true }]);
  assert.equal(s.connTotal, 0);
  assert.equal(s.healthPct, 0);
});

test('the filter splits the list three ways', () => {
  const rows = mergeClientList(SPINE, SUMMARY);
  assert.deepEqual(filterClients(rows, 'active').map(r => r.id), ['a', 'b']);
  assert.deepEqual(filterClients(rows, 'archived').map(r => r.id), ['z']);
  assert.deepEqual(filterClients(rows, 'all').map(r => r.id), ['a', 'b', 'z']);
});

test('autoSlug trims and collapses', () => {
  assert.equal(autoSlug('Studio Nine Ltd'), 'studio-nine-ltd');
  assert.equal(autoSlug('  — Oculi Mundi! — '), 'oculi-mundi');
  assert.equal(autoSlug(''), '');
});
