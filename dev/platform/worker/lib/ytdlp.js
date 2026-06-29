// yt-dlp helper for the swipe-file (reel → ideas) flow. We only need the audio
// for transcription, so we extract to mp3 (yt-dlp shells out to ffmpeg, which is
// already on this box). Title is best-effort. If yt-dlp isn't installed the
// spawn fails with ENOENT and the caller fails the item with a clear message.

const fs = require('fs');
const path = require('path');
const { run } = require('./ffmpeg');
const { config } = require('./config');

const ytdlp = (args) => run(config.ytdlp, args, { capture: 'stdout' });

// Fetch a best-effort title for the URL (own call so a title failure never
// blocks the audio download).
async function fetchTitle(url) {
  try {
    const out = await ytdlp(['--no-playlist', '--skip-download', '--print', '%(title)s', url]);
    const title = out.split('\n').find(l => l.trim());
    return title ? title.trim().slice(0, 200) : null;
  } catch { return null; }
}

// Download the URL's audio track as <dir>/audio.mp3. Throws on failure (e.g.
// private/age-gated video, or yt-dlp not installed).
async function fetchAudio(url, dir) {
  const audioPath = path.join(dir, 'audio.mp3');
  await ytdlp([
    '-q', '--no-playlist', '--no-warnings',
    '-x', '--audio-format', 'mp3',
    '-o', path.join(dir, 'audio.%(ext)s'),
    url,
  ]);
  if (!fs.existsSync(audioPath)) throw new Error('yt-dlp produced no audio (private, age-gated, or unsupported URL)');
  return audioPath;
}

module.exports = { fetchAudio, fetchTitle };
