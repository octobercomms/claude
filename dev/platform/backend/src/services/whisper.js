const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { FFMPEG } = require('./ffmpegBin');

/**
 * A 16kHz mono MP3 of whatever audio a file has, as a path on disk.
 *
 * Here rather than at each caller because `whisperWords` takes a path and
 * nothing can call it without this first. The repo had three copies of these
 * eight lines, which is how a helper drifts: the duplicate in
 * `generatedMedia.js` and the one in `adResize.js` are already on the list of
 * things a copy has cost us.
 *
 * 16kHz mono is what Whisper wants: a 48kHz stereo upload is four times the
 * bytes for an answer the model derives from the same information.
 */
function extractAudio(inPath) {
  const outPath = path.join(os.tmpdir(), `transcribe-${crypto.randomBytes(8).toString('hex')}.mp3`);
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, [
      '-y', '-i', inPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', outPath,
    ], { stdio: 'ignore' });
    ff.on('error', reject);                // ENOENT when ffmpeg is not installed
    ff.on('close', (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`ffmpeg exited ${code}`));
    });
  });
}

/**
 * Call OpenAI Whisper with word-level timestamps.
 *
 * Returns [{ word, start, end }] in seconds, which is the shape
 * shared/captions/compile.mjs takes.
 */
async function whisperWords(audioPath, apiKey) {
  const buf = fs.readFileSync(audioPath);
  const form = new FormData();
  form.append('file', new Blob([buf]), 'audio.mp3');
  form.append('model', process.env.WHISPER_MODEL || 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form,
  });
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const words = Array.isArray(body.words) ? body.words : [];
  if (!words.length) {
    throw new Error('Whisper returned no word timings. The model set in WHISPER_MODEL '
      + 'may not support timestamp_granularities.');
  }
  return words
    .map((w) => ({ word: String(w.word ?? '').trim(), start: Number(w.start), end: Number(w.end) }))
    .filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
}

module.exports = { whisperWords, extractAudio };
