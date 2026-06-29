// Worker configuration, all from the environment. The box operator sets these
// in the worker's .env / systemd unit. See README.md.

const path = require('path');

const config = {
  // Where the platform lives and the shared secret that authenticates this
  // worker to /api/video/worker.
  platformUrl: (process.env.PLATFORM_URL || '').replace(/\/$/, ''),
  workerToken: process.env.WORKER_TOKEN || '',
  workerId: process.env.WORKER_ID || `worker-${require('os').hostname()}`,

  // Local scratch space. Each project gets a subfolder; cleaned after export.
  workDir: process.env.VIDEO_WORK_DIR || path.join(require('os').tmpdir(), 'omi-video-work'),

  // How often to poll for a job when the queue is empty (ms).
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 5000),

  // Vertical master spec.
  outW: 1080,
  outH: 1920,
  fps: 30,

  // Dead-air trimming: silence below this dB for at least this long is cut.
  silenceDb: Number(process.env.SILENCE_DB || -32),
  silenceMinS: Number(process.env.SILENCE_MIN_S || 0.6),

  // Anthropic — the QA grade stage (vision) scores the cut. Optional model id.
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',

  // Transcription for captions. OpenAI Whisper API if a key is present;
  // otherwise the caption stage is skipped (the pipeline still produces a cut).
  openaiKey: process.env.OPENAI_API_KEY || '',
  whisperModel: process.env.WHISPER_MODEL || 'whisper-1',

  // Binaries — override if not on PATH.
  ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
  // yt-dlp — used by the swipe-file (reel → ideas) flow to fetch a video's
  // audio for transcription. Optional: if it's not installed, swipe items just
  // fail with a clear message; the video pipeline is unaffected.
  ytdlp: process.env.YTDLP_PATH || 'yt-dlp',
};

function assertConfigured() {
  const missing = [];
  if (!config.platformUrl) missing.push('PLATFORM_URL');
  if (!config.workerToken) missing.push('WORKER_TOKEN');
  if (missing.length) {
    console.error(`[worker] missing required env: ${missing.join(', ')}`);
    process.exit(1);
  }
}

module.exports = { config, assertConfigured };
