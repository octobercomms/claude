/**
 * The composition render queue, in the database rather than in a variable.
 *
 * What was here before was not a queue. `routes/compose.js` held two
 * module-level variables, `_activeRender` and `_renderQueue`, and pushed start
 * closures onto the array. That arrangement has four properties that make a
 * batch of thirty impossible:
 *
 *   - **It does not survive a restart.** The closures are in memory. pm2
 *     restarts this process on 1GB, and a deploy restarts it on purpose, at
 *     which point every pending render is gone while its row still reads
 *     'queued'. Nothing anywhere selected 'queued' rows to resume them, so
 *     those rows stayed queued for ever and /render-status kept saying so.
 *   - **It does not survive a crash mid-render.** A row left at 'rendering'
 *     was stranded permanently. That is true of every other queue in this
 *     repo too: none of them has a reaper.
 *   - **It is one slot per process, not per machine.** Two Node instances
 *     behind a load balancer each hold their own slot and neither knows about
 *     the other, so the same row could be rendered twice.
 *   - **It cannot be watched per job.** The route returned no job id and
 *     /render-status read the newest row for a composition, so a re-run made
 *     the earlier attempt unobservable.
 *
 * This replaces it with the pattern the repo already runs in production:
 * `FOR UPDATE SKIP LOCKED`, the same claim `video_jobs` uses (migration 090)
 * to feed the worker box. The claim is a single statement, so two runners
 * racing for the same row cannot both get it — one takes it and the other
 * skips past to the next, which is the whole point of SKIP LOCKED and the
 * reason this is not done with a SELECT followed by an UPDATE.
 *
 * Nothing here spawns ffmpeg or knows what a render is. It owns the queue and
 * only the queue, so it can be tested against a real Postgres without a video
 * anywhere near it, and so the thing that decides WHAT to render stays in one
 * place.
 */

const pool = require('../db');

/** How long a claim may go unrefreshed before the reaper takes the row back. */
const LEASE_MS = 15 * 60 * 1000;

/**
 * How many times a row may be claimed before it is left alone.
 *
 * Three, not one: a render killed by a deploy deserves another go, and a
 * render killed by a 400-frame composition that exhausts memory will kill the
 * next runner too. Without a ceiling that second case is an infinite loop
 * that eats the queue, which is the failure a reaper introduces if it has no
 * limit.
 */
const MAX_ATTEMPTS = 3;

const COLS = `id, composition_id, status, progress, output_path, output_url, error,
              started_at, finished_at, created_at, updated_at,
              claimed_at, claimed_by, attempts, qc, qc_verdict, qc_rank`;

/** Add a render to the queue. Returns the row, whose id is how it is watched. */
async function enqueue(compositionId) {
  const { rows } = await pool.query(
    `INSERT INTO composition_renders (composition_id, status)
     VALUES ($1, 'queued')
     RETURNING ${COLS}`,
    [compositionId]
  );
  return rows[0];
}

/**
 * Record a render that failed before it ever reached the queue.
 *
 * The route used to answer 400 for a missing asset, an unresolvable caption or
 * an empty graph, all BEFORE it created a row. For one interactive export that
 * is fine: the person sees the error. For a batch it is the worst possible
 * shape, because the failed items simply do not exist — a runner that posts
 * thirty requests and then watches the table sees twenty-six rows and has no
 * record of what happened to the other four or why.
 *
 * So a pre-flight failure is a row too, already failed, with the reason in it.
 */
async function recordPreflightFailure(compositionId, error) {
  const { rows } = await pool.query(
    `INSERT INTO composition_renders
       (composition_id, status, error, started_at, finished_at)
     VALUES ($1, 'failed', $2, now(), now())
     RETURNING ${COLS}`,
    [compositionId, String(error || 'Render could not start.')]
  );
  return rows[0];
}

/**
 * Take the oldest queued render, atomically.
 *
 * One statement. A SELECT followed by an UPDATE would let two runners read the
 * same row before either wrote, and both would render it. SKIP LOCKED makes
 * the second runner step over the row the first is holding and take the next
 * one instead, which is why this is also safe across machines rather than only
 * within one process.
 *
 * Oldest first, by `created_at`, so a batch runs in the order it was submitted
 * and nobody's thirty jumps somebody else's one.
 *
 * Exported as a constant because the test that proves the race needs two
 * overlapping transactions, which means two pool clients rather than this
 * function. A copy of the statement in the test would pass whatever the
 * service did: delete SKIP LOCKED here and the test's own copy would still
 * have it. One statement, both callers.
 */
const CLAIM_SQL = `
  UPDATE composition_renders SET
    status     = 'rendering',
    claimed_at = now(),
    claimed_by = $1,
    attempts   = attempts + 1,
    started_at = COALESCE(started_at, now()),
    updated_at = now()
  WHERE id = (
    SELECT id FROM composition_renders
     WHERE status = 'queued'
     ORDER BY created_at, id
     LIMIT 1
     FOR UPDATE SKIP LOCKED
  )
  RETURNING ${COLS}`;

async function claimNext(worker = 'app') {
  const { rows } = await pool.query(CLAIM_SQL, [worker]);
  return rows[0] || null;
}

/**
 * Progress, and the lease refresh in the same statement.
 *
 * Refreshing the claim here rather than in a separate heartbeat is what makes
 * the reaper's rule simple and true: a render that is reporting progress is
 * alive, and one that has reported nothing for the lease is not. A render that
 * genuinely takes longer than the lease without a single progress line would
 * be reaped, which is why ffmpeg's progress is wired to this and not merely
 * logged.
 */
async function setProgress(id, progress) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
  const { rows } = await pool.query(
    `UPDATE composition_renders
        SET progress = $2, claimed_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'rendering'
      RETURNING ${COLS}`,
    [id, pct]
  );
  return rows[0] || null;
}

/**
 * Finish a render, with the QC report if one was taken.
 *
 * The report is stored in the same statement as the completion rather than in
 * a follow-up update, so there is no window in which a render reads as done
 * with no verdict — which is the state the review sheet would have to show as
 * "finished, quality unknown" for no reason other than two round trips.
 */
async function complete(id, { outputPath = null, outputUrl = null, qc = null } = {}) {
  const { rows } = await pool.query(
    `UPDATE composition_renders SET
       status = 'done', progress = 100,
       output_path = COALESCE($2, output_path),
       output_url  = COALESCE($3, output_url),
       qc         = COALESCE($4::jsonb, qc),
       qc_verdict = COALESCE($5, qc_verdict),
       qc_rank    = COALESCE($6, qc_rank),
       claimed_at = NULL, claimed_by = NULL,
       finished_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING ${COLS}`,
    [
      id, outputPath, outputUrl,
      qc ? JSON.stringify(qc) : null,
      qc?.verdict ?? null,
      Number.isFinite(qc?.rank) ? qc.rank : null,
    ]
  );
  return rows[0] || null;
}

/**
 * Fail a render, and decide whether it gets another go.
 *
 * `retry` false is for a failure no retry can fix: ffmpeg refused the graph,
 * the composition has no sources, the asset is missing from disk. Running it
 * again wastes a slot and tells nobody anything new. `retry` true is for a
 * failure that might have been circumstance, and even then only until
 * MAX_ATTEMPTS.
 */
async function fail(id, error, { retry = false } = {}) {
  const { rows } = await pool.query(
    `UPDATE composition_renders SET
       status = CASE
         WHEN $3::boolean AND attempts < $4 THEN 'queued'
         ELSE 'failed'
       END,
       error = $2,
       claimed_at = NULL, claimed_by = NULL,
       finished_at = CASE
         WHEN $3::boolean AND attempts < $4 THEN NULL
         ELSE now()
       END,
       updated_at = now()
     WHERE id = $1
     RETURNING ${COLS}`,
    [id, String(error || 'Render failed.'), retry, MAX_ATTEMPTS]
  );
  return rows[0] || null;
}

/**
 * Take back rows whose runner is gone.
 *
 * Two cases, and the difference is the attempt count rather than the symptom.
 * A row claimed longer ago than the lease with attempts left goes back to
 * 'queued' for somebody else. One that has used its attempts is marked failed
 * with a reason that says what happened, because a row that kills whatever
 * claims it must not keep killing runners.
 *
 * Returns what it did, so a caller can log it. Silence here would make a
 * recovering queue indistinguishable from a stuck one.
 */
async function reapStale({ leaseMs = LEASE_MS } = {}) {
  const seconds = Math.max(1, Math.round(leaseMs / 1000));
  const { rows } = await pool.query(
    `UPDATE composition_renders SET
       status = CASE WHEN attempts < $2 THEN 'queued' ELSE 'failed' END,
       error = CASE
         WHEN attempts < $2 THEN NULL
         ELSE 'The renderer stopped without reporting, ' || attempts ||
              ' times. Left alone rather than retried again.'
       END,
       claimed_at = NULL, claimed_by = NULL,
       finished_at = CASE WHEN attempts < $2 THEN NULL ELSE now() END,
       updated_at = now()
     WHERE status = 'rendering'
       AND claimed_at < now() - ($1 || ' seconds')::interval
     RETURNING id, composition_id, attempts, status`,
    [String(seconds), MAX_ATTEMPTS]
  );
  return rows;
}

/**
 * At startup, hand back anything this instance was holding.
 *
 * A restart is the common case, not the rare one: pm2 restarts on memory and a
 * deploy restarts deliberately. Those rows are at 'rendering' with a claim
 * naming a process that no longer exists, and waiting out the lease would
 * leave a batch stalled for a quarter of an hour for no reason. Scoped to this
 * worker's own name so a second instance's live renders are untouched.
 */
async function releaseClaimsBy(worker) {
  const { rows } = await pool.query(
    `UPDATE composition_renders SET
       status = CASE WHEN attempts < $2 THEN 'queued' ELSE 'failed' END,
       error = CASE
         WHEN attempts < $2 THEN NULL
         ELSE 'The renderer restarted ' || attempts || ' times during this render.'
       END,
       claimed_at = NULL, claimed_by = NULL, progress = 0,
       finished_at = CASE WHEN attempts < $2 THEN NULL ELSE now() END,
       updated_at = now()
     WHERE status = 'rendering' AND claimed_by = $1
     RETURNING id, composition_id, attempts, status`,
    [worker, MAX_ATTEMPTS]
  );
  return rows;
}

/** One render by its own id, which is how a batch watches its items. */
async function get(id) {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM composition_renders WHERE id = $1`, [id]
  );
  return rows[0] || null;
}

/**
 * The newest render of a composition.
 *
 * Ordered by id as well as created_at. `created_at` defaults to now(), which
 * is transaction-start time, so two rows inserted in one transaction share it
 * exactly and the winner was whichever the planner returned. That is how a
 * re-run could resolve to the attempt before it.
 */
async function latestFor(compositionId) {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM composition_renders
      WHERE composition_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [compositionId]
  );
  return rows[0] || null;
}

/** Where a render sits in the queue, counting from 1, or null if it is not waiting. */
async function positionOf(id) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int + 1 AS position
       FROM composition_renders q
      WHERE q.status = 'queued'
        AND (q.created_at, q.id) < (
          SELECT r.created_at, r.id FROM composition_renders r WHERE r.id = $1
        )`,
    [id]
  );
  const row = await get(id);
  if (!row || row.status !== 'queued') return null;
  return rows[0]?.position ?? null;
}

/**
 * The finished renders of a composition, newest first.
 *
 * Here rather than in the route, because `composition-render-route.test.js`
 * holds the rule that one place owns every statement against this table —
 * written after `updateRenderJob` interpolated caller-supplied object keys
 * straight into column positions. A SELECT is harmless on its own; a second
 * file that has learned to query this table is how the next one stops being.
 *
 * Done and with a file, because every caller wants the same thing: a render
 * you can play. The share dialog and the public approval page both filter
 * this way, and three places deciding separately what "finished" means is how
 * a client is offered a card with nothing behind it.
 */
async function doneFor(compositionId, { limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, composition_id, finished_at, output_url
       FROM composition_renders
      WHERE composition_id = $1 AND status = 'done' AND output_url IS NOT NULL
      ORDER BY finished_at DESC NULLS LAST, id DESC
      LIMIT $2`,
    [compositionId, limit]
  );
  return rows;
}

/**
 * Of these render ids, the ones that are finished AND belong to this client.
 *
 * Both halves in one query on purpose. The caller is minting a public share
 * link, and `requireClientAccess` has only checked the client in the request
 * path: it says nothing about ids in the body, and the public view that
 * serves the link deliberately trusts the link. So this is the only place the
 * tenancy of a shared render is established, and splitting it into "is it
 * done" and "is it theirs" invites one of the two to be dropped.
 */
async function doneByIdsForClient(ids, clientId) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const { rows } = await pool.query(
    `SELECT r.id, r.composition_id, r.finished_at, r.output_url, c.title
       FROM composition_renders r
       JOIN compositions c ON c.id = r.composition_id
      WHERE r.id = ANY($1) AND c.client_id = $2
        AND r.status = 'done' AND r.output_url IS NOT NULL
      ORDER BY r.finished_at ASC NULLS LAST, r.id ASC`,
    [ids, clientId]
  );
  return rows;
}

/** How many renders are waiting or running, for a status line. */
async function depth() {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS n
       FROM composition_renders
      WHERE status IN ('queued', 'rendering')
      GROUP BY status`
  );
  const out = { queued: 0, rendering: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

module.exports = {
  CLAIM_SQL,
  doneFor,
  doneByIdsForClient,
  enqueue,
  recordPreflightFailure,
  claimNext,
  setProgress,
  complete,
  fail,
  reapStale,
  releaseClaimsBy,
  get,
  latestFor,
  positionOf,
  depth,
  LEASE_MS,
  MAX_ATTEMPTS,
};
