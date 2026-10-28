/**
 * The worked example: one finished reel, always there.
 *
 * Two things to prove. That a clip long enough to carry every step comes back
 * with every step done to it, and that a clip too short to carry them says so
 * rather than quietly handing back a reduced example. The second matters more:
 * an example that silently leaves out the cutaway teaches an operator that
 * cutaways are not a thing the studio does.
 *
 * Renders real video with ffmpeg; no network, no database. The house clip is
 * four seconds and untranscribed on most machines, so the source and its
 * transcript are injected rather than assumed.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const exampleReel = require('../src/services/exampleReel');

let pass = 0; const fails = [];
async function ok(label, fn) {
  try { await fn(); pass += 1; console.log(`  ok   ${label}`); }
  catch (e) { fails.push([label, e.message]); console.log(`  FAIL ${label}\n       ${e.message}`); }
}
function have(bin) {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

const TEXT = 'Right so this is the one I wanted to show you today. '
  + 'For two hundred years every map of the world showed a continent at the bottom of it. '
  + 'Nobody had ever been there and nobody had ever measured any of it. '
  + 'It was drawn in because the world seemed to need balancing out somehow. '
  + 'This is the drawing we have in the collection here with us. '
  + 'First the sailors went south and then they found nothing but open water.';
// Words with real dead air in them: a long pause a third of the way in and an
// "um", because a transcript with neither gives the tightener nothing to do
// and would test only that it declines politely.
const WORDS = (() => {
  const raw = TEXT.split(/\s+/);
  raw.splice(14, 0, 'um');
  const out = [];
  let t = 0.4;
  raw.forEach((w, i) => {
    out.push({ word: w, start: +t.toFixed(3), end: +(t + 0.3).toFixed(3) });
    t += i === 20 ? 1.6 : 0.36;      // one unmistakable pause
  });
  return out;
})();

function clip(dir, name, seconds) {
  const out = path.join(dir, name);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc=size=540x960:rate=25:d=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=200:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', out]);
  return out;
}

(async () => {
  if (!have('ffmpeg')) {
    console.log('ffmpeg missing: the example would silently skip');
    process.exit(1);
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'example-reel-'));
  const cacheDir = path.join(work, 'cache');

  console.log('\nA clip with room shows every step');
  {
    const long = clip(work, 'long.mp4', 26);
    const r = await exampleReel.build({ source: long, words: WORDS, cacheDir });

    await ok('it renders something watchable', () => {
      assert.ok(fs.existsSync(r.path));
      assert.ok(fs.statSync(r.path).size > 10000, `${fs.statSync(r.path).size} bytes`);
      assert.ok(r.seconds > 5, `${r.seconds}s`);
    });
    await ok('the dead air is taken out', () =>
      assert.ok(r.steps.some((s) => /pause/.test(s)), JSON.stringify(r.steps)));
    await ok('a cutaway is laid in, with the reason it was chosen', () =>
      assert.ok(r.steps.some((s) => /cutaway at/.test(s)), JSON.stringify(r.steps)));
    await ok('and the captions are burned in a named template', () =>
      assert.ok(r.steps.some((s) => /captions in the/.test(s)), JSON.stringify(r.steps)));
    await ok('nothing is reported missing', () =>
      assert.deepStrictEqual(r.missing, []));
    await ok('the compromise is stated rather than hidden', () =>
      assert.match(r.note, /punch-in on the same footage/));

    const again = await exampleReel.build({ source: long, words: WORDS, cacheDir });
    await ok('a second request is served from the cache, not re-rendered', () => {
      assert.strictEqual(again.cached, true);
      assert.strictEqual(again.path, r.path);
    });

    // Replacing the sample retires the example: an old render describing
    // footage nobody uses any more is worse than a slow first load.
    const before = r.path;
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(long, later, later);
    const fresh = await exampleReel.build({ source: long, words: WORDS, cacheDir });
    await ok('replacing the clip retires the cached example', () =>
      assert.notStrictEqual(fresh.path, before));
  }

  console.log('\nA clip without room says what it could not show');
  {
    const short = clip(work, 'short.mp4', 4);
    const r = await exampleReel.build({ source: short, words: WORDS.slice(0, 9), cacheDir });
    await ok('it still produces a video rather than refusing', () =>
      assert.ok(fs.existsSync(r.path)));
    await ok('and names the cutaway as the thing it could not demonstrate', () => {
      assert.ok(r.missing.some((m) => /cutaway/i.test(m)), JSON.stringify(r.missing));
      assert.ok(r.missing.some((m) => /twenty seconds/.test(m)), 'no remedy offered');
    });
  }

  console.log('\nA clip with no transcript cannot be cut or captioned');
  {
    const long = clip(work, 'silent.mp4', 26);
    const r = await exampleReel.build({ source: long, words: [], cacheDir });
    await ok('both steps are reported missing, with the remedy', () => {
      assert.ok(r.missing.some((m) => /not been transcribed/.test(m)), JSON.stringify(r.missing));
      assert.ok(r.missing.some((m) => /no transcript to caption from/.test(m)));
    });
    await ok('and the clip still comes back rather than an error', () =>
      assert.ok(fs.existsSync(r.path) && r.seconds > 20));
  }

  console.log('\nIt refuses what it cannot build');
  {
    try {
      await exampleReel.build({ source: path.join(work, 'nope.mp4'), words: WORDS, cacheDir });
      await ok('a missing source is refused', () => assert.fail('it did not throw'));
    } catch (e) {
      await ok('a missing source is refused', () => assert.ok(e.message));
    }
    try {
      const long = clip(work, 'tpl.mp4', 26);
      await exampleReel.build({ source: long, words: WORDS, templateId: 'no-such', cacheDir });
      await ok('an unknown template is refused', () => assert.fail('it did not throw'));
    } catch (e) {
      // Refused twice over: once cheaply at the top, and again by captions.burn
      // if that check were ever removed. The test pins the behaviour, not which
      // of the two did it.
      await ok('an unknown template is refused', () =>
        assert.match(e.message, /template|preset|unknown/i));
    }
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log(fails.length ? `\n${fails.length} failed, ${pass} passed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('THREW:', e.message); process.exit(1); });
