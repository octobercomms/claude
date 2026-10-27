/**
 * Scene templates: a client's photographs into a reel, with no filming.
 *
 * Two kinds of claim here. The arithmetic is pure and checkable anywhere: how
 * long a reel runs, where each cross-fade starts, what happens when there are
 * more slots than motion entries. The rest needs ffmpeg, because a filter graph
 * that parses and a filter graph that renders are different claims, and the gap
 * between them is where a reel silently loses its last slot.
 *
 *   node tests/scenes.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const scenes = require('../src/services/scenes');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label); failures += 1; }
};

const cfg = JSON.parse(fs.readFileSync(scenes.SCENES_PATH, 'utf8'));
const ALL = Object.values(cfg.templates);

console.log('The library is data, and every template is complete');
ok(ALL.length >= 6, `${ALL.length} scene templates`);
ok(ALL.every((t) => t.slot_seconds > 0 && t.transition?.type && t.motion?.length),
  'each has a hold, a transition and at least one motion');
ok(ALL.every((t) => ['cover', 'contain'].includes(t.fit)), 'and a fit it knows how to do');

console.log('\nNo template uses the transition that is a trap');
// ffmpeg's `dissolve` reads like a gentle cross-fade and is a per-pixel random
// dither. The same 11-second reel was 6.24MB with it and 0.54MB with `fade`,
// all of it noise h264 cannot compress.
const dissolvers = ALL.filter((t) => t.transition.type === 'dissolve').map((t) => t.id);
ok(dissolvers.length === 0,
  `nothing uses dissolve${dissolvers.length ? `: ${dissolvers.join(', ')}` : ''}`);

console.log('\nThe duration is the template\'s own arithmetic, not a fixed length');
// n holds, minus the (n-1) overlaps. Getting this wrong truncates the last
// slot, which nobody notices until they watch a whole reel to the end.
const pr = cfg.templates['project-reveal'];
ok(scenes.duration('project-reveal', 4)
  === +(4 * pr.slot_seconds - 3 * pr.transition.seconds).toFixed(2),
'four slots overlap three times');
ok(scenes.duration('project-reveal', 1) === pr.slot_seconds,
  'one slot has nothing to overlap with');
ok(scenes.duration('project-reveal', 2) > scenes.duration('project-reveal', 1),
  'and more slots is always longer');

console.log('\nEvery cross-fade starts where the one before it ends');
const g = scenes.filterGraph({ templateId: 'project-reveal', count: 5, width: 1080, height: 1920 });
const offsets = [...g.graph.matchAll(/offset=([\d.]+)/g)].map((m) => Number(m[1]));
ok(offsets.length === 4, 'five slots need four hand-overs');
const step = pr.slot_seconds - pr.transition.seconds;
ok(offsets.every((o, i) => Math.abs(o - step * (i + 1)) < 0.001),
  `evenly spaced by ${step.toFixed(2)}s, with no drift`);
// The last transition has to finish inside the reel. A gap here is a reel that
// ends mid-fade on black.
ok(offsets[offsets.length - 1] + pr.transition.seconds <= g.seconds + 0.001,
  'and the last one finishes before the reel does');

console.log('\nMotion cycles when there are more slots than entries');
const wide = scenes.filterGraph({ templateId: 'project-reveal', count: 9, width: 1080, height: 1920 });
ok((wide.graph.match(/\[v\d+\]/g) || []).length >= 9, 'nine slots are all built');
ok(wide.graph.includes('[v8]'), 'including the ninth, past the four motions defined');

console.log('\nA still template does not run zoompan at all');
// catalogue holds its frames deliberately. Running a 1.0-to-1.0 zoompan would
// burn the time and produce the same pixels.
const still = scenes.filterGraph({ templateId: 'catalogue', count: 3, width: 1080, height: 1920 });
ok(!still.graph.includes('zoompan'), 'it scales and holds');
ok(g.graph.includes('zoompan'), 'while a moving one does not skip it');

console.log('\nBad input is refused before ffmpeg is asked');
const threw = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
ok(/no scene template/i.test(threw(() => scenes.template('nope')) || ''),
  'an unknown template is named in the error');
ok(/no scene template/i.test(threw(() => scenes.duration('nope', 3)) || ''),
  'and asking its length fails the same way');

// --- the part only a render can answer ---------------------------------------
let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }

if (!ffmpeg) {
  console.log('\n  SKIP ffmpeg is not on this machine, so nothing was rendered');
} else {
  console.log('\nEvery template renders, and runs as long as it said it would');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scenes-'));
  const imgs = [];
  for (let i = 1; i <= 6; i += 1) {
    const p = path.join(tmp, `i${i}.jpg`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi',
      '-i', `gradients=s=1200x900:d=1:n=3:seed=${i}`, '-frames:v', '1', p], { stdio: 'ignore' });
    imgs.push(p);
  }
  const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error',
    '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

  const bad = [];
  (async () => {
    const results = [];
    for (const t of ALL) {
      const out = path.join(tmp, `${t.id}.mp4`);
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await scenes.render({ templateId: t.id, images: imgs.slice(0, 4), outPath: out });
        const actual = probe(out);
        results.push({ id: t.id, claimed: r.seconds, actual, bytes: fs.statSync(out).size });
      } catch (e) { bad.push(`${t.id}: ${e.message}`); }
    }
    ok(bad.length === 0, `all ${ALL.length} rendered${bad.length ? `\n      ${bad.join('\n      ')}` : ''}`);
    const off = results.filter((r) => Math.abs(r.actual - r.claimed) > 0.3);
    ok(off.length === 0,
      'each is as long as duration() promised'
      + (off.length ? `: ${off.map((r) => `${r.id} said ${r.claimed} got ${r.actual}`).join(', ')}` : ''));

    // The size check is the dissolve trap, caught by measurement rather than
    // by remembering. A megabyte a second means something is making noise.
    const fat = results.filter((r) => r.bytes / r.actual > 700000);
    ok(fat.length === 0,
      'and none of them is generating noise'
      + (fat.length ? `: ${fat.map((r) => `${r.id} at ${Math.round(r.bytes / r.actual / 1024)}KB/s`).join(', ')}` : ''));

    console.log('\nFewer images than the template expects still works');
    const one = path.join(tmp, 'single.mp4');
    const r1 = await scenes.render({ templateId: 'project-reveal', images: [imgs[0]], outPath: one });
    ok(Math.abs(probe(one) - r1.seconds) < 0.3, 'a single image is a reel with no transitions');

    console.log('\nA missing file is named, rather than rendering a reel with a hole in it');
    let missing = null;
    try {
      await scenes.render({ templateId: 'catalogue', images: [imgs[0], '/nope/gone.jpg'],
        outPath: path.join(tmp, 'x.mp4') });
    } catch (e) { missing = e.message; }
    ok(/gone\.jpg/.test(missing || ''), missing || 'it did not fail');
    let empty = null;
    try {
      await scenes.render({ templateId: 'catalogue', images: [], outPath: path.join(tmp, 'y.mp4') });
    } catch (e) { empty = e.message; }
    ok(/at least one image/.test(empty || ''), 'and no images at all is refused');

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
  })();
}

if (!ffmpeg) {
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}
