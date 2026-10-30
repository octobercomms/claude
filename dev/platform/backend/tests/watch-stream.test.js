// What the public watch stream serves, and what a viewer is allowed to keep.
//
// Three things were wrong here and every one of them was invisible. Nothing
// threw, nothing logged, the video played: it was only slow, or it would not
// seek, and there was no way to tell from the outside which.
//
//   1. `Cache-Control: private, max-age=0, no-store` forbade caching outright.
//      Scrubbing back ten seconds, replaying, or reloading the page
//      re-downloaded the whole file from the box. On a 200MB walkthrough that
//      is 200MB per rewind.
//   2. The route served `storage_key`, the recorder's own fragmented capture,
//      and never the remuxed seekable copy — which existed, and was offered as
//      a manual download.
//   3. Content-Type came from the recording's original mime, so the .mp4
//      playback copy of an imported .mov would have been labelled
//      video/quicktime.
//
//   node tests/watch-stream.test.js

const assert = require('assert');
const {
  playbackKeys, parseRange, streamHeaders, redirectHeaders,
  SIGNED_TTL_SEC, CACHE_MAX_AGE,
} = require('../src/services/watchStream');
const mediaStore = require('../src/services/mediaStore');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const ctf = mediaStore.contentTypeFor;
const headersFor = (over = {}) => streamHeaders({
  key: 'abc.play.mp4', mime: 'video/mp4', size: 1000, start: 0, end: 999,
  hasRange: false, contentTypeFor: ctf, ...over,
});

console.log('the public watch stream');

// ── which object gets served ─────────────────────────────────────────────────

check('the seekable playback copy is preferred over the raw capture', () => {
  const keys = playbackKeys({ play_key: 'a.play.mp4', storage_key: 'a.mp4' });
  assert.strictEqual(keys[0], 'a.play.mp4',
    'the raw capture is being served while a remuxed copy sits in the store unused');
});

check('the raw capture is still served when there is no playback copy', () => {
  // Every recording made before the remux existed, and any whose remux failed.
  // Serving nothing would be worse than serving the slow file.
  assert.deepStrictEqual(playbackKeys({ play_key: null, storage_key: 'a.mp4' }), ['a.mp4']);
});

check('the original stays in the list as a fallback, not just as a default', () => {
  // A playback copy can go missing from the store — a half-finished prune, a
  // failed R2 migration. The route retries down this list on a read error, so
  // both keys have to be in it even when the first one looks fine.
  assert.deepStrictEqual(
    playbackKeys({ play_key: 'a.play.mp4', storage_key: 'a.mp4' }),
    ['a.play.mp4', 'a.mp4']);
});

check('a recording with nothing stored yields no keys rather than a null one', () => {
  assert.deepStrictEqual(playbackKeys({ play_key: null, storage_key: null }), []);
  assert.deepStrictEqual(playbackKeys(null), [], 'a missing recording must not throw');
  assert.deepStrictEqual(playbackKeys(undefined), []);
});

// ── caching ──────────────────────────────────────────────────────────────────

check('a viewer may cache the bytes', () => {
  const cc = headersFor().headers['Cache-Control'];
  assert.ok(!/no-store|no-cache/.test(cc),
    `Cache-Control is "${cc}" — no-store means every rewind re-downloads the file`);
  assert.ok(/max-age=(\d+)/.test(cc), `Cache-Control is "${cc}" with no max-age`);
  assert.ok(Number(/max-age=(\d+)/.exec(cc)[1]) >= 3600,
    `max-age is too short to survive a viewing: "${cc}"`);
  assert.ok(cc.includes('immutable'),
    'the bytes behind a key never change, so say so and save the revalidation');
});

check('the bytes stay out of shared caches', () => {
  // The share token is the only thing protecting a recording, so the URL is
  // the credential. A shared cache keyed on it would hold copies that deleting
  // the recording cannot reach.
  const cc = headersFor().headers['Cache-Control'];
  assert.ok(cc.includes('private'), `Cache-Control is "${cc}" — public puts client video in caches we cannot purge`);
  assert.ok(!cc.includes('public'), `Cache-Control is "${cc}"`);
});

check('a redirect to R2 is never cached', () => {
  // It expires, and the bytes behind it are cached by R2 instead. A held
  // redirect is a dead link once the signature lapses.
  const cc = redirectHeaders()['Cache-Control'];
  assert.ok(/no-store/.test(cc), `the signed redirect must not be cached, got "${cc}"`);
});

check('a signed R2 URL outlasts a viewing', () => {
  // The player reuses the URL it was redirected to for every later range
  // request. At one hour it expired mid-video and seeking silently stopped.
  assert.ok(SIGNED_TTL_SEC >= 4 * 3600,
    `a ${SIGNED_TTL_SEC}s signature expires part-way through a long recording`);
  assert.ok(CACHE_MAX_AGE >= 24 * 3600, 'the cache window should cover more than one sitting');
});

// ── content type ─────────────────────────────────────────────────────────────

check('the response is typed from the key being served, not the original mime', () => {
  // The playback copy of an imported .mov is an .mp4. Labelling those bytes
  // video/quicktime is how a browser refuses a file it would have played.
  const h = headersFor({ key: 'abc.play.mp4', mime: 'video/quicktime' }).headers;
  assert.strictEqual(h['Content-Type'], 'video/mp4',
    'the Content-Type followed the recording\'s mime rather than the file actually sent');
});

check('webm is still typed as webm', () => {
  assert.strictEqual(
    headersFor({ key: 'abc.play.webm', mime: 'video/webm' }).headers['Content-Type'],
    'video/webm');
});

check('a key with no recognisable extension falls back to the stored mime', () => {
  const h = headersFor({ key: 'legacy-object', mime: 'video/webm' }).headers;
  assert.strictEqual(h['Content-Type'], 'video/webm',
    'an old key with no extension must still be typed from something');
});

// ── ranges ───────────────────────────────────────────────────────────────────

check('an open-ended range is what a browser opens a video with', () => {
  assert.deepStrictEqual(parseRange('bytes=0-'), { start: 0, end: null });
});

check('a bounded range is parsed on both ends', () => {
  assert.deepStrictEqual(parseRange('bytes=500-999'), { start: 500, end: 999 });
});

check('a suffix range starts at zero rather than NaN', () => {
  assert.deepStrictEqual(parseRange('bytes=-500'), { start: 0, end: 500 });
});

check('no range header and nonsense both mean no range', () => {
  for (const h of [undefined, null, '', 'pages=1-2', 'bytes=abc']) {
    assert.strictEqual(parseRange(h), null, `"${h}" should not parse as a range`);
  }
});

check('a whole-file request is a 200 with no Content-Range', () => {
  const { status, headers } = headersFor({ hasRange: false, start: 0, end: 999, size: 1000 });
  assert.strictEqual(status, 200);
  assert.strictEqual(headers['Content-Range'], undefined);
  assert.strictEqual(headers['Content-Length'], 1000);
  assert.strictEqual(headers['Accept-Ranges'], 'bytes',
    'without Accept-Ranges a browser will not try to seek at all');
});

check('a partial request is a 206 with the right length and range', () => {
  const { status, headers } = headersFor({ hasRange: true, start: 200, end: 499, size: 1000 });
  assert.strictEqual(status, 206);
  assert.strictEqual(headers['Content-Range'], 'bytes 200-499/1000');
  assert.strictEqual(headers['Content-Length'], 300, 'Content-Length must be the slice, not the file');
});

check('a range that happens to cover the whole file is a 200, not a 206', () => {
  // `bytes=0-` resolves to the entire file. Answering 206 for it is legal but
  // makes a browser treat a complete response as partial.
  const { status, headers } = headersFor({ hasRange: true, start: 0, end: 999, size: 1000 });
  assert.strictEqual(status, 200, 'a full-coverage range should answer 200');
  assert.strictEqual(headers['Content-Length'], 1000);
});

// ── derived-file keys ────────────────────────────────────────────────────────

check('a recording and everything derived from it get distinct keys', () => {
  // This was a real overwrite, not a hypothetical. The export key was
  // keyFor(id, fmt), which was safe only while the recorder produced WebM: the
  // original was <id>.webm and the MP4 export <id>.mp4. Chrome has recorded
  // MP4 since 126 and the recorder asks for it first, so the original became
  // <id>.mp4 — and exporting an MP4 recording to MP4 wrote the re-encode over
  // its own source. On the disk store saveFile is a rename, so the capture was
  // gone.
  const id = '0b2f1d44-0000-4000-8000-00000000abcd';
  const keys = {
    'original (mp4 recording)': mediaStore.keyFor(id, 'video/mp4'),
    'original (webm recording)': mediaStore.keyFor(id, 'video/webm'),
    'playback remux (mp4)': `${id}.play.mp4`,
    'playback remux (webm)': `${id}.play.webm`,
    'mp4 export': `${id}.export.mp4`,
    'gif export': `${id}.export.gif`,
  };
  // An mp4 and a webm recording are never the same recording, so compare each
  // original against every derived key rather than against each other.
  const derived = ['playback remux (mp4)', 'playback remux (webm)', 'mp4 export', 'gif export'];
  for (const orig of ['original (mp4 recording)', 'original (webm recording)']) {
    for (const d of derived) {
      assert.notStrictEqual(keys[orig], keys[d],
        `${d} shares a key with the ${orig}: ${keys[orig]} — writing one destroys the other`);
    }
  }
  const derivedKeys = derived.map(d => keys[d]);
  assert.strictEqual(new Set(derivedKeys).size, derivedKeys.length,
    `two derived files share a key: ${derivedKeys.join(', ')}`);
});

check('the export key no longer comes from keyFor', () => {
  // keyFor maps a mime or an extension onto <id>.<ext>, which is the original's
  // namespace. Anything derived needs an infix, so this asserts the export is
  // not built that way any more.
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'services', 'recordingExport.js'), 'utf8');
  assert.ok(/\$\{id\}\.export\.\$\{fmt\}/.test(src),
    'the export key must carry an .export. infix');
  assert.ok(!/const key = mediaStore\.keyFor\(id, fmt\)/.test(src),
    'the export key is back to keyFor(id, fmt), which collides with an MP4 original');
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
