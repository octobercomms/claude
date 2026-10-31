// Where ffmpeg and ffprobe come from, for the whole backend.
//
// There used to be two answers. Four services read `FFMPEG_PATH` and the other
// seven spawned the bare string `'ffmpeg'`, so setting `FFMPEG_PATH` upgraded
// remux, export, the editor and swipe while captions, scenes, reels, silence
// cut, b-roll, social captions and transcription stayed on whatever `PATH`
// resolved to. That is the worst of both: two ffmpeg versions in one request
// path, and a failure that reproduces only in the half you are not looking at.
//
// So every call site imports from here. One consequence is worth the import:
// pointing `FFMPEG_PATH` at a candidate build and reloading is now a complete,
// reversible switch for the platform's own ffmpeg use — unset it and reload to
// go back — which is how `scripts/ffmpeg-check.js` proves a new build before
// anything on the box changes.
//
// Read once at require time, deliberately. A binary that changes under a
// running process is not something to accommodate: pm2 reload picks up the new
// env, and `recordingRemux` caches a capability probe against whatever this
// resolved to.

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

// yt-dlp finds ffmpeg on PATH for its own postprocessing (`-x --audio-format
// mp3` shells out), which it would do with the system binary even while we use
// a newer one. `--ffmpeg-location` takes a directory or a binary path.
// Returned empty for a bare name so yt-dlp keeps its own PATH lookup.
function ffmpegLocationArgs(bin = FFMPEG) {
  return bin.includes('/') ? ['--ffmpeg-location', bin] : [];
}

module.exports = { FFMPEG, FFPROBE, ffmpegLocationArgs };
