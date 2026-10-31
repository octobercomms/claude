// One ffmpeg for the whole backend.
//
// Before `services/ffmpegBin.js` there were two answers to "which ffmpeg". Four
// services read FFMPEG_PATH; seven spawned the bare string 'ffmpeg'. Setting
// FFMPEG_PATH to a newer build therefore upgraded remux, export, the editor and
// swipe while captions, scenes, reels, silence cut, b-roll, social captions and
// transcription kept using whatever PATH resolved to. Nothing failed loudly: a
// caption burned by 4.4 and a remux done by 7.1 in the same request look fine
// until one of them behaves differently.
//
// The scan below is the part that lasts. A new service that spawns 'ffmpeg'
// directly reads perfectly well in review, so a human noticing is not a plan.
//
//   node tests/ffmpeg-bin.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { FFMPEG, FFPROBE, ffmpegLocationArgs } = require('../src/services/ffmpegBin');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// Every literal binary name handed to a process spawn, with its file and line.
// Deliberately crude: it looks for the call shapes this repo actually uses
// rather than parsing, because a scan that only understands clever code misses
// the plain mistake it exists to catch.
const SPAWNERS = /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|run)\s*\(\s*(['"])(ffmpeg|ffprobe)\1/g;

function scanTree(dir, hits = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules') scanTree(p, hits); continue; }
    if (!name.endsWith('.js') && !name.endsWith('.mjs')) continue;
    const src = fs.readFileSync(p, 'utf8');
    // Comments are stripped first, keeping newlines so line numbers survive.
    // A commented-out `spawn('ffmpeg', …)` is prose, and a scan that flags it
    // trains people to ignore the scan.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
    for (const m of code.matchAll(SPAWNERS)) {
      const line = code.slice(0, m.index).split('\n').length;
      hits.push({ file: path.relative(ROOT, p), line, bin: m[2] });
    }
  }
  return hits;
}

check('no service or script spawns a literal ffmpeg or ffprobe', () => {
  const hits = [
    ...scanTree(path.join(ROOT, 'src')),
    ...scanTree(path.join(ROOT, 'scripts')),
  ];
  assert.deepStrictEqual(hits, [],
    'these spawn a binary name instead of importing FFMPEG/FFPROBE from '
    + `services/ffmpegBin, so FFMPEG_PATH would not reach them:\n       `
    + hits.map(h => `${h.file}:${h.line} ${h.bin}`).join('\n       '));
});

check('the scan would catch a reintroduction', () => {
  // Positive control. An empty result above means nothing only if the scan can
  // still fail: the first version of this matched `require` lines too, which
  // made it look thorough while a `spawn('ffmpeg', …)` two lines down passed.
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ffscan-'));
  const bad = [
    "const { spawn } = require('child_process');\nspawn('ffmpeg', ['-i', x]);",
    "await run('ffprobe', ['-v', 'error']);",
    "execFile( 'ffmpeg' , args, cb);",
    'spawnSync("ffmpeg", []);',
  ];
  bad.forEach((src, i) => {
    fs.writeFileSync(path.join(dir, `bad${i}.js`), src);
    const hits = scanTree(dir);
    assert.strictEqual(hits.length, 1, `case ${i} was not caught: ${src}`);
    fs.unlinkSync(path.join(dir, `bad${i}.js`));
  });
  // And does not fire on the things that legitimately name the binary: the
  // module that resolves it, comments, and error-message text.
  const ok = [
    "const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';",
    "// spawn('ffmpeg', args) used to live here",
    "throw new Error('ffmpeg is not installed');",
    "const label = 'ffprobe';",
  ];
  ok.forEach((src, i) => {
    fs.writeFileSync(path.join(dir, `ok${i}.js`), src);
    assert.deepStrictEqual(scanTree(dir), [], `false positive on: ${src}`);
    fs.unlinkSync(path.join(dir, `ok${i}.js`));
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

check('the env vars are what resolve the binaries', () => {
  // Read in a child, because ffmpegBin reads process.env at require time and
  // this process has already required it.
  const read = env => JSON.parse(execFileSync(process.execPath, ['-e',
    "const m = require('./src/services/ffmpegBin');"
    + "process.stdout.write(JSON.stringify([m.FFMPEG, m.FFPROBE]))",
  ], { cwd: ROOT, env: { ...process.env, ...env } }).toString());

  assert.deepStrictEqual(read({ FFMPEG_PATH: '', FFPROBE_PATH: '' }), ['ffmpeg', 'ffprobe'],
    'unset must fall back to PATH, or an unconfigured box stops transcoding');
  assert.deepStrictEqual(read({ FFMPEG_PATH: '/opt/ffmpeg/bin/ffmpeg' })[0], '/opt/ffmpeg/bin/ffmpeg');
  assert.deepStrictEqual(read({ FFPROBE_PATH: '/opt/ffmpeg/bin/ffprobe' })[1], '/opt/ffmpeg/bin/ffprobe');
  // Each is independent: pointing one at a build must not silently move the other.
  assert.deepStrictEqual(read({ FFMPEG_PATH: '/opt/x/ffmpeg' }), ['/opt/x/ffmpeg', 'ffprobe']);
});

check('yt-dlp is told where ffmpeg is, but only when that is not PATH', () => {
  // yt-dlp runs ffmpeg itself for `-x --audio-format mp3`. Passing
  // --ffmpeg-location with a bare name would override its own lookup with
  // something it may resolve differently, so a bare name passes nothing.
  assert.deepStrictEqual(ffmpegLocationArgs('ffmpeg'), []);
  assert.deepStrictEqual(ffmpegLocationArgs('/opt/ffmpeg/bin/ffmpeg'),
    ['--ffmpeg-location', '/opt/ffmpeg/bin/ffmpeg']);
  assert.deepStrictEqual(ffmpegLocationArgs('./ffmpeg'), ['--ffmpeg-location', './ffmpeg']);
  // Default argument tracks the resolved binary, so the two cannot drift.
  assert.deepStrictEqual(ffmpegLocationArgs(), ffmpegLocationArgs(FFMPEG));

  // And the swipe path actually passes them.
  const src = fs.readFileSync(path.join(ROOT, 'src/services/swipeProcessor.js'), 'utf8');
  assert.ok(/ffmpegLocationArgs\(\)/.test(src),
    'swipeProcessor does not pass --ffmpeg-location, so yt-dlp would use the system ffmpeg');
  const line = src.split('\n').find(l => l.includes("'--audio-format'"));
  assert.ok(line && line.includes('ffmpegLocationArgs()'),
    'the --ffmpeg-location args are not on the yt-dlp call that extracts audio');
});

check('every converted service imports the binary it uses', () => {
  const files = fs.readdirSync(path.join(ROOT, 'src/services')).filter(f => f.endsWith('.js'));
  for (const f of files) {
    if (f === 'ffmpegBin.js') continue;
    const src = fs.readFileSync(path.join(ROOT, 'src/services', f), 'utf8');
    const imported = /require\('\.\/ffmpegBin'\)/.test(src);
    // Strip comments before looking for use, so prose about FFMPEG does not count.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .filter(l => !/^\s*\/\//.test(l)).join('\n');
    const uses = /\b(FFMPEG|FFPROBE)\b/.test(code);
    if (uses) assert.ok(imported, `${f} uses FFMPEG/FFPROBE without importing services/ffmpegBin`);
    if (imported) assert.ok(uses, `${f} imports services/ffmpegBin and never uses it`);
  }
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
