/**
 * Shared, captioning a video with the real caption pipeline.
 *
 * This is the join that was missing. Shared's Produce step called HeyGen and
 * ElevenLabs directly and wrote to social_post_media, which carries no client
 * and knows nothing about the caption library, the brand kit or the renderer.
 * So the 31 templates were invisible from the one screen where reels are
 * actually scheduled and published.
 *
 * Needs a database and ffmpeg: every claim here is about what lands in which
 * table and what comes out of the renderer.
 *
 *   DB_HOST=/tmp DB_PORT=55435 DB_NAME=omi DB_USER=postgres node tests/social-captions.db.test.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pool = require('../src/db');
const assets = require('../src/services/assets');
const captions = require('../src/services/captions');
const scr = require('../src/services/socialCaptionRender');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label); failures += 1; }
};

const CLIENT = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const POST = '55555555-5555-4555-8555-555555555555';
const UPLOADS = path.join(__dirname, '..', 'uploads');

const WORDS = [
  { word: 'Fifteen', start: 0.10, end: 0.52 }, { word: 'years', start: 0.52, end: 0.88 },
  { word: 'later', start: 0.88, end: 1.22 }, { word: 'the', start: 1.22, end: 1.36 },
  { word: 'company', start: 1.36, end: 1.90 }, { word: 'creates', start: 1.90, end: 2.32 },
];

async function main() {
  // A four-second clip to caption. Synthetic, because what is under the
  // captions is not what this is testing.
  const dir = path.join(UPLOADS, CLIENT);
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, 'test-source.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'color=c=0x202830:s=1080x1920:d=4:r=30', '-c:v', 'libx264',
    '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', src], { stdio: 'ignore' });

  await pool.query('TRUNCATE client_assets, social_post_media RESTART IDENTITY CASCADE');
  const source = await assets.record({
    client_id: CLIENT, source: 'upload', source_id: 'test-src',
    title: 'Raw cut', url: `/api/brand/file/${CLIENT}/test-source.mp4`, mime: 'video/mp4',
  });
  const { rows } = await pool.query('SELECT * FROM social_posts WHERE id = $1', [POST]);
  const post = rows[0];

  // The accent the kit derives from a client's palette is asserted in
  // tests/captions.test.js, against a palette that test owns. Pinning the hex
  // here as well tied this file to whatever the seed data happens to hold, so
  // the kit is exercised below through `applyKit: true` instead.

  console.log('\nCaptioning a post goes through the same pipeline as Produce');
  const out = await scr.captionForPost({
    post, source, templateId: 'institution', words: WORDS, applyKit: true });
  ok(out.media && out.media.provider === 'captions',
    'the result is attached to the post, marked as ours rather than a provider\'s');
  ok(out.media.metadata.template === 'institution', 'and records which template made it');
  ok(out.words.length === WORDS.length,
    'the timings come back, so a second template on the same video pays Whisper nothing');

  console.log('\nAnd it lands in the library, which is the whole point');
  const lib = await assets.list(CLIENT);
  const made = lib.find((a) => a.source === 'caption_render');
  ok(!!made, 'a reel captioned in Shared is findable from anywhere');
  ok(made.width === 1080 && made.height === 1920, 'with its real dimensions, probed not assumed');
  ok(Number(made.bytes) > 1000, 'and its size');
  ok(made.metadata.post_id === POST, 'and a way back to the post it was made for');

  console.log('\nA template that highlights nothing does not start to');
  // The bug this caught: `institution` was measured from reels with no
  // per-word highlight at all. Letting a client's accent through turned the
  // box under the spoken word orange, which is a creator caption wearing an
  // institution's clothes.
  const mod = await import(require('url').pathToFileURL(
    path.join(__dirname, '..', '..', 'shared', 'captions', 'compile.mjs')).href);
  const skinned = mod.skin(captions.preset('institution'), { font: 'Inter', accent: '#C8701E' });
  ok(skinned.highlightColor === '#000000', 'the accent is refused');
  ok(skinned.fontName === 'Inter', 'but the typeface is still taken, which is the part that should change');
  const wordLevel = mod.skin(captions.preset('hormozi'), { accent: '#C8701E' });
  ok(wordLevel.highlightColor === '#C8701E', 'a word-at-a-time template still takes one');

  console.log('\nAn asset belonging to another client is refused, not rendered');
  // An asset id is guessable, and a post is not a reason to reach into a
  // different account's library.
  const theirs = await assets.record({
    client_id: OTHER, source: 'upload', source_id: 'other-src',
    title: 'Not ours', url: `/api/brand/file/${OTHER}/x.mp4`, mime: 'video/mp4' });
  ok(theirs.client_id === OTHER, 'the other client has an asset');
  // The route does this check; the service would happily render anything it
  // can find on disk, so the guard has to be the one the request passes through.
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'social.js'), 'utf8');
  ok(/belongs to a different client/.test(routes)
    && /a\.client_id !== post\.client_id/.test(routes),
  'and the route refuses it by comparing the owner, not by trusting the id');

  console.log('\nAn unknown template is refused before anything is rendered');
  let refused = null;
  try {
    await scr.captionForPost({ post, source, templateId: 'not-a-template', words: WORDS });
  } catch (e) { refused = e.message; }
  ok(/not-a-template/.test(refused || ''), refused || 'it was not refused');

  console.log('\nA source that is not on disk fails clearly');
  let missing = null;
  try {
    await scr.captionForPost({
      post, source: { url: `/api/brand/file/${CLIENT}/nope.mp4` },
      templateId: 'institution', words: WORDS });
  } catch (e) { missing = e.message; }
  ok(/could not be found/.test(missing || ''), missing || 'it did not fail');

  console.log('\nShared no longer writes media without telling the library');
  // Four producers used to carry four copies of the same insert. One helper
  // now does both halves, so a fifth cannot land in social_post_media alone.
  const inserts = (routes.match(/INSERT INTO social_post_media/g) || []).length;
  ok(inserts === 1, `one insert statement, inside the helper (found ${inserts})`);
  ok((routes.match(/savePostMedia\(post/g) || []).length >= 4,
    'and every producer goes through it');

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  await pool.end();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.log('  FAIL ', e.stack || e.message);
  try { await pool.end(); } catch { /* already closed */ }
  process.exit(1);
});
