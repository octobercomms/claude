// Which conversation the analyst panel opens, per section.
//
// The backend has carried four PESO pillar personas since they were built —
// owned, shared, paid, earned — each with its own history thread and its own
// action tool, and until the panel nothing in the frontend ever asked for one.
// So this mapping is the only thing deciding whether standing on Owned gets
// you the analyst that can draft content or the general one that cannot.
//
// A wrong entry here fails silently and expensively: you would get a working
// chat, on the wrong thread, with the wrong tools, and nothing on screen would
// say so. Hence a test rather than trust.
//
//   node --test tests/analystContext.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analystContextFor } from '../src/utils/analystContext.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('each PESO section opens its own pillar conversation', () => {
  assert.deepEqual(analystContextFor('/clients/abc/ads'), { persona: 'paid', label: 'Paid' });
  assert.deepEqual(analystContextFor('/clients/abc/pr'), { persona: 'earned', label: 'Earned' });
  assert.deepEqual(analystContextFor('/clients/abc/social'), { persona: 'shared', label: 'Shared' });
  assert.deepEqual(analystContextFor('/clients/abc/seo'), { persona: 'owned', label: 'Owned' });
});

test('everywhere else is the general analyst', () => {
  for (const p of ['/clients/abc', '/clients/abc/video', '/clients/abc/sales-traffic', '/clients/abc/brand']) {
    assert.equal(analystContextFor(p).persona, 'analyst', p);
    assert.equal(analystContextFor(p).label, null, p);
  }
});

test('a query string does not change the section', () => {
  assert.equal(analystContextFor('/clients/abc/ads?tab=health').persona, 'paid');
  assert.equal(analystContextFor('/clients/abc?tab=measure&analyst=1').persona, 'analyst');
});

test('a path with no client is the general analyst, not a crash', () => {
  for (const p of ['/clients', '/settings', '/', '', undefined]) {
    assert.equal(analystContextFor(p).persona, 'analyst', String(p));
  }
});

// The mapping is only correct if the backend still answers to these names. It
// validates `persona` against its own list and silently falls back to the
// analyst for anything it does not recognise — so a rename there would not
// error, it would just quietly downgrade every pillar conversation.
test('every persona this sends is one the backend accepts', () => {
  const chat = readFileSync(path.join(ROOT, 'backend', 'src', 'routes', 'chat.js'), 'utf8');
  const m = chat.match(/const PILLAR_ACTION_TOOLS = \{([\s\S]*?)\n\};/);
  assert.ok(m, 'could not find PILLAR_ACTION_TOOLS in the chat route');
  const backendPersonas = new Set([...m[1].matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map(x => x[1]));

  const sent = ['/clients/x/ads', '/clients/x/pr', '/clients/x/social', '/clients/x/seo']
    .map(p => analystContextFor(p).persona);

  for (const persona of sent) {
    assert.ok(backendPersonas.has(persona),
      `the panel sends persona "${persona}", which chat.js does not define — it would fall back to the general analyst without erroring`);
  }
});
