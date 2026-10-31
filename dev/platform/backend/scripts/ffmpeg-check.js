#!/usr/bin/env node
// Does this ffmpeg do everything the platform needs?
//
// Run it against a candidate build before anything on the box changes:
//
//   FFMPEG_PATH=/opt/ffmpeg/ffmpeg FFPROBE_PATH=/opt/ffmpeg/ffprobe \
//     node scripts/ffmpeg-check.js
//
// and against the current one (no env) to compare. It exercises the binary the
// way the services do, with the services' own argument builders where they have
// them, so a build that passes here is one the platform can run.
//
// The checks exist because `ffmpeg -version` says nothing about the two things
// that actually broke: a 4.4 that has no `-cues_to_front`, so three WebM
// recordings kept their seek index at the tail, and a static build without
// libass or libmp3lame, which fails only when someone burns captions or imports
// a swipe — hours after the upgrade, in a background job nobody is watching.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// Read .env the way the sibling scripts do, resolved from __dirname so it works
// from anywhere on the box. Without this, running the script after writing
// FFMPEG_PATH into .env would silently test the system binary again and report
// a pass that means nothing. Env already in the environment wins, which is what
// makes the `FFMPEG_PATH=... node scripts/ffmpeg-check.js` form in the runbook
// work before .env is touched.
// `parsed` is what the FILE carries, which is not the same question as what
// `process.env` ends up holding: dotenv does not override an existing variable,
// so a one-off `FFMPEG_PATH=... node scripts/ffmpeg-check.js` and a box already
// switched over look identical from process.env alone. Telling those apart is
// what the closing advice needs.
const ENV_FILE = require('dotenv').config({ path: path.join(__dirname, '..', '.env') }).parsed || {};

const { FFMPEG, FFPROBE } = require('../src/services/ffmpegBin');
const { argsFor, probeCuesToFront } = require('../src/services/recordingRemux');
const { mp4Args } = require('../src/services/recordingExport');

const FONTS_DIR = path.join(__dirname, '..', '..', 'shared', 'captions', 'fonts');

function run(bin, args, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let out = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.stderr.on('data', d => { out += d.toString(); });
    p.on('error', reject);
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${bin} timed out after ${timeout}ms`)); }, timeout);
    p.on('close', code => {
      clearTimeout(t);
      code === 0 ? resolve(out) : reject(new Error(`exited ${code}: ${out.slice(-700)}`));
    });
  });
}

// ─── EBML / ISO-BMFF readers ───────────────────────────────────────────────
// The byte offset of a top-level Matroska element, walking the structure
// properly. Grepping the file for the Cues id finds the SeekHead's *pointer* to
// it near byte 100 and reports success on a file whose index is at the tail,
// which is how this was first got wrong.
function ebmlOffset(file, idHex) {
  const buf = fs.readFileSync(file);
  const want = Buffer.from(idHex, 'hex');
  // Inside Segment, elements are a vint id then a vint size.
  function vint(at, keepMarker) {
    const first = buf[at];
    if (first === undefined) return null;
    let len = 1;
    for (let m = 0x80; m && !(first & m); m >>= 1) len++;
    if (len > 8 || at + len > buf.length) return null;
    let value = keepMarker ? first : first & (0xff >> len);
    for (let i = 1; i < len; i++) value = value * 256 + buf[at + i];
    return { len, value };
  }
  function walk(start, end, depth) {
    let at = start;
    while (at < end) {
      const id = vint(at, true);
      if (!id) return -1;
      const idBytes = buf.subarray(at, at + id.len);
      const size = vint(at + id.len, false);
      if (!size) return -1;
      const bodyAt = at + id.len + size.len;
      if (idBytes.equals(want)) return at;
      // Descend into Segment (0x18538067) only; everything we look for is a
      // direct child of it.
      if (depth === 0 && idBytes.equals(Buffer.from('18538067', 'hex'))) {
        const found = walk(bodyAt, Math.min(end, bodyAt + size.value), depth + 1);
        if (found > -1) return found;
      }
      // An unknown-size element (all size bits set) can only be walked into.
      const unknown = size.value >= Math.pow(2, 7 * size.len) - 1;
      at = unknown ? bodyAt : bodyAt + size.value;
    }
    return -1;
  }
  return walk(0, buf.length, 0);
}

// Top-level ISO-BMFF box order, e.g. ['ftyp','moov','mdat'].
function mp4Boxes(file) {
  const buf = fs.readFileSync(file);
  const names = [];
  let at = 0;
  while (at + 8 <= buf.length) {
    let size = buf.readUInt32BE(at);
    const name = buf.toString('latin1', at + 4, at + 8);
    let header = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(at + 8)); header = 16; }
    if (size === 0) { names.push(name); break; }
    if (size < header) break;
    names.push(name);
    at += size;
  }
  return names;
}

// ─── the checks ────────────────────────────────────────────────────────────
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

check('both binaries run and report a version', async (dir) => {
  const v = await run(FFMPEG, ['-hide_banner', '-version']);
  const p = await run(FFPROBE, ['-hide_banner', '-version']);
  const ver = (v.match(/ffmpeg version (\S+)/) || [])[1];
  const pver = (p.match(/ffprobe version (\S+)/) || [])[1];
  if (!ver) throw new Error('could not read a version out of ffmpeg');
  const major = Number(ver.replace(/^n/, '').split('.')[0]);
  if (ver !== pver) {
    return { note: `ffmpeg ${ver}, ffprobe ${pver} — MISMATCHED builds` , warn: true };
  }
  if (!Number.isFinite(major) || major < 6) {
    return { note: `${ver} — below 6.0, so -cues_to_front is unavailable`, warn: true };
  }
  return { note: ver };
});

check('-cues_to_front is supported', async () => {
  const ok = await probeCuesToFront(FFMPEG);
  if (!ok) throw new Error(
    'this build has no -cues_to_front, so a remuxed WebM keeps its seek index '
    + 'at the tail and seeking costs a range request to the end of the file');
  return { note: 'the WebM muxer takes it' };
});

check('a WebM remux puts Cues before the first Cluster', async (dir) => {
  const src = path.join(dir, 'src.webm');
  await run(FFMPEG, ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=15:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '200k',
    '-c:a', 'libopus', '-shortest', src]);
  const out = path.join(dir, 'out.webm');
  // The service's own arguments, not a hand-written approximation.
  await run(FFMPEG, argsFor('webm', src, out, true));
  const cues = ebmlOffset(out, '1c53bb6b');
  const cluster = ebmlOffset(out, '1f43b675');
  if (cues < 0) throw new Error('the output has no Cues element at all');
  if (cluster < 0) throw new Error('the output has no Cluster, so nothing was written');
  if (cues > cluster) throw new Error(
    `Cues at ${cues} comes after the first Cluster at ${cluster} — the index is at the tail`);
  return { note: `Cues at byte ${cues}, first Cluster at ${cluster}` };
});

check('an MP4 export puts moov before mdat', async (dir) => {
  const src = path.join(dir, 'src.mp4');
  await run(FFMPEG, ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=15:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src]);
  const out = path.join(dir, 'out.mp4');
  await run(FFMPEG, mp4Args(src, out));
  const boxes = mp4Boxes(out);
  const moov = boxes.indexOf('moov');
  const mdat = boxes.indexOf('mdat');
  if (moov < 0 || mdat < 0) throw new Error(`unexpected box order: ${boxes.join(', ')}`);
  if (moov > mdat) throw new Error(
    `moov after mdat (${boxes.join(', ')}) — the player must fetch the tail before it can start`);
  return { note: boxes.slice(0, 4).join(' ') };
});

check('libass burns a caption with the platform fonts', async (dir) => {
  // The static-build trap. libass is a separate library; a build without it
  // fails only when someone renders captions, which is a background job.
  if (!fs.existsSync(FONTS_DIR)) return { note: `no fonts dir at ${FONTS_DIR}, skipped`, warn: true };
  const font = fs.readdirSync(FONTS_DIR).find(f => /\.ttf$/i.test(f));
  if (!font) return { note: 'no .ttf in the fonts dir, skipped', warn: true };
  const family = font.replace(/[-[].*$/, '').replace(/\.ttf$/i, '');
  const ass = path.join(dir, 'c.ass');
  fs.writeFileSync(ass, [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 160', 'PlayResY: 120', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Alignment, MarginV',
    `Style: D,${family},28,&H00FFFFFF,-1,2,10`, '',
    '[Events]',
    'Format: Layer, Start, End, Style, Text',
    'Dialogue: 0,0:00:00.00,0:00:02.00,D,OMI',
  ].join('\n'));
  const src = path.join(dir, 'cap-src.mp4');
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'color=c=black:size=160x120:rate=15:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', src]);
  const out = path.join(dir, 'cap.mp4');
  // Same filter shape as services/captions.js.
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', src,
    '-vf', `subtitles=${ass}:fontsdir=${FONTS_DIR}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-frames:v', '5', out]);
  // A black frame plus white text: if libass drew nothing the frame stays black.
  const stats = await run(FFMPEG, ['-hide_banner', '-i', out, '-vf', 'signalstats', '-f', 'null', '-']);
  const stderr = await run(FFMPEG, ['-hide_banner', '-i', out,
    '-vf', 'cropdetect=limit=0.1:round=2:reset=1', '-frames:v', '3', '-f', 'null', '-']);
  const drew = /crop=/.test(stderr) && !/crop=16:16/.test(stderr);
  if (!drew && !/x1:/.test(stats)) throw new Error('libass produced no visible text');
  return { note: `drew ${family} via libass` };
});

check('the filters the video services build still exist', async (dir) => {
  // The remux and caption paths are not the whole pipeline. Scenes, example
  // reels, b-roll and social captions build filter graphs out of these, and a
  // filter renamed or dropped between 4.4 and 7.x fails in a background render
  // rather than anywhere a person is looking. Inventory taken from the graphs
  // in services/{scenes,exampleReel,brollRender,silenceCut,socialCaptionRender}.js.
  const needed = ['scale', 'setsar', 'crop', 'pad', 'fps', 'overlay', 'concat',
    'zoompan', 'xfade', 'split', 'format', 'subtitles', 'silencedetect', 'loudnorm'];
  const list = await run(FFMPEG, ['-hide_banner', '-filters']);
  const have = new Set(list.split('\n')
    .map(l => (l.match(/^\s*\S+\s+(\S+)/) || [])[1]).filter(Boolean));
  const missing = needed.filter(f => !have.has(f));
  if (missing.length) throw new Error(`missing filter(s): ${missing.join(', ')}`);
  return { note: `${needed.length} filters present` };
});

check('a zoompan and xfade graph actually renders', async (dir) => {
  // Listing a filter is not running one. zoompan's expression evaluation and
  // xfade's two-input timing are both places where a version bump has changed
  // behaviour, and services/scenes.js leans on both.
  const out = path.join(dir, 'graph.mp4');
  await run(FFMPEG, ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2',
    '-filter_complex',
    '[0:v]scale=640:-2,crop=320:240,zoompan=z=\'min(zoom+0.0015,1.5)\':d=30:s=320x240,setsar=1,fps=15[a];'
    + '[1:v]scale=320:240,setsar=1,fps=15[b];[a][b]xfade=transition=fade:duration=0.5:offset=1[v]',
    '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-frames:v', '20', out]);
  const size = fs.statSync(out).size;
  if (size < 2048) throw new Error(`the render is only ${size} bytes`);
  return { note: `${size} bytes out of zoompan + xfade` };
});

check('an audio extract to mp3 works', async (dir) => {
  // services/swipeProcessor.js and recordingTranscribe.js both do this, and it
  // needs libmp3lame, which some builds leave out.
  const src = path.join(dir, 'a.mp4');
  await run(FFMPEG, ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=15:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src]);
  const out = path.join(dir, 'a.mp3');
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-f', 'mp3', out]);
  const size = fs.statSync(out).size;
  if (size < 1024) throw new Error(`the mp3 is only ${size} bytes`);
  return { note: `${size} bytes from a 2s clip` };
});

check('ffprobe reads a duration back', async (dir) => {
  // editProcessor and silenceCut both branch on this, and a missing duration
  // reads as a zero-length clip rather than an error.
  const src = path.join(dir, 'd.mp4');
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'testsrc=size=160x120:rate=15:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', src]);
  const out = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]);
  const secs = Number(out.trim());
  if (!Number.isFinite(secs) || Math.abs(secs - 3) > 0.5) throw new Error(`read duration ${out.trim()}, expected about 3`);
  return { note: `${secs}s` };
});

async function main() {
  console.log('\nffmpeg check\n');
  console.log(`  ffmpeg   ${FFMPEG}${process.env.FFMPEG_PATH ? '  (FFMPEG_PATH)' : '  (from PATH)'}`);
  console.log(`  ffprobe  ${FFPROBE}${process.env.FFPROBE_PATH ? '  (FFPROBE_PATH)' : '  (from PATH)'}\n`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-check-'));
  let failed = 0; let warned = 0;
  for (const c of checks) {
    try {
      const r = await c.fn(dir) || {};
      if (r.warn) { warned++; console.log(`  warn ${c.name}\n       ${r.note}`); }
      else console.log(`  ok   ${c.name}${r.note ? `   ${r.note}` : ''}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${c.name}\n       ${e.message.split('\n').slice(0, 6).join('\n       ')}`);
    }
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }

  console.log();
  if (failed) {
    console.log(`${failed} check(s) failed.`);
    console.log(closingAdvice({ passed: false }).join('\n'));
    process.exit(1);
  }
  console.log(closingAdvice({
    passed: true, warned, envFile: ENV_FILE, env: process.env,
  }).join('\n'));
}

// What to say after a passing run. Which of the three states the box is in is
// the whole content of the advice, and getting it wrong is not cosmetic: the
// R2 preflight used to print "now run the migration" to someone already live
// on R2 and sent them back round the loop. This script shipped with the same
// bug — it told you to write the lines into .env while reading them out of it.
// Pure and exported so each state is tested.
function closingAdvice({ passed, warned = 0, envFile = {}, env = {} } = {}) {
  if (!passed) {
    return [
      'Do not point the platform at this build.',
      'Nothing has changed: this script only reads and writes temporary files.',
    ];
  }
  const head = `All checks passed${warned ? ` (${warned} warning(s) above)` : ''}.`;
  if (envFile.FFMPEG_PATH && !envFile.FFPROBE_PATH) {
    // Half switched, which is the one state worth interrupting for: ffmpeg from
    // /opt and ffprobe from PATH is two builds inside one pipeline, and every
    // check above passed because the probe ran against whichever ffprobe this
    // command happened to resolve.
    return [
      head,
      '',
      `.env carries FFMPEG_PATH=${envFile.FFMPEG_PATH} but NOT FFPROBE_PATH, so the`,
      'platform runs this ffmpeg and the system ffprobe: two builds in one pipeline.',
      'Add the matching ffprobe:',
      `  echo 'FFPROBE_PATH=${(envFile.FFMPEG_PATH || '').replace(/ffmpeg$/, 'ffprobe')}' >> .env`,
      '  pm2 reload october-platform --update-env',
    ];
  }
  if (envFile.FFMPEG_PATH) {
    // Already switched over. Say so, and give the way back rather than the way in.
    return [
      head,
      '',
      `The platform is already using this build: .env carries FFMPEG_PATH=${envFile.FFMPEG_PATH}.`,
      '',
      'Nothing to do. To go back to the system ffmpeg:',
      "  sed -i '/^FFMPEG_PATH=/d;/^FFPROBE_PATH=/d' .env",
      '  pm2 reload october-platform --update-env',
    ];
  }
  if (env.FFMPEG_PATH) {
    // Set for this command only: the candidate is proven, the switch is not made.
    return [
      head,
      '',
      'This build is proven but not in use: FFMPEG_PATH is set for this command',
      'only, and .env does not carry it. To switch the platform over:',
      `  printf 'FFMPEG_PATH=${env.FFMPEG_PATH}\\nFFPROBE_PATH=${env.FFPROBE_PATH || '<the matching ffprobe>'}\\n' >> .env`,
      '  pm2 reload october-platform --update-env',
      'Then run this again with no env to confirm the running config.',
    ];
  }
  return [
    head,
    '',
    'This was the binary on PATH, and .env names no other. To test a candidate:',
    '  FFMPEG_PATH=/opt/ffmpeg/ffmpeg FFPROBE_PATH=/opt/ffmpeg/ffprobe \\',
    '    node scripts/ffmpeg-check.js',
  ];
}

module.exports = { ebmlOffset, mp4Boxes, checks, closingAdvice };

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
