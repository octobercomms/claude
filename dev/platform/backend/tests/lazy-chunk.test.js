// A deploy landing under an open tab must not leave a blank error screen.
//
// Six entries in the error digest for 31 October, six different pages, one
// cause: "Failed to fetch dynamically imported module". Every stack carries a
// different index-*.js hash, so that is six separate deploys. Someone has OMI
// open; we deploy; Vite writes new chunks with new content hashes and stops
// serving the old ones; they click through to a page they have not visited
// this session; the browser asks for the chunk the old index.html named, gets
// a 404, and the route throws into the error boundary.
//
// Nothing is wrong with the app and nothing they did caused it.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

const util = read('src/utils/lazyChunk.js');
const app = read('src/App.jsx');
const videoTab = read('src/pages/ClientVideoTab.jsx');

ok('every lazy route goes through it', () => {
  // A route still on bare React.lazy is a route that still shows the blank
  // screen, and it will be the one nobody tested.
  const bare = app.split('\n').filter((l) => /\blazy\(/.test(l) && !/lazyChunk\(/.test(l));
  assert.deepStrictEqual(bare, [], `App.jsx still has bare lazy(): ${bare.join(' | ')}`);
  const count = (app.match(/lazyChunk\(/g) || []).length;
  assert.ok(count >= 27, `all the routes are wrapped (${count})`);
  assert.ok(!/\blazy\b/.test(videoTab.split('\n')[0]), 'and the nested one does not import lazy any more');
  assert.ok(/lazyChunk\('ClientDesignPage'/.test(videoTab), 'the Design page is nested inside Video, and was in the digest too');
});

ok('each wrapper gets a name that survives the reload', () => {
  // The marker is read back after the page reloads, so it cannot be the
  // hashed filename — that is the thing that changed.
  const names = [...app.matchAll(/const (\w+) = lazyChunk\('(\w+)'/g)];
  assert.ok(names.length >= 27);
  for (const [, varName, label] of names) {
    assert.strictEqual(varName, label, `${varName} is labelled with its own name`);
  }
  const unique = new Set(names.map((m) => m[2]));
  assert.strictEqual(unique.size, names.length, 'no two chunks share a marker');
});

ok('only a failed import triggers a reload', () => {
  // An error thrown by the module's own top-level code looks similar and is
  // not fixed by reloading; reloading would hide it.
  assert.ok(/if \(!isChunkLoadError\(err\)\) throw err;/.test(util));
  const detect = util.slice(util.indexOf('export function isChunkLoadError'), util.indexOf('export function lazyChunk'));
  for (const sig of ['Failed to fetch dynamically imported module',
    'error loading dynamically imported module',
    'Importing a module script failed',
    'is not a valid JavaScript MIME type']) {
    assert.ok(detect.includes(sig), `recognises: ${sig}`);
  }
});

ok('it retries once before reloading anything', () => {
  // A dropped request on a flaky connection looks exactly like a stale chunk
  // and costs nothing to rule out.
  const fn = util.slice(util.indexOf('export function lazyChunk'));
  const loads = (fn.match(/await loader\(\)/g) || []).length;
  assert.strictEqual(loads, 2, 'the original attempt and one retry');
  const reload = fn.indexOf('window.location.replace');
  assert.ok(reload > fn.lastIndexOf('await loader()'), 'and the reload comes after both');
});

ok('it cannot loop', () => {
  const fn = util.slice(util.indexOf('export function lazyChunk'));
  assert.ok(/if \(wasMarked\(name\)\)/.test(fn), 'a chunk that is genuinely missing reloads once');
  assert.ok(/throw second;/.test(fn), 'and then surfaces the real error');
  assert.ok(/clearMark\(name\)/.test(fn), 'and a success clears the marker');
  const marks = (fn.match(/clearMark\(name\)/g) || []).length;
  assert.ok(marks >= 3, 'cleared on both successes and on giving up');
});

ok('storage that throws does not take the page down with it', () => {
  // Private windows and blocked site data both throw on access.
  const helpers = ['function mark(', 'function wasMarked(', 'function clearMark('];
  for (let i = 0; i < helpers.length; i += 1) {
    const from = util.indexOf(helpers[i]);
    assert.ok(from > 0, `${helpers[i]} exists`);
    const next = i + 1 < helpers.length ? util.indexOf(helpers[i + 1]) : util.indexOf('export function isChunkLoadError');
    const body = util.slice(from, next);
    assert.ok(/catch/.test(body), `${helpers[i]} tolerates storage throwing`);
    assert.ok(/sessionStorage/.test(body));
  }
});

ok('the reload goes to the network for a fresh index.html', () => {
  const fn = util.slice(util.indexOf('export function lazyChunk'));
  assert.ok(/window\.location\.replace\(window\.location\.href\)/.test(fn),
    'location.reload() can re-serve the cached index.html, which names the same missing chunk');
  assert.ok(/return new Promise\(\(\) => \{\}\)/.test(fn),
    'and nothing renders in the frame before the page goes');
});

console.log(`lazy-chunk      ✓ ${passed} assertions passed`);
