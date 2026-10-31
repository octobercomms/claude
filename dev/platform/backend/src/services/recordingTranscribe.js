// Best-effort transcription for in-OMI recordings. The video pipeline's Whisper
// call lives only on the worker box, so this is a small, self-contained backend
// path: pull the stored file, extract a compact audio track with ffmpeg, and
// send it to OpenAI Whisper, then store the text on recordings.transcript (which
// the watch page already surfaces). Fire-and-forget from the upload/import
// routes — it never blocks a response, and no-ops cleanly when OPENAI_API_KEY or
// ffmpeg isn't present. See docs/omi/loom-replacement-plan.md.

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pool = require('../db');
const mediaStore = require('./mediaStore');
const { FFMPEG } = require('./ffmpegBin');

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'whisper-1';
// OpenAI's transcription endpoint caps uploads at 25 MB, so if ffmpeg isn't
// available we can only send the original when it's already small.
const MAX_DIRECT_BYTES = 24 * 1024 * 1024;

// Extract a small mono 16 kHz mp3 from the video via ffmpeg (well under the
// 25 MB cap for even long recordings). Rejects with ENOENT if ffmpeg is not
// installed, which the caller treats as "fall back / skip".
//
// Takes a path rather than a buffer: the video never needs to be in memory, and
// a long screen capture is hundreds of megabytes. Only the extracted audio,
// which is a few megabytes, is read in.
async function extractAudio(inPath) {
  const outPath = path.join(os.tmpdir(), `rec-${crypto.randomBytes(8).toString('hex')}.mp3`);
  try {
    await new Promise((resolve, reject) => {
      const ff = spawn(FFMPEG, ['-y', '-i', inPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', outPath], { stdio: 'ignore' });
      ff.on('error', reject);            // ENOENT when ffmpeg isn't installed
      ff.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
    });
    return await fs.promises.readFile(outPath);
  } finally {
    fs.promises.unlink(outPath).catch(() => {});
  }
}

async function whisper(buf, filename, contentType) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: contentType }), filename);
  fd.append('model', WHISPER_MODEL);
  fd.append('response_format', 'text');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: fd,
  });
  if (!res.ok) {
    console.warn('[recordingTranscribe] whisper failed', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return null;
  }
  return (await res.text()).trim();
}

// Transcribe one recording and store the text. Safe to call fire-and-forget.
async function transcribeRecording(id) {
  try {
    if (!OPENAI_KEY) return; // transcription disabled — leave transcript null
    const { rows } = await pool.query('SELECT storage_key, mime, transcript FROM recordings WHERE id = $1', [id]);
    const rec = rows[0];
    if (!rec || !rec.storage_key || rec.transcript) return; // gone, not stored, or already done

    const ext = mediaStore.extFor(rec.mime);
    const src = await mediaStore.localFile(rec.storage_key);
    let audio, filename = 'audio.mp3', contentType = 'audio/mpeg';
    try {
      try {
        audio = await extractAudio(src.path);
      } catch (e) {
        // No ffmpeg (or it failed) — send the original only if it's small
        // enough for the 25 MB endpoint cap, and only read it in at that point.
        const { size } = await fs.promises.stat(src.path);
        if (size <= MAX_DIRECT_BYTES) {
          audio = await fs.promises.readFile(src.path);
          filename = `audio.${ext}`; contentType = rec.mime || 'video/webm';
        } else {
          console.warn('[recordingTranscribe] ffmpeg unavailable and file too large; skipping', id);
          return;
        }
      }
    } finally {
      await src.release();
    }

    const text = await whisper(audio, filename, contentType);
    if (text) await pool.query('UPDATE recordings SET transcript = $1 WHERE id = $2', [text, id]);
  } catch (err) {
    console.warn('[recordingTranscribe] failed for', id, err.message);
  }
}

// Kick transcription without awaiting it — for use from request handlers.
function transcribeInBackground(id) {
  transcribeRecording(id).catch(() => {});
}

module.exports = { transcribeRecording, transcribeInBackground, enabled: !!OPENAI_KEY };
