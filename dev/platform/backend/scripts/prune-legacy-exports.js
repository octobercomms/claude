#!/usr/bin/env node
// Drop exports stored under the pre-`.export.` key scheme.
//
//   node scripts/prune-legacy-exports.js            # dry run
//   node scripts/prune-legacy-exports.js --commit   # clear the column, delete the object
//
// Two problems meet in these objects, and both are fixed going forward:
//
//   The key. exportRecording used to store a render at `<id>.<fmt>`, which is
//   also what the recorder names its own capture. Exporting an MP4 recording
//   to MP4 wrote the re-encode over its own source. Renders now live at
//   `<id>.export.<fmt>`, in their own namespace, the way `.play.` does.
//
//   The size. The encoder had a quality target and no ceiling, so a recording
//   that arrived bitrate-capped and full of artefacts produced an export many
//   times its own size — one in this library is 997 MB from a 33 MB source.
//   mp4Args now carries -maxrate/-bufsize.
//
// An export is a render, not an original: deleting one costs a minute of
// ffmpeg the next time somebody asks for it, and nothing else. The capture it
// was made from is never touched.
//
// Dry run by default, like every other script here.

// Load the backend's own .env before anything reads process.env.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/db');
const mediaStore = require('../src/services/mediaStore');

const COMMIT = process.argv.includes('--commit');

const mb = (n) => `${(Number(n || 0) / 1e6).toFixed(1)} MB`;

// A legacy key is one with no `.export.` infix. Written as a positive test on
// the id so a key belonging to another recording entirely is never matched.
function isLegacy(id, key) {
  return !!key && !key.startsWith(`${id}.export.`);
}

async function main() {
  console.log(`prune-legacy-exports — ${COMMIT ? 'COMMIT' : 'dry run'}`);

  const { rows } = await pool.query(
    `SELECT id, title, storage_key, mp4_key, gif_key
       FROM recordings
      WHERE mp4_key IS NOT NULL OR gif_key IS NOT NULL
      ORDER BY created_at`);

  const targets = [];
  for (const r of rows) {
    for (const [col, key] of [['mp4_key', r.mp4_key], ['gif_key', r.gif_key]]) {
      if (!isLegacy(r.id, key)) continue;
      // Never remove an object the recording itself is served from. The whole
      // reason this scheme was wrong is that the two could collide, so the
      // check belongs here rather than in the reader's head.
      if (key === r.storage_key) {
        console.log(`  SKIP   ${key} — ${col} and storage_key are the same object`);
        continue;
      }
      const head = await mediaStore.head(key).catch(() => null);
      targets.push({ id: r.id, title: r.title, col, key, size: head && head.size });
    }
  }

  if (!targets.length) {
    console.log('\nNothing stored under the old scheme.');
    return;
  }

  console.log(`\n${targets.length} legacy export(s)\n`);
  let total = 0;
  for (const t of targets) {
    total += Number(t.size || 0);
    console.log(`  ${COMMIT ? 'removing ' : 'would drop'}  ${t.key}  ${mb(t.size)}  ${t.title || '(untitled)'}`);
    if (!COMMIT) continue;
    // Column first. If the delete then fails, the row points at nothing and
    // the UI offers a re-export, which is recoverable; the other order leaves
    // a row pointing at an object that is gone.
    await pool.query(`UPDATE recordings SET ${t.col} = NULL WHERE id = $1`, [t.id]);
    await mediaStore.remove(t.key).catch(e => console.log(`         (object not removed: ${e.message})`));
  }

  console.log(`\n--- summary ---`);
  console.log(`${COMMIT ? 'freed' : 'would free'}: ${mb(total)} across ${targets.length} object(s)`);
  if (!COMMIT) console.log('\nNothing was changed. Re-run with --commit.');
  else console.log('\nRe-export any of these from the recording\'s row when you need the file.');
}

main()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => pool.end());
