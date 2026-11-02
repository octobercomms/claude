#!/usr/bin/env node
// Where the seek index actually sits inside each playback copy.
//
//   node scripts/cues-audit.js
//
// `media-store-status.js` reports "8 of 8 ready recordings have a seekable
// playback copy", and that count is `play_key IS NOT NULL`: it says a remux
// happened, not that the remux produced a usable index. The three recordings
// remuxed on ffmpeg 4.4 all had a play_key, which is exactly why
// `remux-backfill.js` needs `--force` to redo them. So 8 of 8 was already true
// while three of the eight still cost a range request to the end of the file
// to scrub, and nothing on the box could tell you which three.
//
// That gap cost a session: with the upgrade done and `play_key` set on
// everything, "8 of 8" reads as finished, and the only honest way to know is
// to open the files. This does that, by walking the EBML structure with
// `ffmpeg-check.js`'s own `ebmlOffset` rather than searching for the Cues id —
// a search finds the SeekHead's pointer to Cues near byte 100 and calls a
// tail-indexed file front-indexed.
//
// Read-only. It downloads each playback copy to a temp file (streamed, so a
// 700MB recording costs a disk write rather than 700MB of heap), reads two
// offsets, and removes it. Exits non-zero if anything is tail-indexed, so it
// can gate a backfill.

// The backend's own .env first, or the store driver reads as disk and Postgres
// gets no credentials — the same trap media-store-status.js documents.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../src/db');
const mediaStore = require('../src/services/mediaStore');
const { ebmlOffset } = require('./ffmpeg-check');

// Matroska/WebM element ids, as ffmpeg-check.js uses them.
const CUES = '1c53bb6b';
const CLUSTER = '1f43b675';

const fmt = (n) => (n == null || n < 0 ? '—' : n.toLocaleString());

// The whole judgement, as one pure function, so it can be tested without a
// database or a 600MB download. `front` is the only good answer.
//
// Order matters: a file with no Cues is judged `no-cues` rather than `tail`,
// because "indexed at the tail" and "not indexed" need different language in
// the report and the second is the worse of the two.
function classify(cues, cluster) {
  if (cues < 0) return 'no-cues';
  if (cluster < 0) return 'no-cluster';
  return cues < cluster ? 'front' : 'tail';
}

async function main() {
  const { rows } = await pool.query(
    `SELECT id, title, play_key
       FROM recordings
      WHERE status = 'ready' AND play_key IS NOT NULL
      ORDER BY created_at`
  );

  if (!rows.length) {
    console.log('No ready recordings carry a playback copy. Nothing to audit.');
    await pool.end();
    return 0;
  }

  console.log(`\nseek index position, ${rows.length} playback cop${rows.length === 1 ? 'y' : 'ies'}`);
  console.log(`store: ${mediaStore.driverName}\n`);

  const tail = [];
  const unreadable = [];

  for (const r of rows) {
    const label = `${String(r.id).slice(0, 8)}  ${String(r.title || '(untitled)').slice(0, 44).padEnd(44)}`;
    let handle = null;
    try {
      handle = await mediaStore.localFile(r.play_key);
      const cues = ebmlOffset(handle.path, CUES);
      const cluster = ebmlOffset(handle.path, CLUSTER);

      switch (classify(cues, cluster)) {
        case 'no-cues':
          // No Cues at all is worse than Cues at the tail: there is no index
          // to seek with, so a scrub re-reads the file.
          unreadable.push({ ...r, why: 'no Cues element' });
          console.log(`  NONE  ${label}  no Cues element at all`);
          break;
        case 'no-cluster':
          unreadable.push({ ...r, why: 'no Cluster element' });
          console.log(`  ??    ${label}  Cues at ${fmt(cues)} but no Cluster found`);
          break;
        case 'front':
          console.log(`  front ${label}  Cues ${fmt(cues)} < Cluster ${fmt(cluster)}`);
          break;
        default:
          tail.push(r);
          console.log(`  TAIL  ${label}  Cues ${fmt(cues)} > Cluster ${fmt(cluster)}`);
      }
    } catch (err) {
      unreadable.push({ ...r, why: err.message });
      console.log(`  ERR   ${label}  ${err.message}`);
    } finally {
      if (handle) await handle.release();
    }
  }

  const bad = tail.length + unreadable.length;
  if (!bad) {
    console.log(`\nAll ${rows.length} playback copies are front-indexed. Nothing to redo.`);
    await pool.end();
    return 0;
  }

  console.log('');
  if (tail.length) {
    console.log(`${tail.length} playback cop${tail.length === 1 ? 'y is' : 'ies are'} indexed at the tail:`);
    for (const r of tail) console.log(`  ${r.id}  ${r.title || '(untitled)'}`);
    console.log('');
    console.log('Redo them (--force, because they already have a play_key and are');
    console.log('otherwise skipped as done), then run this again:');
    console.log('  node scripts/remux-backfill.js --commit --force');
    console.log('  node scripts/cues-audit.js');
    console.log('');
    console.log('This needs an ffmpeg with -cues_to_front (6.0 or later). Check first:');
    console.log('  node scripts/ffmpeg-check.js');
  }
  if (unreadable.length) {
    console.log(`${unreadable.length} could not be judged:`);
    for (const r of unreadable) console.log(`  ${r.id}  ${r.title || '(untitled)'}  — ${r.why}`);
  }

  await pool.end();
  return 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { CUES, CLUSTER, classify };
