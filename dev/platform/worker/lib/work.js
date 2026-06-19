// Per-project scratch directory helpers. Stages of the same project share this
// dir on the box (ingest downloads clips, roughcut writes roughcut.mp4, etc.).

const fs = require('fs');
const path = require('path');
const { config } = require('./config');

function projectDir(projectId) {
  const dir = path.join(config.workDir, String(projectId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function workPath(projectId, ...parts) {
  return path.join(projectDir(projectId), ...parts);
}

function cleanup(projectId) {
  try { fs.rmSync(path.join(config.workDir, String(projectId)), { recursive: true, force: true }); } catch { /* ignore */ }
}

module.exports = { projectDir, workPath, cleanup };
