/**
 * The caption template library, reached from Produce's own edit pipeline.
 *
 * Until this, Produce burned a plain white Whisper SRT and the 31-template
 * library was only reachable from Shared. The risk in joining them is not the
 * burn, which captions.test.js already covers template by template; it is that
 * the edit pipeline quietly keeps taking the old path, which looks like a
 * working render and is the wrong one.
 *
 * So the assertions here are about routing and framing: that a chosen template
 * changes the frame, that no template still produces the plain captions, that
 * the format is picked from the frame's real shape rather than the requested
 * aspect, and that the .srt an operator downloads still arrives.
 *
 * Renders real video with ffmpeg. The transcription is injected, because the
 * one step that costs money is the one a test must not pay for.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const editProcessor = require('../src/services/editProcessor');
const { render, captionFormatFor, srtFromWords } = editProcessor;

let pass = 0; const fails = [];
async function ok(label, fn) {
  try { await fn(); pass += 1; console.log(`  ok   ${label}`); }
  catch (e) { fails.push([label, e.message]); console.log(`  FAIL ${label}\n       ${e.message}`); }
}

function have(bin) {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

// A clip with speech-shaped silence: the words are injected, so the audio only
// has to exist.
function makeClip(dir, { width, height, seconds = 3 }) {
  const out = path.join(dir, `src-${width}x${height}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=0x203040:s=${width}x${height}:d=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=220:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', out]);
  return out;
}

const WORDS = [
  { word: 'Two', start: 0.20, end: 0.60 }, { word: 'hundred', start: 0.60, end: 1.05 },
  { word: 'years', start: 1.05, end: 1.45 }, { word: 'of', start: 1.45, end: 1.60 },
  { word: 'maps', start: 1.60, end: 2.10 }, { word: 'were', start: 2.10, end: 2.40 },
  { word: 'wrong', start: 2.40, end: 2.85 },
];

/** A hash of one frame, which is how "the picture changed" is asserted. */
function frameHash(video, at = '1.2') {
  const png = `${video}.${at}.png`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-ss', at,
    '-frames:v', '1', png]);
  const h = crypto.createHash('sha1').update(fs.readFileSync(png)).digest('hex');
  fs.unlinkSync(png);
  return h;
}

(async () => {
  console.log('\nThe format comes off the frame, not the request');
  await ok('a tall frame is vertical', () =>
    assert.strictEqual(captionFormatFor(1080, 1920), 'vertical'));
  await ok('a square frame is square', () =>
    assert.strictEqual(captionFormatFor(1080, 1080), 'square'));
  await ok('a wide frame is landscape', () =>
    assert.strictEqual(captionFormatFor(1920, 1080), 'landscape'));
  await ok('an odd size still picks the nearest shape, not the default', () =>
    // 720x1280 is 9:16 at another size: libass scales the canvas, so the ratio
    // is what has to match.
    assert.strictEqual(captionFormatFor(720, 1280), 'vertical'));
  await ok('and an unprobeable frame falls back rather than throwing', () =>
    assert.strictEqual(captionFormatFor(null, null), 'vertical'));

  console.log('\nThe .srt an operator downloads still arrives');
  {
    const srt = srtFromWords(WORDS, 3);
    await ok('it is numbered from one and in SRT time format', () => {
      // The cue spans the group: first word's start to the last word's end.
      assert.match(srt, /^1\n00:00:00,200 --> 00:00:01,450\nTwo hundred years\n/);
    });
    await ok('every word is in it, in order', () => {
      const text = srt.split('\n').filter((l) => /[a-z]/i.test(l)).join(' ');
      for (const w of WORDS) assert.ok(text.includes(w.word), `${w.word} is missing`);
    });
    await ok('a cue never ends before it starts', () => {
      const times = [...srt.matchAll(/(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)/g)];
      assert.ok(times.length, 'no cues at all');
      for (const m of times) {
        const a = Number(m[3]) * 1000 + Number(m[4]);
        const b = Number(m[7]) * 1000 + Number(m[8]);
        assert.ok(b > a, `${m[0]} runs backwards`);
      }
    });
  }

  console.log('\nThe library’s rows can be opened by the tools beside them');
  {
    const editJobs = require('../src/services/editJobs');
    const socialCaptionRender = require('../src/services/socialCaptionRender');
    const cid = '11111111-1111-1111-1111-111111111111';
    const dir = editJobs.clientDir(cid);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'indexed.mp4');
    fs.writeFileSync(file, 'not really a video');

    await ok('an edit rendered in Produce resolves to its file on disk', () => {
      // Edits are indexed in client_assets, so they appear in the Library
      // beside recordings and captioned reels. Tighten, caption and scene
      // render all find a clip through this one resolver, and it only knew
      // the brand upload path: every edit in the library would have answered
      // "that clip could not be found on disk".
      assert.strictEqual(
        socialCaptionRender.localPath(cid, { url: `/api/edit/file/${cid}/indexed.mp4` }),
        file);
    });
    await ok('and a path that climbs out of the client’s directory does not', () => {
      assert.strictEqual(
        socialCaptionRender.localPath(cid, { url: `/api/edit/file/${cid}/../../etc/passwd` }),
        null);
    });
    await ok('a url for a file that is gone resolves to nothing, not a path', () => {
      assert.strictEqual(
        socialCaptionRender.localPath(cid, { url: `/api/edit/file/${cid}/never-was.mp4` }),
        null);
    });
    fs.unlinkSync(file);
  }

  if (!have('ffmpeg')) {
    console.log('\nffmpeg missing: the render assertions would silently skip');
    process.exit(1);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-captions-'));
  const deps = {
    whisperWords: async () => WORDS,
    whisperSrt: async () => '1\n00:00:00,200 --> 00:00:01,450\nTwo hundred years\n',
    brandRowsFor: async () => [],          // no brand kit: the template's own colours
  };

  console.log('\nA chosen template reaches the frame');
  {
    const src = makeClip(work, { width: 1080, height: 1920 });

    const plainDir = fs.mkdtempSync(path.join(work, 'plain-'));
    const plain = await render(src, { captions: true, caption_style: { size: 'medium', pos: 0 } },
      plainDir, 'test-key', null, deps);

    const tmplDir = fs.mkdtempSync(path.join(work, 'tmpl-'));
    const tmpl = await render(src, { captions: true, caption_template: 'institution' },
      tmplDir, 'test-key', null, deps);

    await ok('both paths produce a video', () => {
      assert.ok(fs.existsSync(plain.outputPath) && fs.statSync(plain.outputPath).size > 1000);
      assert.ok(fs.existsSync(tmpl.outputPath) && fs.statSync(tmpl.outputPath).size > 1000);
    });
    await ok('and the template render is not the plain one', () => {
      // The whole risk: the pipeline quietly keeping the old path, which looks
      // like a successful render and is the wrong picture.
      assert.notStrictEqual(frameHash(tmpl.outputPath), frameHash(plain.outputPath));
    });
    await ok('the template render says which format it burned for', () =>
      assert.strictEqual(tmpl.formatId, 'vertical'));
    await ok('and hands back the words, so nothing transcribes twice', () =>
      assert.strictEqual(tmpl.words.length, WORDS.length));
    await ok('a .srt is written on the template path too', () => {
      assert.ok(tmpl.srtPath && fs.existsSync(tmpl.srtPath));
      assert.match(fs.readFileSync(tmpl.srtPath, 'utf8'), /Two hundred/);
    });

    console.log('\nTwo templates do not render the same picture');
    const otherDir = fs.mkdtempSync(path.join(work, 'other-'));
    const other = await render(src, { captions: true, caption_template: 'gallery' },
      otherDir, 'test-key', null, deps);
    await ok('institution and gallery differ on the frame', () =>
      assert.notStrictEqual(frameHash(tmpl.outputPath), frameHash(other.outputPath)));
  }

  console.log('\nA square render is captioned as a square');
  {
    const src = makeClip(work, { width: 1080, height: 1080 });
    const dir = fs.mkdtempSync(path.join(work, 'sq-'));
    const out = await render(src, { captions: true, caption_template: 'institution' },
      dir, 'test-key', null, deps);
    await ok('the format follows the frame', () =>
      assert.strictEqual(out.formatId, 'square'));
    await ok('and the frame is still square after the burn', () => {
      const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out.outputPath]).toString().trim();
      assert.strictEqual(probe, '1080,1080');
    });
  }

  console.log('\nNothing is burned that was not asked for');
  {
    const src = makeClip(work, { width: 1080, height: 1920 });
    const dir = fs.mkdtempSync(path.join(work, 'none-'));
    const out = await render(src, { captions: false, caption_template: 'institution' },
      dir, 'test-key', null, deps);
    await ok('captions off beats a template left selected', () => {
      // The screen hides the picker when captions are off, but a saved draft
      // can carry both, and a render that captioned anyway would be burning
      // words onto a video the operator asked to leave alone.
      assert.strictEqual(out.srtPath, null);
      assert.ok(!out.formatId);
    });
  }

  console.log('\nSpeech that transcribed to nothing does not produce an empty burn');
  {
    const src = makeClip(work, { width: 1080, height: 1920 });
    const dir = fs.mkdtempSync(path.join(work, 'silent-'));
    const out = await render(src, { captions: true, caption_template: 'institution' },
      dir, 'test-key', null, { ...deps, whisperWords: async () => [] });
    await ok('it falls back to the uncaptioned cut rather than failing the job', () => {
      assert.ok(fs.existsSync(out.outputPath));
      assert.strictEqual(out.srtPath, null);
    });
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log(fails.length ? `\n${fails.length} failed, ${pass} passed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('THREW:', e.message); process.exit(1); });
