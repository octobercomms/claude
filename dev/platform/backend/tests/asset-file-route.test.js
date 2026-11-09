/**
 * An asset's bytes, for a browser.
 *
 * The composition editor draws a source from a url, and
 * `compositions.fromRecording` writes a source with an `asset` and no url,
 * because a recording lives behind `mediaStore` under a storage key and has
 * none. So "Send to Edit" on the Record tab opened a correct timeline over a
 * BLACK player while the render was fine — the renderer has resolved by asset
 * id through `assetMedia` since that bug was found on its side.
 *
 * This is the browser's half. It matters past recordings: anything picked
 * from the library is an id rather than a path, so every future way into a
 * composition reproduces the fault without it. The media bin is next.
 *
 *   node tests/asset-file-route.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '../src/routes/assets.js'), 'utf8');
const editor = fs.readFileSync(path.join(__dirname,
  '../../frontend/src/pages/CompositionEditorPage.jsx'), 'utf8');
const compositions = fs.readFileSync(path.join(__dirname, '../src/services/compositions.js'), 'utf8');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

ok('the fault is still there to fix', () => {
  // The measurement, rather than the memory of it. If `fromRecording` ever
  // starts writing a url, the editor's fallback stops being load-bearing and
  // somebody should be told rather than left guessing why it exists.
  const fn = compositions.slice(compositions.indexOf('function fromRecording'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(/asset: asset\.id/.test(body), 'fromRecording no longer writes an asset id');
  assert.ok(!/url:/.test(body),
    'fromRecording now writes a url, so the editor fallback below may be dead code');
});

ok('the editor resolves a source with no url by its asset', () => {
  assert.ok(/else if \(src\.asset\) urls\[sid\] = `\/api\/assets\/\$\{src\.asset\}\/file`/.test(editor),
    'the editor no longer falls back to the asset route, so a recording draws black');
  // The url wins when both exist: it is what every existing composition
  // carries and it avoids a redirect on the common case.
  // Sliced forward from the loop rather than to the next `setSourceUrls`:
  // that name first appears in the useState declaration far above, so the
  // backwards slice was empty and both indexOf calls returned -1, which
  // compared as false and failed for the wrong reason.
  const at = editor.indexOf('const urls = {};');
  assert.ok(at > 0, 'the source url loop is gone');
  const load = editor.slice(at, at + 700);
  assert.ok(load.indexOf('if (src.url)') < load.indexOf('else if (src.asset)'),
    'the asset route is tried before the url, which adds a redirect to every clip');
});

ok('the route exists, is guarded, and serves inline', () => {
  assert.ok(/router\.get\('\/assets\/:id\/file', assetAccess/.test(route),
    'the file route is gone, or no longer behind assetAccess — an asset belongs '
    + 'to exactly one client and that middleware is the whole tenancy check');
  const fn = route.slice(route.indexOf("router.get('/assets/:id/file'"));
  const body = fn.slice(0, fn.indexOf('\n});'));
  assert.ok(/Content-Disposition', 'inline'/.test(body),
    'serving as an attachment means a <video src> downloads instead of playing');
  assert.ok(/X-Content-Type-Options', 'nosniff'/.test(body),
    'without nosniff a file whose stored mime is wrong can be reinterpreted');
  assert.ok(/res\.redirect\(asset\.url\)/.test(body),
    'an uploaded asset should redirect to the path it already has rather than '
    + 'adding a second way of serving the uploads tree');
});

ok('it honours a range, so the scrub bar works', () => {
  const fn = route.slice(route.indexOf("router.get('/assets/:id/file'"));
  const body = fn.slice(0, fn.indexOf('\n});'));
  assert.ok(/req\.headers\.range/.test(body), 'the range header is ignored');
  assert.ok(/openRead\(asset\.storage_key, range\)/.test(body),
    'the range is not passed to the store, so a <video> cannot seek');
  assert.ok(/res\.status\(206\)/.test(body) && /Content-Range/.test(body),
    'a ranged read must answer 206 with Content-Range, or the browser treats '
    + 'the partial body as the whole file');
  assert.ok(/Accept-Ranges', 'bytes'/.test(body),
    'without Accept-Ranges a browser will not try to seek at all');
});

ok('an asset with neither a url nor a key is refused rather than crashed', () => {
  const fn = route.slice(route.indexOf("router.get('/assets/:id/file'"));
  const body = fn.slice(0, fn.indexOf('\n});'));
  assert.ok(/if \(!asset\.storage_key\) return res\.status\(404\)/.test(body),
    'a row with no file would fall through to openRead(undefined)');
});

console.log(`${passed} guards`);
console.log('---');
console.log('THE EDITOR CAN SEE WHAT IT OWNS');
