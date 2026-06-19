// Higher-level video operations built on the ffmpeg helpers — the concrete
// transforms the stages compose. Output spec is a vertical 1080×1920 master.

const fs = require('fs');
const path = require('path');
const { ffmpeg } = require('./ffmpeg');
const { config } = require('./config');

// Fit-to-vertical without cropping: scale to fit, pad the rest black, square
// pixels, fixed fps. Keeps every clip a uniform format so pieces concat clean.
const VERTICAL = `scale=${config.outW}:${config.outH}:force_original_aspect_ratio=decrease,` +
  `pad=${config.outW}:${config.outH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${config.fps}`;

// Encode one [start,end) slice of a source clip into a normalized piece. All
// pieces share codec params so the concat demuxer can stitch them losslessly.
async function encodeSegment(src, start, end, outPath) {
  await ffmpeg([
    '-ss', String(start), '-to', String(end), '-i', src,
    '-vf', VERTICAL,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2',
    '-vsync', 'cfr',
    outPath,
  ]);
}

// Concat a list of identically-encoded pieces into one file.
async function concatPieces(pieces, outPath) {
  const listFile = path.join(path.dirname(outPath), `concat-${Date.now()}.txt`);
  fs.writeFileSync(listFile, pieces.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  try {
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outPath]);
  } finally {
    fs.unlink(listFile, () => {});
  }
}

// Pull N evenly-spaced JPEG frames for the QA grade vision pass.
async function extractFrames(src, duration, count, dir) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    const t = duration * ((i + 0.5) / count);
    const out = path.join(dir, `frame-${i}.jpg`);
    await ffmpeg(['-ss', String(t), '-i', src, '-vframes', '1', '-vf', 'scale=480:-1', '-q:v', '4', out]);
    if (fs.existsSync(out)) frames.push(out);
  }
  return frames;
}

// Extract mono 16k wav for transcription.
async function extractAudioWav(src, outPath) {
  await ffmpeg(['-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outPath]);
}

// Final master: optionally burn an ASS caption file (using a fonts dir for the
// brand typeface), then encode the delivery-quality vertical master.
async function exportMaster(src, { captionsAss, fontsDir } = {}, outPath) {
  const args = ['-i', src];
  if (captionsAss && fs.existsSync(captionsAss)) {
    const esc = captionsAss.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    const fontsArg = fontsDir ? `:fontsdir=${fontsDir.replace(/\\/g, '/').replace(/:/g, '\\:')}` : '';
    args.push('-vf', `subtitles='${esc}'${fontsArg}`);
  }
  args.push(
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    outPath,
  );
  await ffmpeg(args);
}

module.exports = { VERTICAL, encodeSegment, concatPieces, extractFrames, extractAudioWav, exportMaster };
