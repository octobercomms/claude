/**
 * Guards on positioned text over time.
 *
 * The escaping is the part that matters most. Overlay text is typed by an
 * operator and ends up inside an ASS event, where `{` opens an override block:
 * `{\pos(0,0)}` typed into a caption would move it, `{\c&HFF&}` would recolour
 * it, and somebody would have found a way to drive the renderer by typing into
 * a text box. The rest of this file is timing and placement arithmetic.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SHARED = path.join(__dirname, '..', '..', 'shared', 'overlays.mjs');
let O;
test.before(async () => { O = await import(pathToFileURL(SHARED).href); });

const FMT = { width: 1080, height: 1920 };
const one = (over) => O.normaliseOverlays([{ text: 'Hook', from: 0, to: 3, ...over }], 20);

// ---- escaping ----------------------------------------------------------

test('a brace cannot open an override block', () => {
  // The whole point. Both braces are replaced rather than stripped, so the
  // text still reads as what was typed.
  const got = O.escapeAss('Hook {\\pos(0,0)} line');
  assert.doesNotMatch(got, /[{}]/, `a brace survived: ${got}`);
  assert.match(got, /Hook/, 'and the real words are still there');
  assert.match(got, /line/);
});

test('a backslash cannot start an escape of its own', () => {
  const got = O.escapeAss('C:\\\\Users\\\\n and \\N');
  assert.doesNotMatch(got, /\\(?!N)/, `a stray backslash survived: ${got}`);
});

test('an override block in the rendered event is only ever ours', () => {
  const ass = O.overlayAss(one({ text: 'Try {\\an7\\fs300}this' }), FMT);
  const dialogue = ass.trim().split('\n').pop();
  // Exactly one override block, at the start, built from numbers.
  const blocks = dialogue.match(/\{[^}]*\}/g) || [];
  assert.equal(blocks.length, 1, `expected one override block, got ${blocks.length}: ${dialogue}`);
  assert.match(blocks[0], /^\{\\an5\\pos\(\d+,\d+\)\\fs\d+\}$/,
    `the one block must be ours and numeric: ${blocks[0]}`);
  assert.doesNotMatch(dialogue.slice(dialogue.indexOf('}') + 1), /[{}]/,
    'and nothing after it can open another');
});

test('a newline becomes a hard break, not a broken event', () => {
  // A raw newline inside a Dialogue line would end the event early and leave
  // the rest of the text as a malformed line of its own.
  const got = O.escapeAss('first\nsecond');
  assert.equal(got, 'first\\Nsecond');
  assert.doesNotMatch(got, /\n/, 'no raw newline may reach the file');
  const ass = O.overlayAss(one({ text: 'a\nb\nc' }), FMT);
  const events = ass.trim().split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.equal(events.length, 1, 'three lines of text is still one event');
});

test('text is capped, so one overlay cannot be a document', () => {
  const got = O.escapeAss('x'.repeat(5000));
  assert.ok(got.length <= O.MAX_TEXT, `${got.length} characters got through`);
});

test('empty or whitespace text produces no overlay', () => {
  assert.equal(O.escapeAss(''), '');
  assert.equal(O.escapeAss('   '), '');
  assert.equal(O.escapeAss(null), '');
  assert.equal(O.escapeAss(undefined), '');
  assert.equal(O.normaliseOverlays([{ text: '  ', from: 0, to: 3 }], 20).length, 0);
  assert.equal(O.normaliseOverlays([{ from: 0, to: 3 }], 20).length, 0);
  assert.equal(O.overlayAss([], FMT), null, 'and no file at all, so no pointless re-encode');
  assert.equal(O.overlayAss(null, FMT), null);
});

// ---- timing ------------------------------------------------------------

test('an overlay keeps the times it was given', () => {
  const [o] = O.normaliseOverlays([{ text: 'Hook', from: 2.5, to: 6.25 }], 20);
  assert.equal(o.from, 2.5);
  assert.equal(o.to, 6.25);
  const ass = O.overlayAss([o], FMT);
  assert.match(ass, /0:00:02\.50,0:00:06\.25/, `times must reach the file: ${ass.split('\n').pop()}`);
});

test('an overlay is clamped to the end of the edit', () => {
  // The edit is 10s; an overlay running to 30s would promise text nobody sees.
  const [o] = O.normaliseOverlays([{ text: 'Hook', from: 8, to: 30 }], 10);
  assert.equal(o.to, 10);
  assert.equal(o.from, 8);
});

test('an overlay entirely past the end of the edit is dropped', () => {
  assert.equal(O.normaliseOverlays([{ text: 'Hook', from: 12, to: 15 }], 10).length, 0);
  assert.equal(O.normaliseOverlays([{ text: 'Hook', from: 10, to: 15 }], 10).length, 0,
    'starting exactly at the end is still past it');
});

test('an overlay too brief to read is lengthened, or dropped if there is no room', () => {
  const [a] = O.normaliseOverlays([{ text: 'Hook', from: 1, to: 1 }], 20);
  // Through the module's own comparison, not an exact one: `1.2 - 1` is
  // 0.19999999999999996, so an exact check calls a repaired overlay unreadable.
  assert.ok(O.shownLongEnough(a.from, a.to), `${a.from} to ${a.to} is unreadable`);
  const [b] = O.normaliseOverlays([{ text: 'Hook', from: 2, to: 1 }], 20);
  assert.ok(b.to > b.from, 'an inverted window is repaired, not rendered');
  // Right at the end there is no room to lengthen it.
  assert.equal(O.normaliseOverlays([{ text: 'Hook', from: 9.95, to: 9.96 }], 10).length, 0);
});

test('a missing end time gets a sensible one rather than zero', () => {
  const [o] = O.normaliseOverlays([{ text: 'Hook', from: 1 }], 20);
  assert.ok(O.shownLongEnough(o.from, o.to), `${o.from} to ${o.to}`);
});

test('times survive an unknown edit length', () => {
  // The page may not know the duration yet. Clamping against zero would drop
  // every overlay.
  const o = O.normaliseOverlays([{ text: 'Hook', from: 1, to: 4 }], 0);
  assert.equal(o.length, 1);
  assert.equal(o[0].to, 4);
  assert.equal(O.normaliseOverlays([{ text: 'Hook', from: 1, to: 4 }], null).length, 1);
});

// ---- placement ---------------------------------------------------------

test('a position is a fraction of the frame, so it survives a reframe', () => {
  const o = one({ x: 0.25, y: 0.75 })[0];
  const tall = O.overlayAss([o], { width: 1080, height: 1920 });
  const square = O.overlayAss([o], { width: 1080, height: 1080 });
  assert.match(tall, /\\pos\(270,1440\)/, `9:16 placement: ${tall.split('\n').pop()}`);
  assert.match(square, /\\pos\(270,810\)/, `1:1 placement: ${square.split('\n').pop()}`);
});

test('a position outside the frame is pulled back inside it', () => {
  const o = one({ x: 3, y: -2 })[0];
  assert.equal(o.x, 1);
  assert.equal(o.y, 0);
  const nonsense = one({ x: 'left', y: null })[0];
  assert.ok(nonsense.x >= 0 && nonsense.x <= 1, `x = ${nonsense.x}`);
  assert.ok(nonsense.y >= 0 && nonsense.y <= 1, `y = ${nonsense.y}`);
});

test('the size is a fraction of the frame height, and bounded', () => {
  // A size in pixels that reads well on 1080x1920 is tiny on a wider frame.
  const o = one({ size: 0.1 })[0];
  assert.match(O.overlayAss([o], { width: 1080, height: 1920 }), /\\fs192/);
  assert.match(O.overlayAss([o], { width: 1080, height: 1080 }), /\\fs108/);
  assert.equal(one({ size: 5 })[0].size, O.MAX_SIZE, 'a size of five frames is not a size');
  assert.equal(one({ size: 0 })[0].size, O.MIN_SIZE);
  assert.equal(one({ size: 'big' })[0].size, O.DEFAULT_SIZE);
});

test('the text is centred on its point', () => {
  // Dragging text somewhere means its middle goes there, not its corner.
  assert.match(O.overlayAss(one({}), FMT), /\\an5/);
});

// ---- the file ----------------------------------------------------------

test('the file declares the frame it was built for', () => {
  const ass = O.overlayAss(one({}), { width: 640, height: 360 });
  assert.match(ass, /PlayResX: 640/);
  assert.match(ass, /PlayResY: 360/);
  assert.match(ass, /ScriptType: v4\.00\+/);
  assert.match(ass, /\[Events\]/);
  assert.match(ass, /^Style: Over,/m, 'and carries the style its events name');
});

test('one event per overlay, in order', () => {
  const list = O.normaliseOverlays([
    { text: 'one', from: 0, to: 2 },
    { text: 'two', from: 3, to: 5 },
    { text: 'three', from: 6, to: 8 },
  ], 20);
  const events = O.overlayAss(list, FMT).trim().split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.equal(events.length, 3);
  assert.ok(events[0].endsWith('one'));
  assert.ok(events[2].endsWith('three'));
});

test('overlapping overlays are allowed, because two lines at once is a layout', () => {
  const list = O.normaliseOverlays([
    { text: 'top', from: 0, to: 5, y: 0.2 },
    { text: 'bottom', from: 1, to: 4, y: 0.8 },
  ], 20);
  assert.equal(list.length, 2, 'neither is dropped for overlapping the other');
});

test('the overlay count is capped', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ text: `t${i}`, from: i * 0.1, to: i * 0.1 + 1 }));
  assert.equal(O.normaliseOverlays(many, 1000).length, O.MAX_OVERLAYS);
});

test('a dropped overlay does not take the ones after it', () => {
  const list = O.normaliseOverlays([
    { text: '', from: 0, to: 2 },
    { text: 'kept', from: 1, to: 3 },
  ], 20);
  assert.deepEqual(list.map((o) => o.text), ['kept']);
});

test('normalising does not mutate what it was given', () => {
  const input = [{ text: 'Hook {x}', from: 1, to: 2, x: 9 }];
  const snap = JSON.stringify(input);
  O.normaliseOverlays(input, 20);
  assert.equal(JSON.stringify(input), snap);
});

test('an ASS timestamp is centiseconds, as ASS requires', () => {
  assert.equal(O.assTime(0), '0:00:00.00');
  assert.equal(O.assTime(3.456), '0:00:03.46');
  assert.equal(O.assTime(61.5), '0:01:01.50');
  assert.equal(O.assTime(3725.1), '1:02:05.10');
  assert.equal(O.assTime(-5), '0:00:00.00');
  assert.equal(O.assTime(NaN), '0:00:00.00');
});


test('the minimum-shown test survives float arithmetic', () => {
  // The third appearance of this trap in the timeline work. A repaired overlay
  // is exactly MIN_SHOWN long, and `from + MIN_SHOWN - from` is not always
  // MIN_SHOWN in doubles.
  for (const at of [0, 1, 2.5, 7, 13.33, 59.95, 600]) {
    assert.ok(O.shownLongEnough(at, at + O.MIN_SHOWN),
      `a window of exactly MIN_SHOWN at ${at}s was called too short`);
    const [o] = O.normaliseOverlays([{ text: 'Hook', from: at, to: at }], 1000);
    assert.ok(o, `an overlay repaired at ${at}s was dropped`);
  }
  assert.equal(O.shownLongEnough(1, 1.1), false, 'genuinely brief windows are still refused');
  assert.equal(O.shownLongEnough(1, 1), false);
  assert.equal(O.shownLongEnough(2, 1), false);
});

// ---- the render ---------------------------------------------------------
// Rendered and measured, because the escaping and the timing only matter if
// the text actually appears on screen when and where it was asked for.

const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { FFMPEG } = require('../src/services/ffmpegBin');

let rwork;
let base;
test.before(() => {
  rwork = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-render-'));
  base = path.join(rwork, 'base.mp4');
  // Black, so white text is the only bright thing in the frame and counting
  // bright pixels counts the text.
  execFileSync(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'color=c=black:size=320x240:rate=30:duration=8',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
    '-an', base], { stdio: 'ignore' });
});
test.after(() => { if (rwork) fs.rmSync(rwork, { recursive: true, force: true }); });

function burn(list, out, size = { width: 320, height: 240 }) {
  const assPath = path.join(rwork, `${path.basename(out, '.mp4')}.ass`);
  fs.writeFileSync(assPath, O.overlayAss(list, size), 'utf8');
  execFileSync(FFMPEG, ['-y', '-i', base, '-vf', `subtitles=${assPath}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
    '-an', out], { stdio: 'ignore' });
}

// Bright pixels in a grid over the frame, and where they are. Over black, any
// bright pixel is text.
function brightAt(file, t, cols = 8, rows = 8) {
  const buf = execFileSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', file,
    '-frames:v', '1', '-vf', `scale=${cols}:${rows}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
  { maxBuffer: 1 << 20 });
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (buf[r * cols + c] > 40) cells.push({ c, r, v: buf[r * cols + c] });
    }
  }
  return cells;
}

test('text appears only while it is meant to', () => {
  const list = O.normaliseOverlays([{ text: 'HOOK', from: 2, to: 4, size: 0.2 }], 8);
  const out = path.join(rwork, 'timed.mp4');
  burn(list, out);
  assert.equal(brightAt(out, 0.5).length, 0, 'nothing before it starts');
  assert.ok(brightAt(out, 2.5).length > 0, 'text while it is shown');
  assert.ok(brightAt(out, 3.5).length > 0, 'still there near the end of its window');
  assert.equal(brightAt(out, 5).length, 0, 'gone after it ends');
  assert.equal(brightAt(out, 7.5).length, 0, 'and stays gone');
});

test('text appears where it was put', () => {
  // Near the top for one, near the bottom for the other, in the same render.
  const list = O.normaliseOverlays([
    { text: 'TOP', from: 1, to: 6, x: 0.5, y: 0.12, size: 0.14 },
    { text: 'LOW', from: 1, to: 6, x: 0.5, y: 0.88, size: 0.14 },
  ], 8);
  const out = path.join(rwork, 'placed.mp4');
  burn(list, out);
  const cells = brightAt(out, 3);
  assert.ok(cells.length > 0, 'both overlays rendered');
  const rows = cells.map((c) => c.r);
  assert.ok(Math.min(...rows) <= 1,
    `one line must sit near the top of an 8-row grid, highest was row ${Math.min(...rows)}`);
  assert.ok(Math.max(...rows) >= 6,
    `and the other near the bottom, lowest was row ${Math.max(...rows)}`);
  // And nothing in the middle, which is where a default-positioned overlay
  // would land if the position were ignored.
  assert.equal(cells.filter((c) => c.r === 3 || c.r === 4).length, 0,
    'neither line drifted into the middle of the frame');
});

test('a brace typed into the text cannot move or restyle it', () => {
  // The injection attempt, rendered. The override block it tried to open must
  // appear as characters rather than take effect: text asked to sit at the top
  // must stay at the bottom.
  const list = O.normaliseOverlays([
    { text: 'SAFE {\\an7\\pos(10,10)\\fs200}', from: 1, to: 6, x: 0.5, y: 0.85, size: 0.1 },
  ], 8);
  const out = path.join(rwork, 'injected.mp4');
  burn(list, out);
  const cells = brightAt(out, 3);
  assert.ok(cells.length > 0, 'the text rendered');
  assert.ok(Math.min(...cells.map((c) => c.r)) >= 5,
    `the text must stay where IT was placed, not where the typed tag asked; `
    + `highest bright row was ${Math.min(...cells.map((c) => c.r))} of 8`);
});

test('a bigger size really is bigger on screen', () => {
  const small = path.join(rwork, 'small.mp4');
  const large = path.join(rwork, 'large.mp4');
  burn(O.normaliseOverlays([{ text: 'WORD', from: 1, to: 4, size: 0.04 }], 8), small);
  burn(O.normaliseOverlays([{ text: 'WORD', from: 1, to: 4, size: 0.18 }], 8), large);
  const s = brightAt(small, 2, 16, 16).length;
  const l = brightAt(large, 2, 16, 16).length;
  assert.ok(l > s * 1.5, `a 0.18 size covered ${l} cells against ${s} for 0.04`);
});

test('nothing to draw means no file and no second encode', () => {
  assert.equal(O.overlayAss(O.normaliseOverlays([], 8), { width: 320, height: 240 }), null);
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'editProcessor.js'), 'utf8');
  const body = src.slice(src.indexOf('async function burnOverlays'));
  assert.match(body.slice(0, 1200), /if \(!list\.length\) return srcPath;/,
    'the pass must return the input untouched rather than re-encode for no text');
  assert.match(src, /Array\.isArray\(renderOps\.overlays\) && renderOps\.overlays\.length/,
    'and must not be called at all when the job carries none');
});

test('the overlay pass runs after the captions, not before', () => {
  // An overlay goes on top of whatever the edit produced, burned captions
  // included. Run first, the caption burn would re-encode over it.
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'editProcessor.js'), 'utf8');
  const renderAt = src.indexOf('const rendered = await render(');
  const burnAt = src.indexOf('await burnOverlays(rendered.outputPath');
  assert.ok(renderAt > 0 && burnAt > renderAt,
    'burnOverlays must take the finished render as its input');
  assert.match(src, /'-c:a', 'copy'/,
    'and must not re-encode the audio it is not touching');
});
