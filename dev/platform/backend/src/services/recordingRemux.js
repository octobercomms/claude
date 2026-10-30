// Turn a MediaRecorder capture into something a browser can play immediately.
//
// The recorder writes a fragmented file, because it is streaming bytes out as
// it records and cannot go back to patch an index in. Measured against real
// Chromium captures:
//
//   mp4   ftyp, a 695-byte moov, then moof/mdat pairs, mfra last. The duration
//         is in the mvhd so the length shows straight away, but there are no
//         sample tables at the front, so seeking costs a range request to the
//         tail of the file to read the random-access index.
//   webm  no duration at all, even with the whole file in hand. The player
//         cannot show a length or seek.
//
// This remuxes with `-c copy`: no re-encode, so it is quick and lossless, and
// the output is a progressive file with its index at the front. The copy lives
// under its own key (`<id>.play.mp4`); the original capture is untouched and
// stays what the Download and Send to editor paths use.
//
// Fire-and-forget from the upload and import routes, like transcription. If it
// fails, `play_key` stays NULL and playback falls back to the original, so a
// broken ffmpeg costs seek quality and nothing else.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pool = require('../db');
const mediaStore = require('./mediaStore');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

// Spawn ffmpeg and resolve on exit 0, else reject with the tail of stderr —
// same shape as recordingExport.run and editProcessor.run.
function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let err = '';
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', reject);                // ENOENT when ffmpeg isn't installed
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}: ${err.slice(-600)}`)));
  });
}

// Which container a recording is in. The flags below are not interchangeable —
// a WebM handed +faststart fails outright — so this is read from the mime the
// recording was stored with rather than assumed.
function containerFor(mime) {
  // QuickTime takes the MP4 path: .mov and .mp4 are both ISO-BMFF, so
  // +faststart is the right flag for either and -cues_to_front is meaningless
  // for both. An imported .mov was the one format that would otherwise have
  // been handed the WebM flags and failed every time.
  const ext = mediaStore.extFor(mime);
  return (ext === 'mp4' || ext === 'mov') ? 'mp4' : 'webm';
}

// The container decides which flag moves the index to the front. Both are
// stream copies; neither touches the picture.
function argsFor(container, inPath, outPath) {
  if (container === 'webm') {
    return ['-y', '-i', inPath, '-c', 'copy', '-cues_to_front', '1', '-f', 'webm', outPath];
  }
  return ['-y', '-i', inPath, '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', outPath];
}

// Remux one recording and record the key. Safe to call more than once: it
// no-ops when a playback copy is already there.
async function remuxRecording(id, { force = false } = {}) {
  const { rows } = await pool.query(
    'SELECT storage_key, mime, play_key FROM recordings WHERE id = $1', [id]);
  const rec = rows[0];
  if (!rec || !rec.storage_key) return { ok: false, reason: 'no stored file' };
  if (rec.play_key && !force) return { ok: true, reason: 'already remuxed', key: rec.play_key };

  const container = containerFor(rec.mime);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `recremux-${id}-`));
  let src = null;
  await pool.query(`UPDATE recordings SET play_status = 'processing' WHERE id = $1`, [id]);
  try {
    src = await mediaStore.localFile(rec.storage_key);
    const outPath = path.join(work, `play.${container}`);
    await run(FFMPEG, argsFor(container, src.path, outPath));

    const st = await fs.promises.stat(outPath);
    if (!st.size) throw new Error('ffmpeg produced an empty file');

    const key = `${id}.play.${container}`;
    await mediaStore.saveFile(key, outPath, rec.mime);
    await pool.query(
      `UPDATE recordings SET play_key = $2, play_status = 'ready' WHERE id = $1`, [id, key]);
    return { ok: true, key, bytes: st.size };
  } catch (err) {
    console.warn('[recordingRemux] failed for', id, '-', err.message);
    await pool.query(`UPDATE recordings SET play_status = 'failed' WHERE id = $1`, [id]).catch(() => {});
    return { ok: false, reason: err.message };
  } finally {
    if (src) await src.release();
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function remuxInBackground(id, opts) {
  remuxRecording(id, opts).catch(() => {});
}

module.exports = { remuxRecording, remuxInBackground, argsFor, containerFor };
