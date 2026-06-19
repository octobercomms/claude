// OMI Video Studio — dedicated worker entrypoint.
//
// Polls the platform's worker API for the next queued job, runs the matching
// pipeline stage on this box (ffmpeg / transcription / Claude QA), and reports
// the result. Stages do the work and throw on failure; this loop owns the
// queue plumbing (complete / grade-submit / fail) so each stage stays simple.
//
// Pipeline: ingest → roughcut → caption → grade → export
//   - grade returns a score; the platform loops back to roughcut (capped) when
//     it's below the bar, otherwise advances to export.
//
// Run with the env in README.md. One job at a time per process; run several
// processes (distinct WORKER_ID) to scale — claims are SKIP LOCKED.

const { config, assertConfigured } = require('./lib/config');
const api = require('./lib/api');
const { failJob } = require('./lib/api');

const STAGES = {
  ingest: require('./stages/ingest'),
  roughcut: require('./stages/roughcut'),
  caption: require('./stages/caption'),
  grade: require('./stages/grade'),
  export: require('./stages/export'),
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let stopping = false;

async function runOnce() {
  const claimed = await api.claim().catch(err => {
    console.error(`[worker] claim failed: ${err.message}`);
    return null;
  });
  if (!claimed || !claimed.job) return false;

  const { job } = claimed;
  const handler = STAGES[job.stage];
  const tag = `job ${job.id} · project ${job.project_id} · ${job.stage} (attempt ${job.attempt})`;
  console.log(`[worker] ▶ ${tag}`);
  const t0 = Date.now();

  try {
    if (!handler) throw new Error(`Unknown stage: ${job.stage}`);
    const result = await handler(claimed, api);
    if (job.stage === 'grade') {
      const r = await api.submitGrade(job.id, result?.score ?? 85);
      console.log(`[worker] ✓ ${tag} — score ${result?.score ?? 85}, ${r.retried ? 're-editing' : 'advancing to export'} (${secs(t0)})`);
    } else {
      await api.completeJob(job.id);
      console.log(`[worker] ✓ ${tag} (${secs(t0)})`);
    }
  } catch (err) {
    console.error(`[worker] ✗ ${tag}: ${err.message}`);
    await failJob(job.id, err.message).catch(() => {});
  }
  return true;
}

function secs(t0) { return `${((Date.now() - t0) / 1000).toFixed(1)}s`; }

async function loop() {
  console.log(`[worker] ${config.workerId} → ${config.platformUrl} (poll ${config.pollIntervalMs}ms)`);
  while (!stopping) {
    let didWork = false;
    try { didWork = await runOnce(); }
    catch (err) { console.error(`[worker] loop error: ${err.message}`); }
    if (!didWork) await sleep(config.pollIntervalMs);
  }
  console.log('[worker] stopped');
  process.exit(0);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { console.log(`[worker] ${sig} — finishing current job then exiting`); stopping = true; });
}

assertConfigured();
loop();
