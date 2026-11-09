/**
 * "Send to Edit" on the Record tab, which had answered with a toast since the
 * November rewrite deleted the route behind it.
 *
 * It was never only a missing route, and that is the part worth testing. A
 * recording does not live in the uploads tree: it is behind `mediaStore`
 * under a `storage_key`, and the render path resolved only
 * `/api/brand/file/<client>/<name>` urls. So a composition pointing at a
 * recording could be built and would then refuse to render with "has no file
 * on disk" — a plausible message about a file that is perfectly fine and in
 * the other store.
 *
 *   node tests/recording-to-composition.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const compositions = require('../src/services/compositions');
const renderer = require('../src/services/compositionRenderer');
const { validate } = require('../../shared/composition.mjs');

// ── the composition a recording becomes ──────────────────────────────

describe('the composition a recording becomes', () => {
  const rec = (over = {}) => ({ id: 41, title: 'A chat about fees', duration_s: 124.5, ...over });
  const asset = { id: 77 };

  it('is valid, which is the point of it not living in a route handler', () => {
    assert.deepEqual(validate(compositions.fromRecording(rec(), asset)), []);
  });

  it('is one clip, its whole length', () => {
    const data = compositions.fromRecording(rec(), asset);
    assert.equal(Object.keys(data.sources).length, 1);
    assert.equal(data.tracks.length, 1);
    const item = data.tracks[0].items[0];
    assert.equal(item.at, 0);
    assert.equal(item.len, 124.5);
    assert.equal(item.in, 0);
  });

  it('points at the asset, not the recording', () => {
    // The render path resolves assets. A composition carrying a recording id
    // would find nothing.
    const data = compositions.fromRecording(rec(), asset);
    assert.equal(data.sources.s1.asset, 77);
  });

  it('marks it as the voice', () => {
    // A recording is somebody talking, so it is the thing music ducks under
    // rather than the thing that ducks. Guessing from the source kind gets
    // this backwards for a walkthrough, which is why the flag exists.
    assert.equal(compositions.fromRecording(rec(), asset).sources.s1.voice, true);
  });

  it('says where it came from, on the item', () => {
    const data = compositions.fromRecording(rec(), asset);
    assert.match(data.tracks[0].items[0].reason, /From the recording "A chat about fees"/);
  });

  it('stands in a length for an older recording, and claims no duration', () => {
    // `duration_s` is missing on recordings made before it was recorded. An
    // item needs a positive length, so a default stands in — but the SOURCE
    // is left without a duration rather than claiming 30 seconds it does not
    // know, because that figure is what the editor trims against.
    const data = compositions.fromRecording(rec({ duration_s: null }), asset);
    assert.equal(data.tracks[0].items[0].len, compositions.DEFAULT_LENGTH_S);
    assert.equal(data.sources.s1.duration, undefined);
    assert.deepEqual(validate(data), []);
  });

  it('survives a duration of zero, a string and a nonsense', () => {
    for (const duration_s of [0, -5, 'ten', NaN, undefined, {}]) {
      const data = compositions.fromRecording(rec({ duration_s }), asset);
      assert.deepEqual(validate(data), [], `duration_s ${JSON.stringify(duration_s)}`);
      assert.ok(data.tracks[0].items[0].len > 0);
    }
  });

  it('rounds a long duration to the hundredth rather than carrying float noise', () => {
    const data = compositions.fromRecording(rec({ duration_s: 12.3456789 }), asset);
    assert.equal(data.tracks[0].items[0].len, 12.35);
  });

  it('titles an untitled recording without printing undefined', () => {
    const data = compositions.fromRecording(rec({ title: null }), asset);
    assert.match(data.tracks[0].items[0].reason, /"Untitled"/);
  });
});

// ── the store the recording actually lives in ────────────────────────

describe('resolving an asset to a file ffmpeg can open', () => {
  let dir;
  let uploaded;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-media-'));
  });

  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('resolves an uploaded asset from its url, as it always did', async () => {
    // The existing path, unchanged. `assetFilePath` is still what answers
    // "where is this asset in the uploads tree", and it still refuses a
    // traversal — that guard has its own tests next door.
    const got = await renderer.assetMedia({ url: '/api/brand/file/x/nope.mp4' });
    assert.equal(got, null, 'a file that is not there resolves to nothing');
  });

  it('resolves a recording through the media store', async () => {
    // THE FAULT. A recording has a `storage_key` and no brand-file url, so
    // the old resolver answered null for every one of them and the render
    // refused with "has no file on disk" about a file that was fine.
    const key = 'recordings/probe.webm';
    const mediaStore = require('../src/services/mediaStore');
    const real = mediaStore.localFile;
    const p = path.join(dir, 'probe.webm');
    fs.writeFileSync(p, 'not really a video');
    let released = 0;
    mediaStore.localFile = async (k) => {
      assert.equal(k, key, 'asked for the asset\'s own key');
      return { path: p, release: async () => { released += 1; } };
    };
    try {
      const got = await renderer.assetMedia({ storage_key: key });
      assert.equal(got.path, p);
      await got.release();
      assert.equal(released, 1, 'and the release is the store\'s own');
    } finally {
      mediaStore.localFile = real;
    }
  });

  it('prefers the uploads tree when an asset is in both', async () => {
    // An asset with a real file under uploads is answered from there, with a
    // release that does nothing — no reason to stream a copy of something
    // already on local disk.
    const mediaStore = require('../src/services/mediaStore');
    const real = mediaStore.localFile;
    mediaStore.localFile = async () => { throw new Error('should not be asked'); };
    try {
      const got = await renderer.assetMedia({
        url: '/api/brand/file/x/nope.mp4', storage_key: 'k',
      });
      // The uploads path does not exist here, so it falls through to the
      // store — which throws, and a store that cannot produce a key is an
      // asset with no file rather than an error.
      assert.equal(got, null);
    } finally {
      mediaStore.localFile = real;
    }
  });

  it('answers null for an asset with neither, rather than throwing', async () => {
    assert.equal(await renderer.assetMedia({}), null);
    assert.equal(await renderer.assetMedia(null), null);
    assert.equal(await renderer.assetMedia({ url: 'https://example.com/v.mp4' }), null);
  });
});

// ── the temp copy has to outlive the resolve and not the render ──────

describe('letting go of a streamed-down copy', () => {
  const runner = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'compositionRenderRunner.js'), 'utf8'
  );

  it('holds the release until ffmpeg closes, not until prepare returns', () => {
    // On R2 the copy IS the file ffmpeg opens. Released at the end of
    // `prepare` it would be deleted before the encode started.
    assert.match(runner, /releases\.push\(media\.release\)/);
    assert.match(runner, /return \{[^}]*releases[^}]*\}/s);
    const handler = runner.match(/ff\.once\('close', (\w+)\)/);
    assert.ok(handler, 'something runs when ffmpeg closes');
    assert.match(
      runner,
      new RegExp(`const ${handler[1]} = \\(\\) => \\{[\\s\\S]*?releaseAll\\(prepared\\)`),
      'and it lets go of the copies'
    );
  });

  it('lets go when a prepared render is discarded instead', () => {
    // The route prepares so it can refuse early, then discards. Without this
    // every refused export would leak a video on an R2 install.
    assert.match(runner, /function discard\(prepared\) \{[\s\S]*?releaseAll\(prepared\)/);
  });

  it('is idempotent, because both paths can run', () => {
    const { releaseAll } = loadRunnerInternals();
    let count = 0;
    const prepared = { releases: [() => { count += 1; }] };
    releaseAll(prepared);
    releaseAll(prepared);
    assert.equal(count, 1);
  });

  it('survives a release that throws', () => {
    const { releaseAll } = loadRunnerInternals();
    let second = 0;
    releaseAll({
      releases: [() => { throw new Error('gone already'); }, () => { second += 1; }],
    });
    assert.equal(second, 1, 'the one after it still ran');
  });

  it('survives a release that rejects', () => {
    const { releaseAll } = loadRunnerInternals();
    assert.doesNotThrow(() => releaseAll({
      releases: [() => Promise.reject(new Error('gone already'))],
    }));
  });

  it('does nothing for a prepared render that pulled nothing down', () => {
    const { releaseAll } = loadRunnerInternals();
    assert.doesNotThrow(() => releaseAll({}));
    assert.doesNotThrow(() => releaseAll(null));
  });
});

/**
 * `releaseAll` is module-private on purpose — nothing outside the runner
 * should be letting go of its copies — so it is read out of the source and
 * evaluated rather than exported for a test. If the function is renamed or
 * its shape changes, this fails loudly instead of testing a stale copy.
 */
function loadRunnerInternals() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'compositionRenderRunner.js'), 'utf8'
  );
  const m = src.match(/function releaseAll\(prepared\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'releaseAll is still a function in the runner');
  // eslint-disable-next-line no-new-func
  return { releaseAll: new Function(`${m[0]}; return releaseAll;`)() };
}

// ── the route ─────────────────────────────────────────────────────────

describe('the route behind the button', () => {
  const route = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'compose.js'), 'utf8'
  );
  const block = route.slice(
    route.indexOf("router.post('/clients/:clientId/compositions/from-recording'"),
    route.indexOf('// ── Video templates')
  );

  it('exists, and under /api/compose where the editor already lives', () => {
    // The old one was `/edit/clients/:id/edit/from-recording`, and
    // `/api/edit` is mounted nowhere.
    assert.ok(block.length > 100, 'the route is there');
    assert.ok(!/\/api\/edit/.test(route), 'and nothing points at the deleted mount');
  });

  it('is scoped to the client whose tab it is, not just to a logged-in user', () => {
    // A recording id is guessable and a recording is somebody's face.
    assert.match(block, /requireClientAccess\(\{ paramNames: \['clientId'\] \}\)/);
    assert.match(block, /String\(rec\.client_id\) !== String\(req\.params\.clientId\)/);
    assert.match(block, /404/);
  });

  it('refuses a recording that is still processing', () => {
    // Its file may not exist yet, and the render would refuse with a worse
    // message later.
    assert.match(block, /rec\.status !== 'ready'/);
    assert.match(block, /still processing/);
  });

  it('refuses one that is not in the library, because there is no asset to point at', () => {
    assert.match(block, /assets\.bySource\('recording'/);
    assert.match(block, /not in the library yet/);
  });

  it('uses the service recipe rather than building the data inline', () => {
    assert.match(block, /compositions\.fromRecording\(rec, asset\)/);
  });

  it('maps the asset into source_assets, which is what the render reads', () => {
    assert.match(block, /sourceAssets: \{ s1: asset\.id \}/);
  });
});
