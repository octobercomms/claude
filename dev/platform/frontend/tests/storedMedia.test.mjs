// Which media is kept here, and which is still on a provider's CDN.
//
// Two screens offer to keep older media, and both offers have to disappear
// once there is nothing left to keep. Getting this wrong is quiet in both
// directions: too strict and the panel offers to save files that are already
// safe, too loose and it never offers at all while reels play blank.
//
//   node --test tests/storedMedia.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isStored, unstoredItems } from '../src/utils/storedMedia.js';

test('a file served by this platform is kept', () => {
  assert.equal(isStored('/api/brand/file/c1/render.png'), true);
  assert.equal(isStored('/api/brand/file/c1/reel.mp4'), true);
  // The approval view rewrites a local path onto its public token route. It
  // is the same file and there is nothing left to fetch.
  assert.equal(isStored('/api/approvals/public/abc/file/render.png'), true);
  assert.equal(isStored('/api/edit/file/c1/clip.mp4'), true);
  assert.equal(isStored('/api/visualise/file/c1/frame.png'), true);
});

test('a provider URL is not kept', () => {
  assert.equal(isStored('https://cdn.ideogram.ai/abc.png'), false);
  assert.equal(isStored('https://replicate.delivery/pbxt/abc/out.mp4'), false);
  assert.equal(isStored('https://files2.heygen.ai/aws_pacific/avatar_tmp/x.mp4?Expires=1'), false);
  assert.equal(isStored('https://v16m.tiktokcdn.com/audio.mp3'), false);
});

test('an API path that is not a file is not mistaken for one', () => {
  // The old test was `startsWith('/api/')`, which would call any API path
  // stored media — including the ad-creative endpoints themselves.
  assert.equal(isStored('/api/ad-creatives/creatives/abc'), false);
  assert.equal(isStored('/api/heygen/clients/c1/heygen/reels'), false);
});

test('nothing is not kept, and is not unkept either', () => {
  assert.equal(isStored(''), false);
  assert.equal(isStored(null), false);
  assert.equal(isStored(undefined), false);
});

test('only the provider-hosted items are offered for keeping', () => {
  const images = [
    { id: 1, url: '/api/brand/file/c1/a.png' },
    { id: 2, url: 'https://cdn.ideogram.ai/b.png' },
    { id: 3, url: 'https://replicate.delivery/c.mp4' },
  ];
  assert.deepEqual(unstoredItems(images).map(i => i.id), [2, 3]);
});

test('an item with no URL is not offered', () => {
  // A render in progress. Offering to keep it would promise to save a file
  // that does not exist yet.
  const reels = [
    { id: 1, video_url: null },
    { id: 2, video_url: '' },
    { id: 3, video_url: 'https://files2.heygen.ai/x.mp4' },
  ];
  assert.deepEqual(unstoredItems(reels, r => r.video_url).map(r => r.id), [3]);
});

test('an empty list offers nothing', () => {
  assert.deepEqual(unstoredItems([]), []);
  assert.deepEqual(unstoredItems(null), []);
  assert.deepEqual(unstoredItems(undefined), []);
});

// ─── The call sites use it ────────────────────────────────────────────────
// A shared rule that one panel still implements inline is not shared. Both
// files are read with comments stripped, because each explains the old
// `startsWith('/api/')` it replaced and the explanation would satisfy a
// naive search.
function codeOf(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('both panels ask the shared rule rather than testing the URL themselves', () => {
  for (const f of [
    '../src/components/HeygenReelsPanel.jsx',
    '../src/components/paid/PaidLaunchStep.jsx',
  ]) {
    const src = codeOf(f);
    assert.match(src, /unstoredItems\(/, f);
    assert.doesNotMatch(src, /startsWith\('\/api\/'\)/, f);
  }
});

test('the reels panel only offers finished reels', () => {
  const src = codeOf('../src/components/HeygenReelsPanel.jsx');
  assert.match(src, /status === 'completed'/);
});
