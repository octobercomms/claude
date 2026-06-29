// Swipe-file processor (reel → ideas). Not part of the video pipeline — the
// worker runs this when there's no video job. Downloads the URL's audio
// (yt-dlp), transcribes it (Whisper), and posts the transcript back; the
// platform then generates the Claude idea card + emails it. Audio-only, so it's
// light. Requires OPENAI_API_KEY for transcription and yt-dlp on the box.

const fs = require('fs');
const path = require('path');
const { config } = require('../lib/config');
const { workPath, cleanup } = require('../lib/work');
const { fetchAudio, fetchTitle } = require('../lib/ytdlp');
const { transcribe } = require('../lib/whisper');

module.exports = async function processSwipe(item, api) {
  const tag = `swipe ${item.id} · ${item.platform || 'url'}`;
  const dir = workPath(`swipe-${item.id}`, '');
  fs.mkdirSync(dir, { recursive: true });
  try {
    if (!config.openaiKey) throw new Error('Transcription unavailable (OPENAI_API_KEY not set on the worker)');

    const title = await fetchTitle(item.url);
    const audioPath = await fetchAudio(item.url, dir);
    const t = await transcribe(audioPath);
    const transcript = (t.text || '').trim();
    if (!transcript) throw new Error('No speech could be transcribed from this video');

    await api.submitSwipeTranscript(item.id, { transcript, title });
    console.log(`[worker] ✓ ${tag} — transcribed (${transcript.length} chars)`);
  } catch (err) {
    console.error(`[worker] ✗ ${tag}: ${err.message}`);
    await api.failSwipe(item.id, err.message).catch(() => {});
  } finally {
    cleanup(`swipe-${item.id}`);
  }
};
