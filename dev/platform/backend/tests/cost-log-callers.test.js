/**
 * Every caller of recordApiCost, checked against what it actually takes.
 *
 * This exists because of one call that was wrong in two ways at once and cost
 * real money every time somebody clicked a button.
 *
 * `recordApiCost` takes `{ provider, feature, costUsd, clientId, meta }`,
 * returns NOTHING, and swallows its own database errors by design. The
 * composition transcribe route called it with `purpose` and `cost` instead of
 * `feature` and `costUsd`, and then called `.catch()` on the undefined it
 * returned. So:
 *
 *   - the function hit its `if (!provider || !feature) return` and wrote no
 *     row, which is why composition transcription had never once appeared in
 *     the cost log, the cost chip or any task budget; and
 *   - `undefined.catch` threw a TypeError on the next line, AFTER OpenAI had
 *     been called and billed and BEFORE the transcript was saved.
 *
 * The visible result was a 500 reading "Cannot read properties of undefined
 * (reading 'catch')", a Whisper charge, and no transcript. Clicking Transcribe
 * again charged again. A unit test of the route would not have caught it
 * because the route was never run; a unit test of costLog would not have
 * caught it because costLog was right. It is a wiring fault, so this reads the
 * wiring, the way composition-render-route.test.js and strategist-weekly
 * do.
 *
 *   node tests/cost-log-callers.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

/** Every .js file under src/, so a new caller is covered the day it is written. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** The `{...}` argument of each recordApiCost call, with its file and line. */
function callsIn(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /recordApiCost\(\{/g;
  let m = re.exec(src);
  while (m) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') depth -= 1;
      i += 1;
    }
    out.push({
      file: path.relative(SRC, file),
      line: src.slice(0, m.index).split('\n').length,
      body: src.slice(m.index + m[0].length, i - 1),
      after: src.slice(i, i + 24),
    });
    m = re.exec(src);
  }
  return out;
}

const FILES = walk(SRC);
// costLog.js itself holds the definition and one internal re-call, neither of
// which is a caller to audit.
const CALLS = FILES.flatMap(callsIn).filter((c) => !/^services[/\\]costLog\.js$/.test(c.file));

/**
 * Is a field present, by name or by ES6 shorthand?
 *
 * `{ provider: 'fal', feature, costUsd }` is as correct as spelling each one
 * out: a generic wrapper takes `feature` from its own caller, who names it
 * with a literal. Requiring a colon marked three correct wrappers as broken.
 */
const has = (body, field) => new RegExp(`(^|[\\s,{])${field}\\s*[,:}]`).test(body)
  || new RegExp(`(^|[\\s,{])${field}\\s*$`, 'm').test(body);

describe('recordApiCost', () => {
  it('returns nothing, so there is no promise to chain onto', () => {
    // The fact the rule below rests on. Stated as a test rather than a
    // comment, because if the function ever did return a promise the rule
    // should change with it rather than being enforced out of habit.
    const dbPath = require.resolve('../src/db');
    const saved = require.cache[dbPath];
    require.cache[dbPath] = {
      id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [] }) },
    };
    delete require.cache[require.resolve('../src/services/costLog')];
    const { recordApiCost } = require('../src/services/costLog');
    const returned = recordApiCost({ provider: 'test', feature: 'test_feature', costUsd: 0 });
    if (saved) require.cache[dbPath] = saved; else delete require.cache[dbPath];
    assert.equal(returned, undefined);
  });

  it('is called somewhere, so this file is not passing on an empty list', () => {
    assert.ok(CALLS.length > 15, `found only ${CALLS.length} calls, which looks like a bad parse`);
  });

  it('is never given a `purpose` or a bare `cost`', () => {
    // The exact shape of the fault. `purpose` and `cost` are what an older
    // signature took, and they are silently ignored: the row is not written,
    // and nothing anywhere complains.
    const wrong = CALLS.filter((c) => /(^|[\s,{])purpose\s*:/.test(c.body) || /(^|[\s,{])cost\s*:/.test(c.body));
    assert.deepEqual(
      wrong.map((c) => `${c.file}:${c.line}`), [],
      'recordApiCost takes `feature` and `costUsd`. `purpose` and `cost` are dropped '
      + 'on the floor and the cost is never recorded'
    );
  });

  it('always gets a feature, or the call writes nothing at all', () => {
    const missing = CALLS.filter((c) => !has(c.body, 'feature'));
    assert.deepEqual(
      missing.map((c) => `${c.file}:${c.line}`), [],
      'without `feature` the function returns early, so the spend is invisible '
      + 'to the cost log, the cost chip and every task budget'
    );
  });

  it('always gets a provider, for the same reason', () => {
    const missing = CALLS.filter((c) => !has(c.body, 'provider'));
    assert.deepEqual(missing.map((c) => `${c.file}:${c.line}`), []);
  });

  it('is never chained with .then or .catch', () => {
    // `undefined.catch(...)` throws, and it throws in the middle of a route
    // that has already spent money. This is the assertion that would have
    // caught the live fault.
    const chained = CALLS.filter((c) => /^\s*\)?\s*\.\s*(then|catch)/.test(c.after));
    assert.deepEqual(
      chained.map((c) => `${c.file}:${c.line}`), [],
      'recordApiCost returns nothing and already swallows its own failures. '
      + 'Chaining onto it throws a TypeError at the call site'
    );
  });

  it('never ASSEMBLES a feature name at runtime', () => {
    // A forwarded `feature` is fine: a generic wrapper takes it from a caller
    // who names it with a literal, so the literal is still in the source and
    // a budget can list it. What cannot be capped is a name built from
    // interpolation or concatenation, because nobody reading the code can put
    // it in an ai_task_budgets `features` array.
    const assembled = CALLS.filter((c) => {
      const m = c.body.match(/(^|[\s,{])feature\s*:\s*([^,\n]+)/);
      if (!m) return false;
      const value = m[2].trim();
      return /\$\{/.test(value) || /\+/.test(value);
    });
    assert.deepEqual(
      assembled.map((c) => `${c.file}:${c.line}`), [],
      'a feature name assembled at runtime cannot be capped, because no budget '
      + 'can list it'
    );
  });
});

describe('the composition transcribe route', () => {
  const src = fs.readFileSync(path.join(SRC, 'routes', 'compose.js'), 'utf8');

  it('records its spend under the feature the video_batch budget sums over', () => {
    assert.match(
      src, /feature: 'composition_transcribe'/,
      'migration 248 gives the video_batch task this feature; a different name '
      + 'here means the cap sums nothing'
    );
  });

  it('saves the words BEFORE it logs the cost', () => {
    // The ordering is the whole lesson. The words are what was paid for, and
    // nothing about bookkeeping should be able to lose them: the old order
    // threw between the charge and the save.
    const save = src.indexOf('compositions.update(comp.id, { transcripts })');
    const cost = src.indexOf("feature: 'composition_transcribe'");
    assert.ok(save > 0 && cost > 0, 'both are present');
    assert.ok(
      save < cost,
      'the transcript is persisted first, so a fault in the cost call cannot '
      + 'discard a transcript OpenAI has already been paid for'
    );
  });
});
