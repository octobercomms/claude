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
    if (m) await pool.query('UPDATE video_projects SET output_url = NULL WHERE id = $1', [m[1]]).catch(() => {});
  }

  return { clips, masters, retentionDays: RETENTION_DAYS };
}

module.exports = { runCleanup, RETENTION_DAYS };
