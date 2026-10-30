#!/usr/bin/env node
// What the media store currently is, and what is in it. Read-only: it answers
// "is the switch thrown, and is everything where it should be" without anyone
// having to open psql or ssh around the store directory.
//
//   node scripts/media-store-status.js
//
// It reports the active driver, whether R2 is configured, how many objects each
// column references, how many of those are actually present, and which
// recordings are being served the raw capture rather than a playback remux.

const pool = require('../src/db');
const mediaStore = require('../src/services/mediaStore');

const fmt = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB');

const KEY_SOURCES = [
  ['recordings', ['storage_key', 'play_key', 'mp4_key', 'gif_key']],
  ['transcripts', ['storage_key']],
  ['client_assets', ['storage_key']],
];

async function main() {
  console.log('--- media store ---');
  console.log(`active driver:   ${mediaStore.driverName}`);
  console.log(`R2 configured:   ${mediaStore.r2Configured() ? 'yes' : 'no'}`);
  console.log(`MEDIA_STORE env: ${process.env.MEDIA_STORE || '(unset — defaults to disk)'}`);
  if (mediaStore.r2Configured() && mediaStore.driverName === 'disk') {
    console.log('\n  R2 is configured but the active driver is disk. Set MEDIA_STORE=r2');
    console.log('  to switch, after scripts/media-to-r2.js has copied everything over.');
  }

  console.log('\n--- objects referenced, and whether they are there ---');
  let grandMissing = 0;
  for (const [table, cols] of KEY_SOURCES) {
    let rows;
    try {
      ({ rows } = await pool.query(`SELECT ${cols.join(', ')} FROM ${table}`));
    } catch (err) {
      console.log(`${table}: not available (${err.message})`);
      continue;
    }
    for (const col of cols) {
      const keys = rows.map(r => r[col]).filter(Boolean);
      let present = 0, bytes = 0;
      for (const k of keys) {
        const h = await mediaStore.head(k);
        if (h) { present++; bytes += h.size; }
      }
      const missing = keys.length - present;
      grandMissing += missing;
      console.log(
        `${(table + '.' + col).padEnd(28)} ${String(keys.length).padStart(5)} referenced  `
        + `${String(present).padStart(5)} present  ${fmt(bytes).padStart(10)}`
        + (missing ? `  ${missing} MISSING` : ''));
    }
  }

  // A recording with no playback copy is served the recorder's own fragmented
  // file, which a browser cannot seek in without fetching the tail (MP4) or at
  // all (WebM). See services/recordingRemux.js.
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*)                                            AS total,
             COUNT(*) FILTER (WHERE play_key IS NOT NULL)         AS remuxed,
             COUNT(*) FILTER (WHERE play_status = 'failed')       AS failed,
             COUNT(*) FILTER (WHERE play_status = 'processing')   AS processing
        FROM recordings
       WHERE status = 'ready' AND storage_key IS NOT NULL`);
    const r = rows[0];
    console.log('\n--- playback copies ---');
    console.log(`${r.remuxed} of ${r.total} ready recordings have a seekable playback copy`);
    if (Number(r.failed)) console.log(`${r.failed} failed — retry with POST /api/recordings/:id/remux`);
    if (Number(r.processing)) console.log(`${r.processing} still processing`);
    const behind = Number(r.total) - Number(r.remuxed) - Number(r.processing);
    if (behind > 0) console.log(`${behind} have never been remuxed (made before it existed)`);
  } catch (err) {
    console.log(`\nplayback copies: not available (${err.message})`);
  }

  if (grandMissing) {
    console.log(`\n${grandMissing} referenced objects are missing from the store.`);
  }
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
