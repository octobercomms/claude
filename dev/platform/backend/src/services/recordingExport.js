// Export a recording to a shareable MP4 (or a short GIF) with ffmpeg. The
// browser records WebM (VP8/VP9); WebM is a compatibility footgun when a video
// is downloaded or handed to another tool, so staff can render an H.264 MP4 or
// a GIF on demand. Fire-and-forget from the route (like transcription); the UI
// polls until the asset is ready.
//
// ffmpeg is resolved from FFMPEG_PATH or PATH, matching services/editProcessor.js.
// Rendered bytes are written back into the same media store as the recording.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pool = require('../db');
const mediaStore = require('./mediaStore');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

// Spawn ffmpeg, buffer stderr, resolve on exit 0 else reject with the tail of
// stderr (same shape as editProcessor.run).
function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let err = '';
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}: ${err.slice(-600)}`)));
  });
}

// Render one recording to `format` ('mp4' | 'gif'), store it, and record the key.
async function exportRecording(id, format) {
  const fmt = format === 'gif' ? 'gif' : 'mp4';
  const col = fmt === 'gif' ? 'gif_key' : 'mp4_key';
  const mime = fmt === 'gif' ? 'image/gif' : 'video/mp4';
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `recexp-${id}-`));
  try {
    const { rows } = await pool.query('SELECT storage_key FROM recordings WHERE id = $1', [id]);
    const row = rows[0];
    if (!row || !row.storage_key) throw new Error('recording has no stored file');

    const buf = await mediaStore.getBuffer(row.storage_key);
    const inPath = path.join(work, 'in');
    fs.writeFileSync(inPath, buf);
    const outPath = path.join(work, `out.${fmt}`);

    if (fmt === 'mp4') {
      // Standard, broadly-compatible H.264/AAC MP4 with faststart for streaming.
      await run(FFMPEG, [
        '-y', '-i', inPath,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart',
        outPath,
      ]);
    } else {
      // Two-pass palette GIF (palettegen → paletteuse) for good colour at a sane
      // size: 12fps, max 720px wide. No audio.
      const palette = path.join(work, 'palette.png');
      const scale = 'fps=12,scale=720:-1:flags=lanczos';
      await run(FFMPEG, ['-y', '-i', inPath, '-vf', `${scale},palettegen=stats_mode=diff`, palette]);
      await run(FFMPEG, ['-y', '-i', inPath, '-i', palette, '-lavfi', `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`, outPath]);
    }

    const outBuf = fs.readFileSync(outPath);
    const key = mediaStore.keyFor(id, fmt);   // <recordingId>.mp4 / <recordingId>.gif — distinct from the .webm
    await mediaStore.saveBuffer(key, outBuf, mime);
    await pool.query(`UPDATE recordings SET ${col} = $2, export_status = 'ready' WHERE id = $1`, [id, key]);
  } catch (err) {
    console.warn('[recordingExport] failed for', id, fmt, '-', err.message);
    await pool.query(`UPDATE recordings SET export_status = 'failed' WHERE id = $1`, [id]).catch(() => {});
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function exportInBackground(id, format) {
  exportRecording(id, format).catch(() => {});
}

module.exports = { exportRecording, exportInBackground };
