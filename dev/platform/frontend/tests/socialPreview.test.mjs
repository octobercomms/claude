// The social approval preview, read off its own source. The component
// imports React, so the pure parts are checked by reading the file rather
// than by importing it, the same way the other preview tests here do.
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'src', 'components', 'SocialPlatformPreview.jsx'), 'utf8');

// --- the surfaces a client can switch between -----------------------------
const surfaces = [...src.matchAll(/^  ([a-z_]+):\s*\{$/gm)].map(m => m[1]);
assert.deepStrictEqual(surfaces, ['instagram_feed', 'instagram_reel', 'tiktok', 'linkedin_feed', 'facebook_feed'],
  `the five organic surfaces, in order: ${surfaces.join(', ')}`);

// Every surface carries the three things that change a decision: the shape,
// where the caption clips, and a sentence saying what it approximates.
for (const key of surfaces) {
  const block = src.slice(src.indexOf(`  ${key}: {`));
  const body = block.slice(0, block.indexOf('\n  },'));
  assert.match(body, /ratio: '/, `${key} declares its shape`);
  assert.match(body, /limit: \d+/, `${key} declares where the caption clips`);
  assert.match(body, /note: '[^']{20,}/, `${key} says what it is approximating`);
}

// The feed figure is the one every source agrees on, and the one the ad
// preview beside this already uses. The vertical surfaces clip far shorter,
// which is the whole reason for switching between them.
const limitOf = (key) => {
  const block = src.slice(src.indexOf(`  ${key}: {`));
  return Number(/limit: (\d+)/.exec(block.slice(0, block.indexOf('\n  },')))[1]);
};
assert.strictEqual(limitOf('instagram_feed'), 125, 'the Instagram feed clips at 125');
assert.strictEqual(limitOf('facebook_feed'), 125, 'and so does Facebook');
assert.ok(limitOf('instagram_reel') < 80, `a reel clips far shorter, not ${limitOf('instagram_reel')}`);
assert.ok(limitOf('tiktok') < 80, `and so does TikTok, not ${limitOf('tiktok')}`);
assert.ok(limitOf('linkedin_feed') > 125, `LinkedIn runs longer than a feed post, not ${limitOf('linkedin_feed')}`);

// --- the caption is one block, not three fields ---------------------------
// What a platform truncates is hook + caption + hashtags together. Clipping
// the caption field alone would show a client 125 characters that the
// hashtags have already pushed off the screen.
const caption = src.slice(src.indexOf('export function captionText'), src.indexOf('export function bestMediaFor'));
assert.match(caption, /post\?\.hook/, 'the hook is part of what gets clipped');
assert.match(caption, /post\?\.caption/, 'so is the caption');
assert.match(caption, /hashtags/, 'and so are the hashtags');
assert.match(caption, /caption !== hook/, 'a caption that repeats the hook is not shown twice');

// --- the chips open on the platform the post was written for --------------
const dflt = src.slice(src.indexOf('export function defaultSurfaceFor'), src.indexOf('// What the platform actually'));
for (const [platform, surface] of [['tiktok', 'tiktok'], ['linkedin', 'linkedin_feed'], ['facebook', 'facebook_feed']]) {
  assert.ok(dflt.includes(`'${platform}'`) && dflt.includes(`'${surface}'`),
    `a ${platform} post opens on ${surface}`);
}
assert.match(dflt, /kind === 'reel' \? 'instagram_reel' : 'instagram_feed'/,
  'an Instagram reel opens on the reel, not the square');

// --- a 9:16 surface prefers the video -------------------------------------
const media = src.slice(src.indexOf('export function bestMediaFor'));
assert.match(media, /tall && videos\.length/, 'a vertical surface shows the video where one exists');
assert.match(media, /image_urls/, 'and falls back to the stills the post already had');

// --- the approval page uses it --------------------------------------------
const approve = fs.readFileSync(path.join(here, '..', 'src', 'pages', 'ApprovePage.jsx'), 'utf8');
assert.match(approve, /<SocialPlatformPreview post=\{post\}/, 'the approval page shows posts in situ');
assert.ok(!/post\.hook\}<\/div>/.test(approve),
  'and no longer prints the hook as a bare heading above the whole caption');

console.log(`ok  social preview: ${surfaces.length} surfaces, clipping and defaults`);
