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
// **Both containers, because `recordingRemux.argsFor` makes both.** A WebM
// capture is remuxed to WebM with `-cues_to_front`, and anything else to MP4
// with `-movflags +faststart`. The question is the same either way — is the
// index at the front — but the answer lives in different bytes: Cues before
// the first Cluster in Matroska, `moov` before `mdat` in MP4. The first
// version of this script asked the Matroska question of every file and
// reported the five MP4 playback copies on the box as having "no Cues element
// at all", which read as five broken recordings and was entirely the script's
// fault. Hence `detectContainer`, from the file's own magic bytes rather than
// its key's extension, which can lie.
//
// Structure, never a substring search. `SeekHead` carries a pointer to Cues
// near byte 100, so searching for the Cues id finds it in a tail-indexed file
// and calls it front-indexed; an earlier draft did exactly that and passed.
// Both readers come from `ffmpeg-check.js` so there is one implementation of
// each, not a second place for the answer to be wrong.
//
// Read-only. It streams each playback copy to a temp file (so a 700MB
// recording costs a disk write rather than 700MB of heap), reads the offsets,
// and removes it. Exits non-zero if any copy is indexed at the tail or cannot
// be judged, so it can gate a backfill.

// The backend's own .env first, or the store driver reads as disk and Postgres
// gets no credentials — the same trap media-store-status.js documents.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const pool = require('../src/db');
const mediaStore = require('../src/services/mediaStore');
const { ebmlOffset, mp4Boxes } = require('./ffmpeg-check');

// Matroska/WebM element ids, as ffmpeg-check.js uses them.
const CUES = '1c53bb6b';
const CLUSTER = '1f43b675';

const fmt = (n) => (n == null || n < 0 ? '—' : n.toLocaleString());

// What the file actually is, from its first bytes.
//
// Not the key's extension: `.play.mp4` is written by the remux and so is
// trustworthy today, but a file that is misnamed is exactly the case where a
// container check earns its keep, and reading twelve bytes is cheaper than
// being wrong. Matroska opens with the EBML magic; MP4 carries `ftyp` as its
// first box type, at offset 4.
function detectContainer(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(12);
    const n = fs.readSync(fd, head, 0, 12, 0);
    if (n < 8) return null;
    if (head.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))) return 'webm';
    if (head.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Matroska: Cues before the first Cluster is the good case.
//
// Order matters. A file with no Cues is `no-cues` rather than `tail`, because
// "indexed at the tail" and "not indexed at all" need different language in
// the report and the second is the worse of the two.
function classifyWebm(cues, cluster) {
  if (cues < 0) return 'no-cues';
  if (cluster < 0) return 'no-cluster';
  return cues < cluster ? 'front' : 'tail';
}

// MP4: `moov` before `mdat` is what `-movflags +faststart` produces, and the
// same property Cues-at-the-front gives a WebM — the player can seek without
// fetching the end of the file.
//
// Takes the top-level box names in file order, so the comparison is their
// positions in that list.
function classifyMp4(boxes) {
  const moov = boxes.indexOf('moov');
  const mdat = boxes.indexOf('mdat');
  if (moov < 0) return 'no-moov';
  if (mdat < 0) return 'no-mdat';
  return moov < mdat ? 'front' : 'tail';
}

// One verdict per file: { state, detail }, where state is 'front', 'tail' or
// one of the cannot-judge answers. Pure given a path, so the container split
// is testable against real files without a database.
function judge(file) {
  const container = detectContainer(file);
  if (container === 'webm') {
    const cues = ebmlOffset(file, CUES);
    const cluster = ebmlOffset(file, CLUSTER);
    const state = classifyWebm(cues, cluster);
    const detail = state === 'no-cues' ? 'no Cues element at all'
      : state === 'no-cluster' ? `Cues at ${fmt(cues)} but no Cluster found`
      : `Cues ${fmt(cues)} ${state === 'front' ? '<' : '>'} Cluster ${fmt(cluster)}`;
    return { container, state, detail };
  }
  if (container === 'mp4') {
    const boxes = mp4Boxes(file);
    const state = classifyMp4(boxes);
    const detail = state === 'no-moov' ? `no moov box (saw ${boxes.join(' ') || 'nothing'})`
      : state === 'no-mdat' ? `no mdat box (saw ${boxes.join(' ')})`
      : `${boxes.join(' ')}`;
    return { container, state, detail };
  }
  return { container: null, state: 'unknown-container', detail: 'not a WebM or MP4' };
}

const LABEL = { webm: 'webm', mp4: 'mp4 ', null: '??? ' };

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
  const unjudged = [];

  for (const r of rows) {
    const label = `${String(r.id).slice(0, 8)}  ${String(r.title || '(untitled)').slice(0, 40).padEnd(40)}`;
    let handle = null;
    try {
      handle = await mediaStore.localFile(r.play_key);
      const { container, state, detail } = judge(handle.path);
      const kind = LABEL[String(container)];

      if (state === 'front') {
        console.log(`  front  ${kind}  ${label}  ${detail}`);
      } else if (state === 'tail') {
        tail.push({ ...r, container });
        console.log(`  TAIL   ${kind}  ${label}  ${detail}`);
      } else {
        unjudged.push({ ...r, why: detail });
        console.log(`  ?      ${kind}  ${label}  ${detail}`);
      }
    } catch (err) {
      unjudged.push({ ...r, why: err.message });
      console.log(`  ERR          ${label}  ${err.message}`);
    } finally {
      if (handle) await handle.release();
    }
  }

  if (!tail.length && !unjudged.length) {
    console.log(`\nAll ${rows.length} playback copies are front-indexed. Nothing to redo.`);
    await pool.end();
    return 0;
  }

  console.log('');
  if (tail.length) {
    console.log(`${tail.length} playback cop${tail.length === 1 ? 'y is' : 'ies are'} indexed at the tail:`);
    for (const r of tail) console.log(`  ${r.id}  ${r.title || '(untitled)'}  (${r.container})`);
    console.log('');
    console.log('Redo them (--force, because they already have a play_key and are');
    console.log('otherwise skipped as done), then run this again:');
    console.log('  node scripts/remux-backfill.js --commit --force');
    console.log('  node scripts/cues-audit.js');
    if (tail.some((r) => r.container === 'webm')) {
      console.log('');
      console.log('The WebM ones need an ffmpeg with -cues_to_front (6.0 or later):');
      console.log('  node scripts/ffmpeg-check.js');
    }
  }
  if (unjudged.length) {
    console.log(`${unjudged.length} could not be judged:`);
    for (const r of unjudged) console.log(`  ${r.id}  ${r.title || '(untitled)'}  — ${r.why}`);
  }

  await pool.end();
  return 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { CUES, CLUSTER, classifyWebm, classifyMp4, detectContainer, judge };
