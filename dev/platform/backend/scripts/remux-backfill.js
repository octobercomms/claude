#!/usr/bin/env node
// Give every existing recording a seekable playback copy. New recordings get
// one on upload; everything made before services/recordingRemux.js existed is
// still being served the recorder's own fragmented file.
//
//   node scripts/remux-backfill.js            # dry run: what would be rebuilt
//   node scripts/remux-backfill.js --commit   # rebuild, oldest first
//   node scripts/remux-backfill.js --commit --force
//                                             # redo ones that already have a
//                                             # copy, after a change to the
//                                             # remux arguments
//
// Serial on purpose. Each remux is a stream copy, so it is quick, but it is
// still ffmpeg plus a write into the media store, and running dozens at once on
// the box that also serves every request is how a backfill turns into an
// outage.

const pool = require('../src/db');
const remux = require('../src/services/recordingRemux');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FORCE = args.includes('--force');

const fmt = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB');

async function main() {
  const where = FORCE
    ? `status = 'ready' AND storage_key IS NOT NULL`
    : `status = 'ready' AND storage_key IS NOT NULL AND play_key IS NULL`;
  const { rows } = await pool.query(
    `SELECT id, title, mime, size_bytes FROM recordings WHERE ${where} ORDER BY created_at ASC`);

  console.log(`remux-backfill — ${COMMIT ? 'COMMIT' : 'dry run'}${FORCE ? ', forcing' : ''}`);
  console.log(`${rows.length} recordings to rebuild\n`);

  let ok = 0, failed = 0;
  for (const r of rows) {
    const label = `${r.id}  ${(r.title || 'Untitled').slice(0, 44).padEnd(44)} ${fmt(Number(r.size_bytes) || 0).padStart(9)}`;
    if (!COMMIT) { console.log(`  would rebuild  ${label}`); continue; }
    const out = await remux.remuxRecording(r.id, { force: FORCE });
    if (out.ok) { ok++; console.log(`  rebuilt        ${label}`); }
    else { failed++; console.log(`  FAILED         ${label}  ${out.reason}`); }
  }

  console.log('\n--- summary ---');
  if (COMMIT) {
    console.log(`rebuilt: ${ok}`);
    if (failed) console.log(`failed:  ${failed}  (playback falls back to the original capture)`);
  } else {
    console.log(`would rebuild: ${rows.length}`);
    console.log('\nNothing was written. Re-run with --commit.');
  }
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
