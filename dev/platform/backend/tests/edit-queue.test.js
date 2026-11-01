/**
 * Guards on render progress, cancellation and queue concurrency.
 *
 * A spinner is an honest answer for a twenty-second trim and a useless one for
 * a five-minute timeline render: it cannot tell a render that is nearly done
 * from one that has hung. These check the three things that make the
 * difference believable — that the number only moves forward, that Stop
 * actually stops, and that a stopped render is never reported as a failure.
 *
 * The parts that need a database are checked by reading the SQL, because the
 * scoping is the subtle bit and CI has no Postgres.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const proc = require('../src/services/editProcessor');
const PROC_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'editProcessor.js'), 'utf8');
const JOBS_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'editJobs.js'), 'utf8');
const ROUTE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'edit.js'), 'utf8');
const MIG = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '228_edit_job_progress.sql'), 'utf8');

// ---- the percentage ----------------------------------------------------

test('the phases tile 0 to 100 with no gap and no overlap', () => {
  // A gap makes the bar jump forward between passes; an overlap makes it jump
  // backwards, which reads as a render that has restarted.
  const order = ['assemble', 'render', 'captions'];
  let prev = 0;
  for (const phase of order) {
    const [from, to] = proc.PHASES[phase];
    assert.equal(from, prev, `${phase} starts at ${from}, but the phase before ended at ${prev}`);
    assert.ok(to > from, `${phase} has no room`);
    prev = to;
  }
  assert.equal(prev, 100, 'the last phase must finish at 100');
});

test('progress only ever goes forward', () => {
  const steps = [];
  for (const phase of ['assemble', 'render', 'captions']) {
    for (const f of [0, 0.25, 0.5, 0.75, 1]) steps.push(proc.phasePercent(phase, f));
  }
  for (let i = 1; i < steps.length; i++) {
    assert.ok(steps[i] >= steps[i - 1],
      `progress went backwards: ${steps[i - 1]} then ${steps[i]} (${steps.join(',')})`);
  }
  assert.equal(steps[0], 0);
  assert.equal(steps[steps.length - 1], 100);
});

test('a fraction outside 0 to 1 is clamped, not drawn off the end', () => {
  assert.equal(proc.phasePercent('render', 5), 90);
  assert.equal(proc.phasePercent('render', -3), 55);
  assert.equal(proc.phasePercent('render', NaN), 55);
  assert.equal(proc.phasePercent('render', null), 55);
  assert.equal(proc.phasePercent('render', 'half'), 55);
  // Infinity is not a fraction, so it reads as "no information yet" and the
  // phase starts at its floor, the same as NaN. Clamping it to 1 would claim a
  // pass had finished on the strength of a bad number.
  assert.equal(proc.phasePercent('render', Infinity), 55);
  assert.equal(proc.phasePercent('render', -Infinity), 55);
});

test('an unknown phase spans the whole bar rather than throwing', () => {
  assert.equal(proc.phasePercent('nonsense', 0), 0);
  assert.equal(proc.phasePercent('nonsense', 1), 100);
  assert.equal(proc.phasePercent(undefined, 0.5), 50);
});

test('assembling gets the largest share, because it is the slowest part', () => {
  // Every block is re-encoded before the concat, so on a timeline render this
  // is where the minutes go. A bar that gave it 10% would sit at 10% for most
  // of the render, which is the problem this work exists to fix.
  const span = (p) => proc.PHASES[p][1] - proc.PHASES[p][0];
  assert.ok(span('assemble') >= span('render'),
    `assemble has ${span('assemble')} points, render has ${span('render')}`);
  assert.ok(span('assemble') >= 40, 'assembling needs room to move');
  assert.ok(span('captions') <= 15,
    'captions are one network call with no progress of their own');
});

// ---- cancellation ------------------------------------------------------

test('cancelling a job with nothing running still records the ask', () => {
  // The flag matters even with no live process: the renderer checks it between
  // passes, so a job caught between two ffmpeg invocations still stops.
  const id = 'job-not-running';
  assert.equal(proc.isCancelled(id), false);
  assert.equal(proc.cancel(id), false, 'nothing was killed');
  assert.equal(proc.isCancelled(id), true, 'but the ask is remembered');
});

test('the renderer checks for cancellation between passes, not only at the start', () => {
  const checks = (PROC_SRC.match(/isCancelled\(jobId\)/g) || []).length;
  assert.ok(checks >= 4,
    `only ${checks} between-pass cancellation checks; killing the current ffmpeg is not `
    + `enough on its own, because the loop starts the next cut a millisecond later`);
  // Each assembly pass has one, and so does the render pass.
  for (const fn of ['cutEdl', 'combineClips', 'cutSegments']) {
    const body = PROC_SRC.slice(PROC_SRC.indexOf(`async function ${fn}(`));
    assert.match(body.slice(0, 2800), /isCancelled\(jobId\)/,
      `${fn} must stop between its cuts`);
  }
});

test('a killed render is a cancellation, never a failure', () => {
  // ffmpeg exits non-zero when killed. Without this the operator who pressed
  // Stop is told their edit broke.
  assert.match(PROC_SRC, /signal === 'SIGKILL' && isCancelled\(jobId\)/);
  assert.match(PROC_SRC, /class Cancelled extends Error/);
  const catchBlock = PROC_SRC.slice(PROC_SRC.indexOf('  } catch (err) {', PROC_SRC.indexOf('async function processOne')));
  assert.match(catchBlock.slice(0, 700), /err instanceof Cancelled \|\| isCancelled\(job\.id\)/,
    'processOne must classify a cancellation before it calls fail()');
  assert.ok(catchBlock.indexOf('markCancelled') < catchBlock.indexOf('editJobs.fail'),
    'the cancellation branch must come first');
});

test('SIGKILL, not SIGTERM', () => {
  // ffmpeg handles SIGTERM by finalising the output, which on a long render
  // makes Stop appear to do nothing for several seconds. The output is thrown
  // away either way.
  assert.match(PROC_SRC, /kill\('SIGKILL'\)/);
  assert.doesNotMatch(PROC_SRC, /kill\('SIGTERM'\)/);
});

test('every path that completes a job checks for a cancellation first', () => {
  // There are two: the ordinary render and the stills reel, which returns
  // early. A path without its own check is a path where Stop is ignored and
  // an edit nobody wanted appears in the client asset library.
  const body = PROC_SRC.slice(PROC_SRC.indexOf('async function processOne'));
  const completes = [...body.matchAll(/editJobs\.complete\(job\.id/g)].map(m => m.index);
  assert.ok(completes.length >= 2, `expected both completion paths, found ${completes.length}`);
  for (const at of completes) {
    const guard = body.lastIndexOf('isCancelled(job.id)', at);
    assert.ok(guard > 0 && guard < at,
      `a completion at offset ${at} has no cancellation check before it`);
    // And the check has to be close by, not one from a previous pass hundreds
    // of lines earlier.
    assert.ok(at - guard < 900,
      `the nearest cancellation check is ${at - guard} characters before this `
      + `completion, which is too far to be guarding it`);
  }
});

test('the cancel flag is cleared when the job leaves processing', () => {
  // Otherwise a retry of the same row is cancelled before it starts.
  assert.match(PROC_SRC, /function clearCancel/);
  const fin = PROC_SRC.slice(PROC_SRC.indexOf('  } finally {', PROC_SRC.indexOf('async function processOne')));
  assert.match(fin.slice(0, 300), /clearCancel\(job\.id\)/);
});

// ---- the queue ---------------------------------------------------------

test('more than one edit renders at once', () => {
  assert.ok(proc.MAX_WORKERS >= 2,
    'with one worker a twenty-second trim waits behind a five-minute timeline render');
  assert.ok(proc.MAX_WORKERS <= 4,
    'ffmpeg already uses several cores, and the box also serves the app');
});

test('the worker count is bounded whatever the environment says', () => {
  const m = /const MAX_WORKERS = ([^;]+);/.exec(PROC_SRC);
  assert.ok(m, 'MAX_WORKERS must be computed, not pasted');
  assert.match(m[1], /Math\.max\(1,/, 'zero workers would drain nothing');
  assert.match(m[1], /Math\.min\(4,/, 'an unbounded env var would thrash the box');
});

test('each worker claims its own row', () => {
  assert.match(JOBS_SRC, /FOR UPDATE SKIP LOCKED/,
    'two workers must never claim the same job, even across processes');
  assert.match(PROC_SRC, /_workers \+= 1/);
  assert.match(PROC_SRC, /_workers -= 1/);
  const w = PROC_SRC.slice(PROC_SRC.indexOf('async function worker()'));
  assert.match(w.slice(0, 600), /finally \{\s*_workers -= 1;/,
    'a worker that throws must still give its slot back, or the queue stops draining');
});

// ---- the writes --------------------------------------------------------

test('progress and failure writes cannot revive a stopped job', () => {
  for (const fn of ['setProgress', 'fail']) {
    const body = JOBS_SRC.slice(JOBS_SRC.indexOf(`async function ${fn}(`));
    assert.match(body.slice(0, 700), /status = 'processing'/,
      `${fn} must be scoped to a processing job: a write arriving after a cancel, `
      + `from a callback already in flight, must not overwrite the cancellation`);
  }
});

test('a cancelled edit can be run again', () => {
  // Without this, Stop strands the edit and becomes a button nobody presses.
  const body = JOBS_SRC.slice(JOBS_SRC.indexOf('async function retry('));
  assert.match(body.slice(0, 700), /IN \('failed', 'cancelled'\)/);
  assert.match(body.slice(0, 700), /progress = 0, stage = NULL/,
    'and must start from zero rather than from where it stopped');
});

test('cancel only applies to a job that is queued or running', () => {
  const body = JOBS_SRC.slice(JOBS_SRC.indexOf('async function cancel('));
  assert.match(body.slice(0, 1200), /'queued'/);
  assert.match(body.slice(0, 1200), /'processing'/);
  assert.match(body.slice(0, 1200), /FOR UPDATE/,
    'the row must be locked between reading its status and changing it');
  assert.match(body.slice(0, 1200), /ROLLBACK/);
});

test('the route says so when there was nothing to stop', () => {
  const body = ROUTE_SRC.slice(ROUTE_SRC.indexOf("/cancel'"));
  assert.match(body.slice(0, 1400), /409/,
    '"it stopped" and "it had already finished" lead somewhere different');
  assert.ok(body.indexOf('editJobs.cancel') < body.indexOf('editProcessor.cancel'),
    'the row changes first, so a job that slips past the kill still stops at its next check');
});

test('the migration adds progress and stage without a status constraint to widen', () => {
  assert.match(MIG, /ADD COLUMN IF NOT EXISTS progress/);
  assert.match(MIG, /ADD COLUMN IF NOT EXISTS stage/);
  // An actual constraint statement, not the word in a comment.
  assert.doesNotMatch(MIG, /ADD CONSTRAINT|DROP CONSTRAINT|CHECK\s*\(/,
    'status has no constraint, so "cancelled" needs nothing widened');
  assert.match(MIG, /DEFAULT 0/, 'existing rows need a progress value');
});

test('every stage write carries words, not just a number', () => {
  // A bare percentage on a multi-pass render is unverifiable. Every call that
  // moves the bar names what is happening.
  const calls = PROC_SRC.match(/prog\.(at|stage)\([^)]*\)/g) || [];
  assert.ok(calls.length >= 8, `only ${calls.length} progress calls across the renderer`);
  for (const c of calls) {
    assert.match(c, /['`]/, `a progress call with no stage text: ${c}`);
  }
});
