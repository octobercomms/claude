// A worked example is made once, and a failure is never reported as success.
//
// The point of this feature is that a newly set-up client has something real
// on all four pillars instead of four empty pages. Two ways that goes wrong
// are invisible until they happen on a real client:
//
//   - pressing the button twice makes a second set. The account lead cannot
//     tell by looking whether it has been pressed, so a second press must
//     cost nothing and leave nothing new to tell apart.
//   - one pillar failing takes the others with it, or is swallowed, so a
//     half-finished setup reads as done.
//
// The generators themselves are four Claude calls against a database, which
// this does not exercise. What it guards is the orchestration, which is where
// both failures live.
//
//   node tests/worked-examples.test.js

const assert = require('assert');
const { ensureAll, ensureOne, status } = require('../src/services/workedExamples');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n       ${err.message}`); }
}
async function acheck(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n       ${err.message}`); }
}

// A fake pillar that records what it was asked to do.
function pillar(label, { exists = false, throws = null } = {}) {
  const calls = { find: 0, make: 0 };
  let present = exists;
  return {
    calls,
    label,
    what: `a ${label} thing`,
    async find() { calls.find += 1; return present ? { id: `${label}-existing` } : null; },
    async make() {
      calls.make += 1;
      if (throws) throw new Error(throws);
      present = true;
      return { id: `${label}-new` };
    },
  };
}

(async () => {
  console.log('worked examples');

  await acheck('every missing pillar gets made', async () => {
    const reg = { a: pillar('a'), b: pillar('b') };
    const out = await ensureAll('c1', { registry: reg });
    assert.strictEqual(out.created, 2);
    assert.strictEqual(out.existed, 0);
    assert.strictEqual(out.failed, 0);
    assert.strictEqual(reg.a.calls.make, 1);
    assert.strictEqual(reg.b.calls.make, 1);
  });

  await acheck('a second press makes nothing twice', async () => {
    const reg = { a: pillar('a'), b: pillar('b') };
    await ensureAll('c1', { registry: reg });
    const second = await ensureAll('c1', { registry: reg });
    assert.strictEqual(second.created, 0, 'second run created something');
    assert.strictEqual(second.existed, 2);
    // The generators must not have run again. This is the money check: each
    // make() is a real Claude call on a real client.
    assert.strictEqual(reg.a.calls.make, 1);
    assert.strictEqual(reg.b.calls.make, 1);
  });

  await acheck('an existing example is left exactly as it is', async () => {
    const reg = { a: pillar('a', { exists: true }) };
    const out = await ensureAll('c1', { registry: reg });
    assert.strictEqual(out.existed, 1);
    assert.strictEqual(reg.a.calls.make, 0);
    assert.strictEqual(out.results[0].id, 'a-existing');
  });

  await acheck('one pillar failing does not stop the others', async () => {
    const reg = {
      a: pillar('a', { throws: 'Claude is down' }),
      b: pillar('b'),
      c: pillar('c'),
    };
    const out = await ensureAll('c1', { registry: reg });
    assert.strictEqual(out.failed, 1);
    assert.strictEqual(out.created, 2, 'the healthy pillars were skipped');
    assert.strictEqual(reg.b.calls.make, 1);
    assert.strictEqual(reg.c.calls.make, 1);
  });

  await acheck('a failure is reported as a failure, with its reason', async () => {
    const reg = { a: pillar('a', { throws: 'rate limited' }) };
    const out = await ensureAll('c1', { registry: reg });
    const row = out.results.find(r => r.pillar === 'a');
    assert.strictEqual(row.status, 'failed');
    assert.match(row.error, /rate limited/);
    // A failed pillar must never carry an id: an id is what the UI reads as
    // "there is one".
    assert.strictEqual(row.id, undefined);
  });

  await acheck('a failed pillar is retried on the next press', async () => {
    // The first run failed, so there is nothing to find and the second run
    // must try again rather than treating the failure as a result.
    let attempts = 0;
    const reg = {
      a: {
        label: 'a', what: 'a thing',
        async find() { return null; },
        async make() { attempts += 1; if (attempts === 1) throw new Error('transient'); return { id: 'a-new' }; },
      },
    };
    const first = await ensureAll('c1', { registry: reg });
    assert.strictEqual(first.failed, 1);
    const second = await ensureAll('c1', { registry: reg });
    assert.strictEqual(second.created, 1);
    assert.strictEqual(attempts, 2);
  });

  await acheck('only the named pillars run', async () => {
    const reg = { a: pillar('a'), b: pillar('b') };
    const out = await ensureAll('c1', { registry: reg, pillars: ['b'] });
    assert.strictEqual(out.results.length, 1);
    assert.strictEqual(reg.a.calls.make, 0, 'a ran when it was not asked for');
    assert.strictEqual(reg.b.calls.make, 1);
  });

  await acheck('an unknown pillar is ignored rather than crashing the run', async () => {
    const reg = { a: pillar('a') };
    const out = await ensureAll('c1', { registry: reg, pillars: ['a', 'nonsense'] });
    assert.strictEqual(out.results.length, 1);
    assert.strictEqual(out.created, 1);
  });

  await acheck('ensureOne on an unknown pillar fails rather than throwing', async () => {
    const out = await ensureOne('c1', 'nonsense', { a: pillar('a') });
    assert.strictEqual(out.status, 'failed');
    assert.match(out.error, /Unknown pillar/);
  });

  await acheck('status never makes anything', async () => {
    const reg = { a: pillar('a'), b: pillar('b', { exists: true }) };
    const out = await status('c1', { registry: reg });
    assert.strictEqual(reg.a.calls.make, 0);
    assert.strictEqual(reg.b.calls.make, 0);
    assert.strictEqual(out.missing, 1);
    assert.strictEqual(out.results.find(r => r.pillar === 'b').present, true);
  });

  await acheck('status survives a pillar whose lookup throws', async () => {
    const reg = {
      a: { label: 'a', what: 'a thing', async find() { throw new Error('db down'); }, async make() {} },
      b: pillar('b', { exists: true }),
    };
    const out = await status('c1', { registry: reg });
    assert.strictEqual(out.results.length, 2);
    assert.strictEqual(out.results[0].present, false);
    assert.strictEqual(out.results[1].present, true);
  });

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
