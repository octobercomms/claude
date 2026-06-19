// Video Studio — project/clip/job data access (platform side, slice 1).
//
// The platform creates projects, takes clip uploads, and enqueues a pipeline
// run. A dedicated worker box drains `video_jobs`. The claim/complete helpers
// below are the contract that worker uses — kept here so the queue semantics
// live in one place. See docs/omi/video-autoedit-plan.md.

const pool = require('../db');

// Ordered stages of the pipeline. The worker runs them in this order; the
// grade stage can re-enqueue an earlier stage (capped) when it scores < 85.
const STAGES = ['ingest', 'roughcut', 'caption', 'grade', 'export'];
const GRADE_PASS = 85;     // minimum QA score to ship without a re-edit
const MAX_REEDITS = 2;     // grade→roughcut loops before we ship the best cut

async function createProject({ clientId, name, stylePreset, outputTarget }) {
  const { rows } = await pool.query(
    `INSERT INTO video_projects (client_id, name, style_preset, output_target)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [clientId, String(name || 'Untitled edit').slice(0, 200), stylePreset || null, outputTarget || 'download']
  );
  return rows[0];
}

async function listProjects(clientId) {
  const { rows } = await pool.query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM video_clips c WHERE c.project_id = p.id) AS clip_count
     FROM video_projects p WHERE p.client_id = $1
     ORDER BY p.created_at DESC LIMIT 50`,
    [clientId]
  );
  return rows;
}

async function getProject(projectId) {
  const { rows } = await pool.query('SELECT * FROM video_projects WHERE id = $1', [projectId]);
  if (!rows.length) return null;
  const project = rows[0];
  const [clips, jobs] = await Promise.all([
    pool.query('SELECT * FROM video_clips WHERE project_id = $1 ORDER BY position, id', [projectId]),
    pool.query('SELECT id, stage, status, attempt, error, created_at, finished_at FROM video_jobs WHERE project_id = $1 ORDER BY id', [projectId]),
  ]);
  return { ...project, clips: clips.rows, jobs: jobs.rows };
}

async function addClip({ projectId, filename, storedPath, mime, sizeBytes }) {
  const { rows } = await pool.query(
    `INSERT INTO video_clips (project_id, filename, stored_path, mime, size_bytes, position)
     VALUES ($1, $2, $3, $4, $5,
       COALESCE((SELECT MAX(position) + 1 FROM video_clips WHERE project_id = $1), 0))
     RETURNING *`,
    [projectId, filename, storedPath, mime || null, sizeBytes || null]
  );
  return rows[0];
}

// Kick off a run: mark the project queued and enqueue the first stage. The
// worker advances through the remaining stages as each completes.
async function enqueueRun(projectId) {
  const { rows: clips } = await pool.query('SELECT COUNT(*)::int AS n FROM video_clips WHERE project_id = $1', [projectId]);
  if (!clips[0].n) throw new Error('Add at least one clip before running.');
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query(`UPDATE video_projects SET status = 'queued', error = NULL, updated_at = NOW() WHERE id = $1`, [projectId]);
    // Clear any stale jobs from a previous run, then enqueue stage 1.
    await dbClient.query(`DELETE FROM video_jobs WHERE project_id = $1`, [projectId]);
    await dbClient.query(
      `INSERT INTO video_jobs (project_id, stage, status) VALUES ($1, $2, 'queued')`,
      [projectId, STAGES[0]]
    );
    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
  return getProject(projectId);
}

// ── Worker contract ─────────────────────────────────────────────────────────
// The dedicated worker calls these. claimNextJob atomically grabs the oldest
// queued job (SKIP LOCKED so multiple workers don't collide). The worker runs
// the stage, then calls completeJob / failJob.

async function claimNextJob(workerId) {
  const { rows } = await pool.query(
    `UPDATE video_jobs SET status = 'claimed', claimed_by = $1, claimed_at = NOW(), attempt = attempt + 1, updated_at = NOW()
     WHERE id = (
       SELECT id FROM video_jobs WHERE status = 'queued'
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
     )
     RETURNING *`,
    [workerId]
  );
  return rows[0] || null;
}

async function completeJob(jobId) {
  const { rows } = await pool.query(
    `UPDATE video_jobs SET status = 'done', finished_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING project_id, stage`,
    [jobId]
  );
  if (!rows.length) return;
  const { project_id, stage } = rows[0];
  // Advance to the next stage, or finish the project after the last one.
  const next = STAGES[STAGES.indexOf(stage) + 1];
  if (next) {
    await pool.query(`INSERT INTO video_jobs (project_id, stage, status) VALUES ($1, $2, 'queued')`, [project_id, next]);
    await pool.query(`UPDATE video_projects SET status = 'processing', updated_at = NOW() WHERE id = $1`, [project_id]);
  } else {
    await pool.query(`UPDATE video_projects SET status = 'done', updated_at = NOW() WHERE id = $1`, [project_id]);
  }
}

async function failJob(jobId, message) {
  const { rows } = await pool.query(
    `UPDATE video_jobs SET status = 'failed', error = $2, finished_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING project_id`,
    [jobId, String(message || 'stage failed').slice(0, 2000)]
  );
  if (rows.length) {
    await pool.query(`UPDATE video_projects SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`, [rows[0].project_id, String(message || 'stage failed').slice(0, 2000)]);
  }
}

// Everything the worker needs once it's claimed a job: the project settings and
// the ordered clips (with stored_path so it can pull each via the clip
// endpoint). Returned alongside the claimed job.
async function getJobContext(projectId) {
  const { rows } = await pool.query(
    `SELECT id, client_id, name, style_preset, output_target, score, grade_feedback FROM video_projects WHERE id = $1`, [projectId]
  );
  if (!rows.length) return null;
  const { rows: clips } = await pool.query(
    `SELECT id, filename, stored_path, mime, duration_s, width, height, position
       FROM video_clips WHERE project_id = $1 ORDER BY position, id`, [projectId]
  );
  return { project: rows[0], clips };
}

// Worker reports ffprobe results from the ingest stage.
async function applyClipProbe(clipId, { duration_s, width, height } = {}) {
  await pool.query(
    `UPDATE video_clips SET duration_s = COALESCE($2, duration_s), width = COALESCE($3, width), height = COALESCE($4, height)
       WHERE id = $1`,
    [clipId, duration_s ?? null, width ?? null, height ?? null]
  );
}

async function patchProject(projectId, { score, output_url } = {}) {
  await pool.query(
    `UPDATE video_projects SET score = COALESCE($2, score), output_url = COALESCE($3, output_url), updated_at = NOW()
       WHERE id = $1`,
    [projectId, score ?? null, output_url ?? null]
  );
}

// Grade stage outcome. The worker submits a QA score; if it's below the bar and
// we haven't hit the re-edit cap, loop back to roughcut for another pass —
// otherwise advance to export and ship the best cut we have.
async function submitGrade(jobId, score, feedback = null) {
  const { rows } = await pool.query(
    `UPDATE video_jobs SET status = 'done', finished_at = NOW(), updated_at = NOW() WHERE id = $1 AND stage = 'grade' RETURNING project_id`,
    [jobId]
  );
  if (!rows.length) return { retried: false };
  const pid = rows[0].project_id;
  await patchProject(pid, { score });
  // Stash the structured feedback so the next roughcut can act on it.
  await pool.query(`UPDATE video_projects SET grade_feedback = $2 WHERE id = $1`,
    [pid, feedback ? JSON.stringify(feedback) : null]);
  const { rows: c } = await pool.query(`SELECT COUNT(*)::int AS n FROM video_jobs WHERE project_id = $1 AND stage = 'roughcut'`, [pid]);
  const reedits = c[0].n - 1; // first roughcut is the initial cut, not a re-edit
  const retry = (score < GRADE_PASS) && (reedits < MAX_REEDITS);
  const nextStage = retry ? 'roughcut' : 'export';
  await pool.query(`INSERT INTO video_jobs (project_id, stage, status) VALUES ($1, $2, 'queued')`, [pid, nextStage]);
  await pool.query(`UPDATE video_projects SET status = 'processing', updated_at = NOW() WHERE id = $1`, [pid]);
  return { retried: retry, score };
}

module.exports = {
  STAGES, GRADE_PASS, MAX_REEDITS,
  createProject, listProjects, getProject, addClip, enqueueRun,
  claimNextJob, completeJob, failJob,
  getJobContext, applyClipProbe, patchProject, submitGrade,
};
