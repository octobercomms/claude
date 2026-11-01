// What a client downloads when they click a video share link.
//
// WatchPage used to be a static import in App.jsx, which put it in the main
// bundle alongside every OMI screen. Opening /watch/:token meant fetching
// 2.69MB of JavaScript (718KB gzipped) and parsing it before the <video>
// element existed. None of that code runs on that page. Measured after the
// split: 287KB raw, 83KB gzipped, one chunk.
//
// Two things have to hold, and they pull in opposite directions:
//
//   - the admin pages must stay OUT of the entry chunk, or the weight comes
//     straight back the first time someone adds `import SettingsPage from …`
//     at the top of App.jsx, with every test still green;
//   - WatchPage must stay IN it, because making the player itself lazy trades
//     the bundle weight for an extra round trip before the video can start,
//     which is the thing being fixed.
//
// The byte budget is deliberately loose. It is there to catch a regression of
// the old order of magnitude, not to police ordinary growth.
//
//   node --test tests/shareLinkWeight.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.join(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const appSrc = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');

// Pages that load with the app itself: how someone arrives. Everything else in
// src/pages must be a lazy chunk.
const EAGER = new Set(['LoginPage', 'HomePage', 'WatchPage']);

// Generous: about five times the measured 83KB, and under an eighth of the
// 718KB this replaced.
const GZIP_BUDGET = 400 * 1024;

test('only the three arrival pages are statically imported by App.jsx', () => {
  const statics = [...appSrc.matchAll(/^import\s+(\w+)\s+from\s+'\.\/pages\/[^']+';/gm)]
    .map(m => m[1]);
  const unexpected = statics.filter(n => !EAGER.has(n));
  assert.deepStrictEqual(unexpected, [],
    `these pages are in the entry bundle, so every share-link visitor downloads them: ${unexpected.join(', ')}. `
    + 'Make them lazy(() => import(...)) like the rest.');
  for (const name of EAGER) {
    assert.ok(statics.includes(name),
      `${name} is no longer statically imported. If that is deliberate, move it out of EAGER here `
      + '— but a lazy WatchPage costs the share link a round trip before the video starts.');
  }
});

test('the admin pages are lazy, and Layout with them', () => {
  // Layout matters as much as the pages: it pulls in the section panel, the
  // nav table and the chart primitives, none of which a player page touches.
  // lazyChunk, not React.lazy directly: same split, plus a reload when the
  // chunk has gone because a deploy landed under an open tab. Still a chunk,
  // which is what this test is about.
  for (const name of ['Layout', 'SettingsPage', 'ClientSEOPage', 'ClientPRPage', 'ClientSocialPage']) {
    assert.ok(new RegExp(`const ${name} = lazyChunk\\('${name}', \\(\\) => import\\(`).test(appSrc),
      `${name} must be a lazy chunk; it is dead weight on every public page`);
  }
});

test('the build splits into chunks rather than one bundle', () => {
  assert.ok(fs.existsSync(dist), 'no dist/ — run the build before this test');
  const chunks = fs.readdirSync(path.join(dist, 'assets')).filter(f => f.endsWith('.js'));
  assert.ok(chunks.length >= 20,
    `only ${chunks.length} JS chunks; the route split is not happening and everything is in one file`);
});

test('a share-link visitor stays inside the byte budget', () => {
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  // Everything index.html pulls in up front: the entry script and its CSS.
  const entry = [...html.matchAll(/<(?:script[^>]*src|link[^>]*href)="\/?(assets\/[^"]+)"/g)]
    .map(m => m[1]);
  assert.ok(entry.length > 0, 'found no entry assets in index.html — did the matcher stop matching?');

  let gz = 0, raw = 0;
  for (const f of entry) {
    const b = fs.readFileSync(path.join(dist, f));
    raw += b.length;
    gz += zlib.gzipSync(b, { level: 9 }).length;
  }
  assert.ok(gz <= GZIP_BUDGET,
    `the entry bundle is ${(gz / 1024).toFixed(0)}KB gzipped (${(raw / 1024).toFixed(0)}KB raw), over the `
    + `${(GZIP_BUDGET / 1024).toFixed(0)}KB budget. Something large is being imported statically by App.jsx `
    + 'or by one of the three arrival pages, and every share-link visitor is paying for it.');
});

test('the player gets its source from the token, not from the metadata response', () => {
  // Waiting for /api/public/watch/:token before setting src meant the video
  // request could not start until a round trip had completed, on top of the
  // chunk fetch. The URL is derivable, so it is derived.
  const watch = fs.readFileSync(path.join(root, 'src', 'pages', 'WatchPage.jsx'), 'utf8');
  assert.ok(/src=\{streamUrl\(token\)\}/.test(watch),
    'the <video> src must come from streamUrl(token)');
  assert.ok(!/src=\{meta\.stream_url\}/.test(watch),
    'the <video> src is back to waiting on the metadata fetch');
  // And the player must not be gated behind the metadata arriving.
  assert.ok(!/!meta \?[\s\S]{0,400}<video/.test(watch),
    'the <video> is rendered only after meta lands, which is the round trip this removed');
});
