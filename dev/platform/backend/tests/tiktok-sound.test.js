/**
 * The link on a trending sound.
 *
 * Three URLs hang off one sound and only one of them opens. `playUrl` is
 * TikTok's audio CDN: signed, referrer-checked, short-lived, so following it
 * answers "access denied". The /music/ page is a real page. The ingest was
 * corrected to store the page, which fixed every sound fetched afterwards
 * and nothing fetched before — snapshots are JSONB blobs written once and
 * never revisited. Hence "one of them opened. the others are all access
 * denied", which is what a mix of old and new rows looks like.
 *
 * So the link is derived on the way out from the id and title every row
 * already holds, and these assert that no stored value can reintroduce a
 * link that does not open.
 *
 *   node tests/tiktok-sound.test.js
 */
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const SHARED = path.join(__dirname, '..', '..', 'shared', 'tiktokSound.mjs');
let T;
test.before(async () => { T = await import(pathToFileURL(SHARED).href); });

const CDN = 'https://v16-webapp.tiktokcdn.com/aweme/720p/x.mp3?sig=abc&expires=1';

test('an audio CDN link is never used as the link to open', () => {
  const s = T.normaliseSound({ id: '7123', title: 'Cool Song', tiktok_url: CDN });
  assert.ok(!/tiktokcdn/.test(s.tiktok_url), `a CDN link survived: ${s.tiktok_url}`);
  assert.match(s.tiktok_url, /^https:\/\/www\.tiktok\.com\/music\//);
});

test('and it is kept, separately, because it is the only thing that could play', () => {
  const s = T.normaliseSound({ id: '7123', title: 'Cool Song', tiktok_url: CDN, playUrl: CDN });
  assert.equal(s.audio_url, CDN, 'the stream is not thrown away, it is just not the link');
});

test('a stored music page is believed', () => {
  const page = 'https://www.tiktok.com/music/Already-Right-99';
  assert.equal(T.normaliseSound({ id: '99', title: 'Already Right', tiktok_url: page }).tiktok_url, page);
});

test('a row from an older shape still gets a working link', () => {
  // The snapshots that caused the complaint: no tiktok_url at all, or one
  // from a shape that predates the field.
  assert.match(T.normaliseSound({ id: '55', title: 'Old Row' }).tiktok_url, /music\/Old-Row-55$/);
  assert.match(T.normaliseSound({ musicId: '56', musicName: 'Older Row' }).tiktok_url, /music\/Older-Row-56$/);
});

test('no id means no link, rather than one that 404s', () => {
  assert.equal(T.musicPageUrl(null, 'Whatever'), null);
  assert.equal(T.musicPageUrl('', 'Whatever'), null);
  assert.equal(T.normaliseSound({ title: 'No Id' }).tiktok_url, null);
});

test('a title with spaces, slashes or a question mark still builds one URL', () => {
  const url = T.musicPageUrl('7', 'What? / Who  Knows');
  assert.ok(!url.includes(' '), `a space survived: ${url}`);
  assert.equal(url.split('?').length, 1, `a query string appeared: ${url}`);
  assert.match(url, /-7$/, 'and the id is still on the end, which is what resolves it');
});

test('a missing title does not produce a link ending in undefined', () => {
  const url = T.musicPageUrl('7', null);
  assert.ok(!/undefined|null/.test(url), url);
  assert.match(url, /-7$/);
});

test('the search term is the thing you actually type to use the sound', () => {
  assert.equal(T.searchTerm({ title: 'Cool Song', author: 'Artist' }), 'Cool Song Artist');
  assert.equal(T.searchTerm({ title: 'Cool Song' }), 'Cool Song');
  assert.equal(T.searchTerm({}), null, 'and nothing, rather than an empty string to render');
});

test('a list survives rubbish in it', () => {
  const out = T.normaliseSounds([null, 'nope', { id: '1', title: 'Fine' }, undefined]);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Fine');
  assert.deepEqual(T.normaliseSounds(null), []);
});

test('isMusicPage is strict about what it believes', () => {
  assert.equal(T.isMusicPage('https://www.tiktok.com/music/X-1'), true);
  assert.equal(T.isMusicPage('https://tiktok.com/music/X-1'), true);
  assert.equal(T.isMusicPage('https://www.tiktok.com/@someone/video/1'), false,
    'a video link is not a sound page');
  assert.equal(T.isMusicPage(CDN), false);
  assert.equal(T.isMusicPage(''), false);
  assert.equal(T.isMusicPage(null), false);
});

test('the read path normalises, which is what fixes snapshots already taken', () => {
  const src = require('fs').readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'social.js'), 'utf8');
  // The exact line, not a window around the function name: a loose window
  // matched the refresh path further down and the assertion survived the
  // read path being reverted, which is the one thing it exists to catch.
  assert.match(src, /return normaliseSounds\(Array\.isArray\(all\) \? all\.slice\(0, limit\) : \[\]\);/,
    'getRecentTrendingSounds returns stored sounds through the normaliser');
  assert.match(src, /const sounds = normaliseSounds\(fetched\)/,
    'and so does the refresh, so a stored snapshot and a derived one agree');
});
