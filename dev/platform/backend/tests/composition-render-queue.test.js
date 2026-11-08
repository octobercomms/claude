/**
 * The render queue's SQL decisions, without a database.
 *
 * The behaviour of this queue under real concurrency is proved in
 * `composition-render-queue.db.test.js`, which needs a Postgres and therefore
 * does not run in CI. That leaves a gap: the decisions that make the queue
 * correct are single words in SQL, and a word is easy to delete. These run in
 * CI against a stubbed pool and pin the words.
 *
 * It is a blunt kind of test and that is the point. Each assertion below
 * corresponds to a fault the old arrangement actually had — the "queue" was
 * two module-level variables in routes/compose.js holding start closures —
 * and to the single piece of SQL that prevents it coming back:
 *
 *   SKIP LOCKED          two instances cannot render one row twice
 *   ORDER BY created_at  a batch runs in the order it was submitted
 *   claimed_at < now()   a render whose runner died is taken back, which no
 *                        other queue in this repo does
 *   attempts < MAX       and a row that kills every runner stops rather than
 *                        looping, which is the failure a reaper introduces
 *   ORDER BY … id DESC   the newest render of a composition is deterministic;
 *                        created_at alone is transaction-start time, so two
 *                        rows written in one transaction tie
 *
 *   node tests/composition-render-queue.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Stub the pool by injecting into require.cache before loading the service,
// the same arrangement compositions.test.js uses.
const calls = [];
const fakePool = {
  query: async (sql, params) => {
    calls.push({ sql, params });
    return fakePool._result;
  },
  connect: async () => { throw new Error('the stub has no clients'); },
  _result: { rows: [{ id: 1, status: 'queued' }] },
};

const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePool };

const queue = require('../src/services/compositionRenderQueue');

const last = () => calls[calls.length - 1];
const squash = (s) => s.replace(/\s+/g, ' ').trim();

beforeEach(() => { calls.length = 0; fakePool._result = { rows: [{ id: 1, status: 'queued' }] }; });

// ── the claim ────────────────────────────────────────────────────────

describe('the claim', () => {
  it('is ONE statement, so two runners cannot both read the row before either writes', async () => {
    await queue.claimNext('r');
    assert.equal(calls.length, 1, 'a SELECT then an UPDATE is two, and races');
    assert.match(last().sql, /^\s*UPDATE composition_renders/);
  });

  it('uses FOR UPDATE SKIP LOCKED', async () => {
    // Without SKIP LOCKED, plain FOR UPDATE makes the second runner block on
    // the first's lock until it commits, which serialises every instance and
    // turns a thirty-item batch into a queue of waiting transactions.
    await queue.claimNext('r');
    assert.match(
      squash(last().sql), /FOR UPDATE SKIP LOCKED/,
      'the claim must skip a locked row, not wait for it'
    );
  });

  it('takes the OLDEST queued render', async () => {
    await queue.claimNext('r');
    const sql = squash(last().sql);
    assert.match(sql, /WHERE status = 'queued'/);
    assert.match(
      sql, /ORDER BY created_at, id LIMIT 1/,
      "oldest first, so one client's thirty cannot jump another client's one"
    );
  });

  it('counts the attempt and records who holds it', async () => {
    await queue.claimNext('runner-7');
    assert.match(squash(last().sql), /attempts\s*=\s*attempts \+ 1/);
    assert.match(squash(last().sql), /claimed_by\s*=\s*\$1/);
    assert.deepEqual(last().params, ['runner-7']);
  });

  it('shares its statement with the test that proves the race', async () => {
    // A copy of the SQL in that test would keep SKIP LOCKED after somebody
    // deleted it here, and the race test would go on passing while two
    // runners rendered one row.
    assert.ok(queue.CLAIM_SQL, 'the statement is exported');
    await queue.claimNext('r');
    assert.equal(last().sql, queue.CLAIM_SQL, 'and it is the one claimNext runs');
  });

  it('returns null rather than undefined when there is nothing to take', async () => {
    fakePool._result = { rows: [] };
    assert.equal(await queue.claimNext('r'), null);
  });
});

// ── the reaper ───────────────────────────────────────────────────────

describe('the reaper', () => {
  it('only looks at rows that are rendering and claimed before the lease', async () => {
    await queue.reapStale({ leaseMs: 60_000 });
    const sql = squash(last().sql);
    assert.match(sql, /WHERE status = 'rendering'/);
    assert.match(sql, /claimed_at < now\(\) - \(\$1 \|\| ' seconds'\)::interval/);
    assert.deepEqual(last().params, ['60', queue.MAX_ATTEMPTS]);
  });

  it('requeues a row with attempts left and FAILS one without', async () => {
    // Both halves matter. Without the requeue a dead runner strands the row
    // for ever, which is what every other queue here does. Without the fail,
    // a composition that kills whatever claims it loops until it has eaten
    // the queue.
    await queue.reapStale();
    const sql = squash(last().sql);
    assert.match(sql, /status = CASE WHEN attempts < \$2 THEN 'queued' ELSE 'failed' END/);
  });

  it('clears the dead claim, or the row is invisible to the next claim', async () => {
    await queue.reapStale();
    assert.match(squash(last().sql), /claimed_at = NULL, claimed_by = NULL/);
  });

  it('defaults to a lease of fifteen minutes', async () => {
    await queue.reapStale();
    assert.equal(queue.LEASE_MS, 15 * 60 * 1000);
    assert.deepEqual(last().params, [String(15 * 60), queue.MAX_ATTEMPTS]);
  });
});

// ── a restart ────────────────────────────────────────────────────────

describe('releasing claims at startup', () => {
  it('is scoped to one worker, so a second instance keeps its live renders', async () => {
    await queue.releaseClaimsBy('app-1');
    assert.match(squash(last().sql), /status = 'rendering' AND claimed_by = \$1/);
    assert.deepEqual(last().params, ['app-1', queue.MAX_ATTEMPTS]);
  });

  it('resets progress, because the render starts again from the beginning', async () => {
    await queue.releaseClaimsBy('app-1');
    assert.match(squash(last().sql), /progress = 0/);
  });

  it('respects the attempt ceiling too', async () => {
    // A composition that crashes the process on every boot would otherwise
    // make the app unable to start cleanly for ever.
    await queue.releaseClaimsBy('app-1');
    assert.match(squash(last().sql), /CASE WHEN attempts < \$2 THEN 'queued' ELSE 'failed' END/);
  });
});

// ── finishing ────────────────────────────────────────────────────────

describe('finishing a render', () => {
  it('completes at 100, not at whatever the last progress line said', async () => {
    await queue.complete(5, { outputPath: '/a.mp4' });
    assert.match(squash(last().sql), /status = 'done', progress = 100/);
  });

  it('releases the claim on completion, so the reaper ignores it', async () => {
    await queue.complete(5);
    assert.match(squash(last().sql), /claimed_at = NULL, claimed_by = NULL/);
  });

  it('keeps the existing output path when none is given', async () => {
    // A re-report must not blank the file that was produced.
    await queue.complete(5);
    assert.match(squash(last().sql), /output_path = COALESCE\(\$2, output_path\)/);
  });

  it('retries only when told to, and only under the ceiling', async () => {
    await queue.fail(5, 'ffmpeg refused the graph', { retry: false });
    const sql = squash(last().sql);
    assert.match(sql, /WHEN \$3::boolean AND attempts < \$4 THEN 'queued'/);
    assert.deepEqual(last().params, [5, 'ffmpeg refused the graph', false, queue.MAX_ATTEMPTS]);
  });

  it('does not stamp a retried render as finished, because it has not finished', async () => {
    await queue.fail(5, 'disk full', { retry: true });
    assert.match(
      squash(last().sql),
      /finished_at = CASE WHEN \$3::boolean AND attempts < \$4 THEN NULL ELSE now\(\) END/
    );
  });

  it('defaults to not retrying', async () => {
    await queue.fail(5, 'nope');
    assert.equal(last().params[2], false, 'a failure is final unless the caller says otherwise');
  });

  it('never leaves the error empty, so a failed row always says something', async () => {
    await queue.fail(5, null);
    assert.equal(last().params[1], 'Render failed.');
  });
});

// ── progress ─────────────────────────────────────────────────────────

describe('progress', () => {
  it('refreshes the claim in the same statement', async () => {
    // This is what makes the reaper's rule simple and true: a render
    // reporting progress is alive. A separate heartbeat could succeed while
    // the render was wedged.
    await queue.setProgress(5, 40);
    assert.match(squash(last().sql), /progress = \$2, claimed_at = now\(\)/);
  });

  it('only applies to a render that is actually rendering', async () => {
    // A late progress line must not revive a finished or failed row.
    await queue.setProgress(5, 40);
    assert.match(squash(last().sql), /WHERE id = \$1 AND status = 'rendering'/);
  });

  it('clamps and rounds before it reaches the column', async () => {
    await queue.setProgress(5, 1e9);
    assert.equal(last().params[1], 100);
    await queue.setProgress(5, -3);
    assert.equal(last().params[1], 0);
    await queue.setProgress(5, 33.7);
    assert.equal(last().params[1], 34);
    await queue.setProgress(5, 'nonsense');
    assert.equal(last().params[1], 0, 'and a non-number is zero, not NaN');
  });
});

// ── watching ─────────────────────────────────────────────────────────

describe('watching', () => {
  it('breaks the created_at tie on id, so the latest render is deterministic', async () => {
    // created_at defaults to now(), which is transaction-start time, so two
    // rows written in one transaction share it exactly and the winner was
    // whichever the planner happened to return. That is how a re-run could
    // resolve to the attempt before it.
    await queue.latestFor(9);
    assert.match(squash(last().sql), /ORDER BY created_at DESC, id DESC LIMIT 1/);
  });

  it('reads one render by its own id, which is how a batch watches an item', async () => {
    await queue.get(77);
    assert.match(squash(last().sql), /WHERE id = \$1/);
    assert.deepEqual(last().params, [77]);
  });

  it('counts only waiting and running work in the depth', async () => {
    fakePool._result = { rows: [{ status: 'queued', n: 4 }] };
    const d = await queue.depth();
    assert.match(squash(last().sql), /status IN \('queued', 'rendering'\)/);
    assert.deepEqual(d, { queued: 4, rendering: 0 }, 'and names both, even at zero');
  });
});

// ── a pre-flight failure is a row ────────────────────────────────────

describe('a render that never started', () => {
  it('is still recorded, rather than being a 400 with nothing behind it', async () => {
    // The route used to answer 400 for a missing asset or an unresolvable
    // caption BEFORE creating a row. For one interactive export that is fine.
    // For a batch it is the worst shape there is: the failed items simply do
    // not exist, so a runner watching the table sees twenty-six rows and no
    // record of what happened to the other four.
    await queue.recordPreflightFailure(12, 'Source "s1" has no file on disk.');
    const sql = squash(last().sql);
    assert.match(sql, /INSERT INTO composition_renders/);
    assert.match(sql, /'failed'/);
    assert.deepEqual(last().params, [12, 'Source "s1" has no file on disk.']);
  });

  it('always carries a reason', async () => {
    await queue.recordPreflightFailure(12, null);
    assert.equal(last().params[1], 'Render could not start.');
  });
});

// ── the shape of the service ─────────────────────────────────────────

describe('the service', () => {
  it('parameterises every value it is given', async () => {
    // updateRenderJob in the route it replaces built `${k} = $${i}` from
    // caller-supplied object keys with no whitelist, so a key derived from
    // batch input would be interpolated into the UPDATE. Nothing here takes
    // a column name from a caller.
    await queue.enqueue(1);
    await queue.setProgress(1, 2);
    await queue.complete(1, { outputPath: 'x' });
    await queue.fail(1, 'y');
    await queue.reapStale();
    await queue.releaseClaimsBy('w');
    for (const c of calls) {
      assert.ok(
        !/\$\{/.test(c.sql),
        `interpolation left in a statement: ${squash(c.sql).slice(0, 80)}`
      );
    }
  });

  it('knows nothing about ffmpeg', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'compositionRenderQueue.js'), 'utf8'
    );
    // Comments stripped first. The claim is about what the code does, and the
    // comments necessarily name ffmpeg to explain why the queue does not
    // touch it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(
      !/ffmpeg|spawn|execFile|child_process/.test(code),
      'the queue owns the queue. What to render lives in one other place:\n'
      + (code.match(/.*(ffmpeg|spawn|execFile|child_process).*/g) || []).join('\n')
    );
  });
});
