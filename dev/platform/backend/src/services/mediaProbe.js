// One ffprobe for uploaded media.
//
// There were two copies of this function in `routes/compose.js` — the clip
// upload's, which read dimensions and frame rate, and the audio upload's,
// which was the same spawn with everything but duration thrown away — and a
// third place that needed one and did without. The library upload
// (`routes/assets.js`) recorded no width, no height and no duration, so a
// 90-second video dropped on the Library arrived on the timeline 3.2 seconds
// long: the editor falls back to `STILL_DEFAULT_LEN` when a source has no
// duration of its own, and the row never had one.
//
// `parseFraction` also lived in the route, which meant the test for it
// (`compose.test.js`) held its own copy of the function and asserted against
// that. It would have stayed green if the route's version were deleted. It
// imports this one now.
const { spawn } = require('child_process');
const { FFPROBE } = require('./ffmpegBin');
const { isStillMime } = require('../../../shared/composition.mjs');

// ffprobe reports frame rate as a ratio: 30000/1001 for 29.97.
function parseFraction(str) {
  const parts = String(str).split('/');
  if (parts.length === 2) {
    const n = parseFloat(parts[0]);
    const d = parseFloat(parts[1]);
    if (d > 0 && Number.isFinite(n)) return Math.round(n / d);
  }
  const n = parseFloat(str);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 30;
}

// Rejects when ffprobe is missing or exits non-zero, which is what the clip
// upload has always done with it: a clip whose length is unknown cannot be
// placed on a timeline, so the upload fails loudly rather than guessing.
function probeMedia(filePath) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_format', '-show_streams', filePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    ff.stdout.on('data', d => { out += d; });
    ff.on('error', reject);
    ff.on('close', code => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      try {
        const info = JSON.parse(out);
        const vs = (info.streams || []).find(s => s.codec_type === 'video');
        resolve({
          duration: parseFloat(info.format?.duration) || 0,
          width: vs ? parseInt(vs.width, 10) : 0,
          height: vs ? parseInt(vs.height, 10) : 0,
          fps: vs?.r_frame_rate ? parseFraction(vs.r_frame_rate) : 30,
        });
      } catch { resolve({ duration: 0, width: 0, height: 0, fps: 30 }); }
    });
  });
}

// The three fields an asset row keeps, for a batch upload that must not lose
// a file to a probe. Never throws: the library takes 25 files at a time and
// one unreadable frame header should cost that file its duration, not the
// other 24 their row.
//
// A still has no duration of its own: ffprobe reads a photograph as a
// one-frame video stream, so a JPEG reports nothing and a PNG sometimes
// reports a single frame's worth. The item's length is the editor's choice,
// so the row says null rather than a number somebody downstream would
// believe.
async function probeForRecord(filePath, mime) {
  try {
    const p = await probeMedia(filePath);
    return {
      width: p.width || null,
      height: p.height || null,
      duration_s: isStillMime(mime) ? null : (p.duration || null),
    };
  } catch {
    return { width: null, height: null, duration_s: null };
  }
}

module.exports = { parseFraction, probeMedia, probeForRecord };
