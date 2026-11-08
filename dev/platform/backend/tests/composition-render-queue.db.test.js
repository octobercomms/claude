/**
 * The composition render queue, against a real Postgres.
 *
 * Every claim this service makes is a SQL claim, and the important ones cannot
 * be checked without a database. That two runners racing for the same row
 * cannot both get it is a property of `FOR UPDATE SKIP LOCKED` under real
 * concurrency, not of the string the query is written in; a stubbed pool would
 * pass whatever the code asked for.
 *
 * What was here before was two module-level variables in routes/compose.js
 * holding start closures. The four faults this file exists to prove are gone:
 *
 *   1. pending work died with the process and its rows stayed 'queued' for
 *      ever, with nothing anywhere that selected them to resume;
 *   2. a render interrupted mid-flight stranded its row at 'rendering'
 *      permanently, because no queue in this repo has a reaper;
 *   3. the slot was per process, so two instances could render one row twice;
 *   4. a job could not be watched by its own id, so a re-run made the attempt
 *      before it unobservable.
 *
 *   DB_HOST=/tmp DB_PORT=55434 DB_NAME=omi DB_USER=postgres \
 *     node tests/composition-render-queue.db.test.js
 */

const pool = require('../src/db');
const queue = require('../src/services/compositionRenderQueue');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label); failures += 1; }
};
const eq = (got, want, label) => ok(
  got === want, `${label}${got === want ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`
);

const CLIENT = '33333333-3333-4333-8333-333333333333';

async function reset() {
  // clients.slug is NOT NULL, which every fixture here has to supply.
  await pool.query(
    `INSERT INTO clients (id, name, slug) VALUES ($1, 'Queue Fixture', 'queue-fixture')
     ON CONFLICT (id) DO NOTHING`,
    [CLIENT]
  );
  await pool.query('DELETE FROM composition_renders WHERE composition_id IN (SELECT id FROM compositions WHERE client_id = $1)', [CLIENT]);
  await pool.query('DELETE FROM compositions WHERE client_id = $1', [CLIENT]);
}

async function makeComposition(title) {
  const { rows } = await pool.query(
    `INSERT INTO compositions (client_id, title, data)
     VALUES ($1, $2, '{"version":1}'::jsonb) RETURNING id`,
    [CLIENT, title]
  );
  return rows[0].id;
}

async function statusOf(id) {
  const { rows } = await pool.query('SELECT status, attempts, claimed_by, error, progress FROM composition_renders WHERE id = $1', [id]);
  return rows[0];
}

async function run() {
  await reset();

  // ── enqueue and claim ──────────────────────────────────────────────
  console.log('\nenqueue and claim');
  {
    const comp = await makeComposition('first');
    const job = await queue.enqueue(comp);
    eq(job.status, 'queued', 'a new render is queued');
    eq(job.attempts, 0, 'and has not been attempted');
    ok(job.id > 0, 'and has an id of its own, which is how a batch watches it');

    const claimed = await queue.claimNext('runner-a');
    eq(claimed.id, job.id, 'the claim returns that row');
    eq(claimed.status, 'rendering', 'and marks it rendering');
    eq(claimed.claimed_by, 'runner-a', 'and records who holds it');
    eq(claimed.attempts, 1, 'and counts the attempt');
    ok(claimed.started_at != null, 'and stamps when it started');

    eq(await queue.claimNext('runner-b'), null, 'a second runner finds nothing to take');
  }

  // ── the race ───────────────────────────────────────────────────────
  console.log('\ntwo runners racing for one row');
  {
    await reset();
    const comp = await makeComposition('contested');
    const job = await queue.enqueue(comp);

    // Both inside real transactions, overlapping, which is the only way to
    // show SKIP LOCKED doing its job. A SELECT-then-UPDATE would give both
    // clients the row here and render it twice.
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      // The service's OWN statement, not a copy of it. A copy would keep
      // SKIP LOCKED after somebody deleted it from the service, and this
      // test would go on passing while two runners rendered one row.
      const ra = await a.query(queue.CLAIM_SQL, ['runner-a']);

      // A short timeout on the second runner, so losing SKIP LOCKED reports
      // itself instead of hanging. Plain FOR UPDATE makes this statement
      // block on the first transaction's lock until it commits, and a test
      // that hangs is a worse signal than one that fails.
      await b.query("SET LOCAL statement_timeout = '3s'");
      let rb = null;
      let blocked = false;
      try {
        rb = await b.query(queue.CLAIM_SQL, ['runner-b']);
      } catch (err) {
        blocked = /statement timeout|canceling statement/i.test(err.message);
        if (!blocked) throw err;
      }
      await a.query('COMMIT');
      try { await b.query('COMMIT'); } catch { await b.query('ROLLBACK'); }

      eq(ra.rows.length, 1, 'the first runner takes the row');
      ok(
        !blocked,
        'the second runner skips past rather than blocking on the lock'
          + (blocked ? ' — FOR UPDATE without SKIP LOCKED serialises every runner' : '')
      );
      eq(rb ? rb.rows.length : -1, 0, 'and gets nothing rather than the same row');
      const after = await statusOf(job.id);
      eq(after.attempts, 1, 'so the row was attempted once, not twice');
    } finally {
      a.release();
      b.release();
    }
  }

  // ── order ──────────────────────────────────────────────────────────
  console.log('\norder');
  {
    await reset();
    const ids = [];
    for (const n of [1, 2, 3]) ids.push((await queue.enqueue(await makeComposition(`ord-${n}`))).id);
    const got = [];
    for (let i = 0; i < 3; i += 1) got.push((await queue.claimNext('r')).id);
    eq(
      JSON.stringify(got), JSON.stringify(ids),
      'oldest first, so a batch runs in the order it was submitted'
    );
  }

  // ── progress refreshes the lease ───────────────────────────────────
  console.log('\nprogress');
  {
    await reset();
    const job = await queue.enqueue(await makeComposition('prog'));
    await queue.claimNext('runner-a');
    const p = await queue.setProgress(job.id, 42);
    eq(p.progress, 42, 'progress is recorded');

    eq((await queue.setProgress(job.id, 1e9)).progress, 100, 'and clamped above');
    eq((await queue.setProgress(job.id, -5)).progress, 0, 'and clamped below');
    eq((await queue.setProgress(job.id, 33.7)).progress, 34, 'and rounded');

    await queue.complete(job.id, { outputPath: '/tmp/x.mp4' });
    eq(
      await queue.setProgress(job.id, 50), null,
      'progress on a finished render changes nothing, rather than reviving it'
    );
    eq((await statusOf(job.id)).status, 'done', 'it is still done');
  }

  // ── complete ───────────────────────────────────────────────────────
  console.log('\ncomplete');
  {
    await reset();
    const job = await queue.enqueue(await makeComposition('comp'));
    await queue.claimNext('runner-a');
    const done = await queue.complete(job.id, { outputPath: '/out/a.mp4', outputUrl: '/u/a.mp4' });
    eq(done.status, 'done', 'done');
    eq(done.progress, 100, 'at 100, not at whatever the last progress line said');
    eq(done.output_path, '/out/a.mp4', 'with its file');
    eq(done.claimed_by, null, 'and the claim released, so the reaper ignores it');
    ok(done.finished_at != null, 'and stamped');
  }

  // ── fail, with and without a retry ─────────────────────────────────
  console.log('\nfail');
  {
    await reset();
    const hard = await queue.enqueue(await makeComposition('hard'));
    await queue.claimNext('runner-a');
    const f = await queue.fail(hard.id, 'ffmpeg refused the graph', { retry: false });
    eq(f.status, 'failed', 'a failure no retry can fix is simply failed');
    eq(f.error, 'ffmpeg refused the graph', 'with the reason on the row');
    eq(await queue.claimNext('runner-b'), null, 'and it is not offered again');

    const soft = await queue.enqueue(await makeComposition('soft'));
    await queue.claimNext('runner-a');
    const r = await queue.fail(soft.id, 'the box ran out of disk', { retry: true });
    eq(r.status, 'queued', 'a retryable failure goes back to the queue');
    eq(r.finished_at, null, 'and is not stamped finished, because it has not finished');
    ok((await queue.claimNext('runner-b'))?.id === soft.id, 'so another runner can take it');
  }

  // ── the retry ceiling ──────────────────────────────────────────────
  console.log('\nthe retry ceiling');
  {
    await reset();
    const job = await queue.enqueue(await makeComposition('poison'));
    // A row that kills whatever claims it must stop, or the reaper turns one
    // bad composition into an infinite loop that eats the queue.
    for (let i = 0; i < queue.MAX_ATTEMPTS; i += 1) {
      const c = await queue.claimNext(`runner-${i}`);
      ok(c != null, `attempt ${i + 1} is offered`);
      await queue.fail(job.id, 'out of memory', { retry: true });
    }
    const after = await statusOf(job.id);
    eq(after.status, 'failed', `after ${queue.MAX_ATTEMPTS} attempts it is left alone`);
    eq(await queue.claimNext('runner-x'), null, 'and never offered again');
  }

  // ── the reaper ─────────────────────────────────────────────────────
  console.log('\nthe reaper');
  {
    await reset();
    const job = await queue.enqueue(await makeComposition('abandoned'));
    await queue.claimNext('runner-gone');

    eq((await queue.reapStale({ leaseMs: 60_000 })).length, 0, 'a fresh claim is left alone');

    // Age the claim rather than waiting fifteen minutes for it.
    await pool.query("UPDATE composition_renders SET claimed_at = now() - interval '20 minutes' WHERE id = $1", [job.id]);
    const reaped = await queue.reapStale({ leaseMs: 60_000 });
    eq(reaped.length, 1, 'a claim older than the lease is taken back');
    eq(reaped[0].status, 'queued', 'and requeued, because it has attempts left');
    eq((await statusOf(job.id)).claimed_by, null, 'with the dead claim cleared');
    ok((await queue.claimNext('runner-new'))?.id === job.id, 'so somebody else can run it');

    // And the second half: a row that has used its attempts is failed, not
    // requeued, so it stops killing runners.
    await pool.query(
      "UPDATE composition_renders SET attempts = $2, claimed_at = now() - interval '20 minutes', status = 'rendering' WHERE id = $1",
      [job.id, queue.MAX_ATTEMPTS]
    );
    const again = await queue.reapStale({ leaseMs: 60_000 });
    eq(again[0].status, 'failed', 'an exhausted row is failed rather than requeued');
    ok(
      /stopped without reporting/.test((await statusOf(job.id)).error || ''),
      'and says what happened to it'
    );
  }

  // ── a restart hands work back at once ──────────────────────────────
  console.log('\na restart');
  {
    await reset();
    const mine = await queue.enqueue(await makeComposition('mine'));
    const theirs = await queue.enqueue(await makeComposition('theirs'));
    await queue.claimNext('app-1');
    await queue.claimNext('app-2');

    const released = await queue.releaseClaimsBy('app-1');
    eq(released.length, 1, 'a restarting instance hands back only its own');
    eq(released[0].id, mine.id, 'which is the one it held');
    eq((await statusOf(mine.id)).status, 'queued', 'requeued at once, not after the lease');
    eq((await statusOf(mine.id)).progress, 0, 'with progress reset, because it starts again');
    eq(
      (await statusOf(theirs.id)).status, 'rendering',
      'and the other instance\'s live render is untouched'
    );
  }

  // ── watching one job, and the queue ────────────────────────────────
  console.log('\nwatching');
  {
    await reset();
    const comp = await makeComposition('watched');
    const first = await queue.enqueue(comp);
    await queue.claimNext('r');
    await queue.fail(first.id, 'nope', { retry: false });
    const second = await queue.enqueue(comp);

    const latest = await queue.latestFor(comp);
    eq(latest.id, second.id, 'the newest render of a composition is the newest one');
    ok(
      (await queue.get(first.id))?.error === 'nope',
      'and the earlier attempt is still readable by its own id, not lost behind it'
    );

    const third = await queue.enqueue(await makeComposition('behind'));
    eq(await queue.positionOf(second.id), 1, 'the next in line is first');
    eq(await queue.positionOf(third.id), 2, 'and the one after it is second');
    await queue.claimNext('r');
    eq(await queue.positionOf(second.id), null, 'a render that is running is not in the queue');

    const d = await queue.depth();
    eq(d.rendering, 1, 'depth counts what is running');
    eq(d.queued, 1, 'and what is waiting');
  }

  // ── a pre-flight failure is a row ──────────────────────────────────
  console.log('\na pre-flight failure');
  {
    await reset();
    const comp = await makeComposition('cannot-start');
    const row = await queue.recordPreflightFailure(comp, 'Source "s1" has no file on disk.');
    eq(row.status, 'failed', 'a render that never started is still a row');
    ok(/no file on disk/.test(row.error), 'with the reason, so a batch can report it');
    ok(row.finished_at != null, 'and finished, because it is over');
    eq(await queue.claimNext('r'), null, 'and it is not in the queue');
  }

  // ── thirty of them ─────────────────────────────────────────────────
  console.log('\na batch of thirty');
  {
    await reset();
    const ids = [];
    for (let i = 0; i < 30; i += 1) ids.push((await queue.enqueue(await makeComposition(`b${i}`))).id);
    eq((await queue.depth()).queued, 30, 'thirty are waiting');

    // Run eleven, then "restart" the instance mid-twelfth. This is the exact
    // shape of the old fault: at this point the remaining nineteen used to be
    // gone, because they only existed as closures in an array.
    for (let i = 0; i < 11; i += 1) {
      const c = await queue.claimNext('app-1');
      await queue.complete(c.id, { outputPath: `/out/${c.id}.mp4` });
    }
    const twelfth = await queue.claimNext('app-1');
    await queue.setProgress(twelfth.id, 60);

    await queue.releaseClaimsBy('app-1');
    const d = await queue.depth();
    eq(d.queued, 19, 'nineteen are still waiting after the restart');
    eq(d.rendering, 0, 'and nothing is pretending to render');
    eq(
      (await statusOf(twelfth.id)).status, 'queued',
      'including the one that was interrupted, which starts again'
    );

    // Drain the rest to show nothing is stranded.
    let ran = 0;
    for (;;) {
      const c = await queue.claimNext('app-2');
      if (!c) break;
      await queue.complete(c.id, { outputPath: `/out/${c.id}.mp4` });
      ran += 1;
    }
    eq(ran, 19, 'all nineteen run on the next instance');
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM composition_renders
        WHERE composition_id IN (SELECT id FROM compositions WHERE client_id = $1)
          AND status = 'done'`, [CLIENT]
    );
    eq(rows[0].n, 30, 'and all thirty finished');
  }

  await reset();
  console.log(failures ? `\n${failures} failing` : '\nall queue assertions pass');
  await pool.end();
  process.exit(failures ? 1 : 0);
}

run().catch((err) => {
  console.error('\nthrew:', err.message);
  console.error(err.stack);
  process.exit(1);
});
