/**
 * Scene templates: a client's photographs into a reel, with no filming.
 *
 * The reason this matters more than it looks: most of October's roster is
 * image-rich and video-poor. An architecture practice has four hundred project
 * photographs and no footage at all. Caption templates only help where someone
 * has filmed themselves; this turns a shoot that already happened into a reel.
 *
 * A template is data, the same as a caption template. It says how many seconds
 * a slot holds, how it moves and how it hands over. The media is whatever is
 * dropped in, so one template serves every client.
 *
 * ffmpeg does all of it: `zoompan` for the Ken Burns, `xfade` for the handover,
 * of which there are 58 built in. No AI, no per-clip fee, no vendor. Produce
 * already has a stills-to-reel path that sends every image through fal at
 * $0.25 a clip, which is $1.25 for a five-image reel and another $1.25 for an
 * attempt you did not like. Keep that for a shot where something should appear
 * to move inside the frame. This is for everything else, which is most of it.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { FFMPEG } = require('./ffmpegBin');

const SHARED = path.join(__dirname, '..', '..', '..', 'shared', 'captions');
const SCENES_PATH = path.join(SHARED, 'scenes.json');

let _config = null;
function config() {
  if (!_config) _config = JSON.parse(fs.readFileSync(SCENES_PATH, 'utf8'));
  return _config;
}

function templates() {
  return Object.values(config().templates).map((t) => ({
    id: t.id, name: t.name, description: t.description, best_for: t.best_for,
    slot_seconds: t.slot_seconds, transition: t.transition.type, fit: t.fit,
  }));
}

function template(id) {
  const t = config().templates[id];
  if (!t) throw new Error(`No scene template "${id}"`);
  return t;
}

/** How long a reel will be, before anyone waits for a render to find out. */
function duration(templateId, slotCount) {
  const t = template(templateId);
  const n = Math.max(1, Number(slotCount) || 0);
  return +(n * t.slot_seconds - (n - 1) * t.transition.seconds).toFixed(2);
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(bin)}: ${String(stderr || err.message).slice(-500)}`));
      else resolve(String(stdout || ''));
    });
  });
}

const PAN_X = {
  centre: 'iw/2-(iw/zoom/2)',
  left: '0',
  right: 'iw-(iw/zoom)',
};

/**
 * Build the filter graph.
 *
 * Kept separate from running it so the arithmetic is testable without ffmpeg:
 * the offsets are where a reel silently loses its last slot, and an off-by-one
 * there is invisible until someone watches the whole thing.
 */
function filterGraph({ templateId, count, width, height, fps = 30 }) {
  const t = template(templateId);
  const n = Math.max(1, count);
  const hold = t.slot_seconds;
  const tdur = t.transition.seconds;
  const frames = Math.round(hold * fps);
  const chains = [];

  for (let i = 0; i < n; i += 1) {
    const m = t.motion[i % t.motion.length];
    const { zoom_from: z0, zoom_to: z1, pan } = m;
    // Both paths build at twice the output and let zoompan come back down.
    // Without that headroom the zoom upscales a 1080-wide frame, which is soft.
    // (It is not what made archive-plate six times the size of the others:
    // that was ffmpeg's `dissolve`, which is a noise dither rather than a
    // cross-fade. Measured, after guessing wrong once.)
    const fit = t.fit === 'contain'
      // Letterbox onto the template's own ground, for a drawing or a scan that
      // must not lose its edges.
      ? `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=decrease,`
        + `pad=${width * 2}:${height * 2}:(ow-iw)/2:(oh-ih)/2:color=${t.pad}`
      : `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,`
        + `crop=${width * 2}:${height * 2}`;
    // zoompan on a still stair-steps badly unless the source is larger than the
    // output, which is why cover scales to 2x before cropping.
    const zoom = z0 === z1 && z0 === 1
      ? `scale=${width}:${height},setsar=1,fps=${fps}`
      : `zoompan=z='${z0}+(${z1}-${z0})*on/${frames}':x='${PAN_X[pan] || PAN_X.centre}':`
        + `y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps},setsar=1`;
    chains.push(`[${i}:v]${fit},${zoom},format=yuv420p[v${i}]`);
  }

  let prev = '[v0]';
  let offset = hold - tdur;
  for (let i = 1; i < n; i += 1) {
    const label = `[x${i}]`;
    chains.push(`${prev}[v${i}]xfade=transition=${t.transition.type}`
      + `:duration=${tdur}:offset=${offset.toFixed(3)}${label}`);
    prev = label;
    offset += hold - tdur;
  }

  return { graph: chains.join(';'), out: prev, seconds: duration(templateId, n), hold };
}

/**
 * Render a reel from local image paths.
 *
 * `images` are paths on this disk. Resolving an asset to a path is the
 * caller's job, because only the caller knows which client's store to look in.
 */
async function render({ templateId, images, outPath, width = 1080, height = 1920, fps = 30 }) {
  const list = (images || []).filter(Boolean);
  if (!list.length) throw new Error('A scene template needs at least one image.');
  for (const p of list) {
    if (!fs.existsSync(p)) throw new Error(`Missing image: ${path.basename(p)}`);
  }
  const t = template(templateId);
  const { graph, out, seconds } = filterGraph({
    templateId, count: list.length, width, height, fps });

  const inputs = [];
  for (const p of list) inputs.push('-loop', '1', '-t', String(t.slot_seconds), '-i', p);

  await run(FFMPEG, ['-y', '-loglevel', 'error', ...inputs,
    '-filter_complex', graph, '-map', out,
    '-t', seconds.toFixed(2), '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath]);

  return { outPath, seconds, slots: list.length, width, height };
}

module.exports = { templates, template, duration, filterGraph, render, SCENES_PATH };
