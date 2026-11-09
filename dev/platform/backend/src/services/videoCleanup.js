// Video Studio disk retention. Raw clips and finished masters are large and
// otherwise pile up on the app server's disk forever. By the time a project is
// a week old it's been downloaded / emailed / delivered to Drive or Instagram,
// so we hold the files for 7 days then auto-delete. When a master is removed we
// clear the project's output_url so the UI stops offering a dead download (the
// delivered_url — Drive / IG permalink — stays).

const fs = require('fs');
const path = require('path');
const pool = require('../db');

const RETENTION_DAYS = Number(process.env.VIDEO_RETENTION_DAYS || 7);
const CLIPS_DIR = path.join(__dirname, '../../video-clips');
const OUTPUTS_DIR = path.join(__dirname, '../../video-outputs');
// Composition renders land beside the client's own uploads rather than in a
// directory of their own, which is why this sweep could not see them: there
// was no safe way to point it at `uploads/<client>/` without risking the
// files an operator put there. The filename is the only thing that separates
// them, so it is matched EXACTLY and nothing else in that directory is ever
// considered.
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
// DIGITS, because `compositions.id` and `composition_renders.id` are both
// integers — checked against the real schema, not assumed. The first version
// of this allowed hex and hyphens on the suspicion that they were UUIDs, which
// would have let a name like `render-ab-cd.mp4` through to a query that throws
// `invalid input syntax for type integer`. It would have been held rather than
// deleted, because an unanswerable database holds the file, but a pattern that
// cannot match one of ours is better than a guard that catches the mistake.
const RENDER_FILE = /^render-(\d+)-(\d+)\.mp4$/;

/**
 * Whether a composition render may be deleted.
 *
 * Pure, and separate from the sweep, because the rule is the part worth being
 * sure about and a disk walk is not something to test by deleting files.
 *
 * Two conditions, and the second is the one worth having. Age, the same seven
 * days a project master gets, on the same reasoning: by then it has been
 * downloaded, delivered to Drive or posted. And A VERDICT — an item of a batch
 * that nobody has approved or rejected is work nobody has looked at, and a
 * sweep that deletes it leaves the review sheet offering a row whose file is
 * gone. A render with no batch behind it (one somebody exported from the
 * editor) has no verdict to wait for and goes on age alone.
 */
function mayDelete({ ageMs, windowMs, batchItem }) {
  if (!(ageMs >= windowMs)) return { ok: false, why: 'inside the retention window' };
  if (batchItem && !batchItem.verdict) {
    return { ok: false, why: 'a batch item nobody has reviewed yet' };
  }
  return { ok: true, why: 'past the window and either reviewed or not part of a batch' };
}

function listFiles(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}
function olderThan(filePath, cutoffMs) {
  try { return fs.statSync(filePath).mtimeMs < cutoffMs; } catch { return false; }
}

async function runCleanup() {
  const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;
  let clips = 0, masters = 0;

  for (const f of listFiles(CLIPS_DIR)) {
    const fp = path.join(CLIPS_DIR, f);
    if (olderThan(fp, cutoff)) { try { fs.unlinkSync(fp); clips++; } catch { /* ignore */ } }
  }

  for (const f of listFiles(OUTPUTS_DIR)) {
    const fp = path.join(OUTPUTS_DIR, f);
    if (!olderThan(fp, cutoff)) continue;
    try { fs.unlinkSync(fp); masters++; } catch { /* ignore */ }
    const m = f.match(/^(\d+)-master\.mp4$/);
    if (m) {
      await pool.query('UPDATE video_projects SET output_url = NULL WHERE id = $1', [m[1]]).catch(() => {});
      // And the library row, which is a claim that this file exists. Clearing
      // output_url stops the Video Studio offering a dead download; it does
      // nothing for the Library, the scheduler, or anything else that reads
      // client_assets.
      await require('./assets').archiveBySource('video_project', m[1]).catch(() => {});
    }
  }

  // The duration, not the cutoff timestamp. `mayDelete` compares an AGE
  // against a window, and handing it a timestamp named like a duration is the
  // kind of unit muddle that reads fine and deletes the wrong files.
  const renders = await sweepCompositionRenders(RETENTION_DAYS * 86400 * 1000);

  return { clips, masters, renders, retentionDays: RETENTION_DAYS };
}

/**
 * Composition renders, per client directory.
 *
 * Only files whose name is exactly `render-<compositionId>-<renderId>.mp4`,
 * which is what `compositionRenderRunner` writes. Everything else in
 * `uploads/<client>/` is the client's own, and a sweep that took a file an
 * operator uploaded would be a far worse fault than a disk that fills up.
 */
async function sweepCompositionRenders(windowMs) {
  let deleted = 0;
  let held = 0;

  for (const client of listFiles(UPLOADS_DIR)) {
    const dir = path.join(UPLOADS_DIR, client);
    let entries;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      entries = fs.readdirSync(dir);
    } catch { continue; }

    for (const f of entries) {
      const m = f.match(RENDER_FILE);
      if (!m) continue;
      const fp = path.join(dir, f);
      let ageMs;
      try { ageMs = Date.now() - fs.statSync(fp).mtimeMs; } catch { continue; }

      const batchItem = await batchItemFor(m[1]);
      const verdict = mayDelete({ ageMs, windowMs, batchItem });
      if (!verdict.ok) { held += 1; continue; }

      try { fs.unlinkSync(fp); deleted += 1; } catch { continue; }
      // The library row is a claim that this file exists, so it goes with it.
      await require('./assets')
        .archiveBySource('composition', `render-${m[1]}-${m[2]}`)
        .catch(() => {});
    }
  }

  return { deleted, held };
}

/** The batch item for a composition, or null when it is not part of a batch. */
async function batchItemFor(compositionId) {
  try {
    const { rows } = await pool.query(
      'SELECT verdict FROM composition_batch_items WHERE composition_id = $1 LIMIT 1',
      [compositionId]
    );
    return rows[0] || null;
  } catch {
    // A database that cannot answer is not a licence to delete. Treated as an
    // unreviewed batch item, which holds the file.
    return { verdict: null };
  }
}

module.exports = {
  runCleanup,
  RETENTION_DAYS,
  // Exported for the tests: the rule is the part worth being sure about, and
  // it is not something to check by deleting files.
  mayDelete,
  RENDER_FILE,
};
