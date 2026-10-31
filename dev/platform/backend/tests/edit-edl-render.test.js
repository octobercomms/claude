/**
 * Guards on how the processor routes an edit to a render path.
 *
 * Three paths exist and the wrong one is silent: a real edit sent down the
 * stream-copy combine renders the untouched footage and reports success, which
 * is exactly the "it generated the exact same video" the timeline work exists
 * to end. These read the source rather than running ffmpeg, which CI has no
 * footage for.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src', 'services', 'editProcessor.js');
const src = fs.readFileSync(SRC, 'utf8');

test('the processor has a cut renderer that spans clips', () => {
  assert.match(src, /async function cutEdl\(clipPaths, segments, work\)/,
    'the multi-clip cut list is the one capability the Edit page lacked');
  const body = src.slice(src.indexOf('async function cutEdl'));
  assert.match(body.slice(0, 2600), /clipPaths\[seg\.clip\]/,
    'each cut must take its source from its own clip index');
});

test('clip paths stay aligned with the job clips', () => {
  // The old code filtered missing files out of the array, which shifted every
  // index after the gap. With an EDL naming clips by index that renders the
  // right cut from the wrong footage.
  assert.match(src, /const clipPaths = clips\.map\(/,
    'clipPaths must be built by map, not by pushing only what exists');
  const seg = src.slice(src.indexOf('const clipPaths = clips.map('), src.indexOf('const clipPaths') + 500);
  assert.match(seg, /:\s*null;/, 'a missing source must leave a hole, not close the gap');
  assert.doesNotMatch(src, /for \(const c of clips\) \{\s*const p = c\.url && editJobs\.diskPathForUrl\(c\.url\);\s*if \(p && fs\.existsSync\(p\)\) paths\.push\(p\);/,
    'the index-shifting loop must be gone');
});

test('an EDL that is a real edit takes the cut-list path', () => {
  const routing = src.slice(src.indexOf('const storedEdl'), src.indexOf('const { outputPath, srtPath, durationS }'));
  assert.match(routing, /isWholeClipsInOrder/,
    'an untouched edit must not be re-cut, and a touched one must not be stream-copied');
  assert.match(routing, /!E\.isWholeClipsInOrder/);
  assert.ok(routing.indexOf('cutEdl') < routing.indexOf('combineClips'),
    'the EDL branch comes first: it supersedes both older paths');
  assert.match(routing, /normalise\(renderOps\.edl, clips\)/,
    'a stored EDL must be normalised against the clips it is being rendered with');
});

test('the EDL path clears the older trim fields so a cut is not applied twice', () => {
  const routing = src.slice(src.indexOf('srcPath = await cutEdl'), src.indexOf('} else {'));
  assert.match(routing, /trim: null/);
  assert.match(routing, /segments: null/,
    'a stored ops.segments alongside an EDL would cut the already-cut output again');
});

test('jobs with no EDL keep the paths that already work', () => {
  const fallback = src.slice(src.indexOf('} else {', src.indexOf('const storedEdl')));
  assert.match(fallback, /combineClips\(paths, work\)/, 'several clips still stream-copy combine');
  assert.match(fallback, /cutSegments\(srcPath, segs, work\)/,
    'a reopened older job with ops.segments must still render as it did');
});

test('per-block gain reaches ffmpeg', () => {
  // The model carries gain, the surface can set it, so the render has to apply
  // it: a volume change that silently does nothing is the page lying again.
  const body = src.slice(src.indexOf('async function cutEdl'));
  assert.match(body.slice(0, 2600), /'-af', `volume=/,
    'gain must become an audio filter');
  assert.match(body.slice(0, 2600), /Math\.abs\(gain - 1\) > 0\.001/,
    'unity gain must not add a filter, which would force a needless audio pass');
});

test('stills reels are untouched by any of this', () => {
  assert.ok(src.indexOf('job.ops?.stills_reel') < src.indexOf('const storedEdl'),
    'the stills path returns before the EDL routing, as it did before');
});
