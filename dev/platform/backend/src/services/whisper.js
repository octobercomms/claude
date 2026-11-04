const fs = require('fs');

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

module.exports = { whisperWords };
