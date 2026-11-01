// The client's approval page shows each post the way the platform will,
// with chips to switch. It used to show a row of thumbnails and the whole
// caption, which tells nobody what survives the "more" cut.
import pw from './pw.mjs';
const { chromium } = pw;
const B = 'http://127.0.0.1:4599';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

// The fixture, so assertions compare rendered text against source data
// rather than against a length threshold.
const SP1 = {
  hook: 'Start with one bed, not the whole garden',
  caption: 'Every client who has ever regretted a garden did the whole thing at once. One bed teaches you the light, the drainage and what the dog walks through, and it costs a tenth of finding out the hard way across four hundred square metres.',
  tags: '#gardendesign #plantingdesign',
};
const FULL = `${SP1.hook}\n\n${SP1.caption}\n\n${SP1.tags}`;

await page.goto(`${B}/approve/tok-social`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

const cards = () => page.locator('.card', { has: page.locator('.adprev') });
ok(await cards().count() === 2, 'each post is previewed in a frame', String(await cards().count()));

const first = cards().first();
const chips = await first.locator('.adprev-chip').allInnerTexts();
ok(chips.length === 5, 'with chips for five surfaces', JSON.stringify(chips));
ok(/instagram feed/i.test(chips.join('|')) && /tiktok/i.test(chips.join('|')) && /linkedin/i.test(chips.join('|')),
   'naming the platforms', JSON.stringify(chips));

// An Instagram post opens on the Instagram feed; a TikTok reel on TikTok.
const active = async (c) => (await c.locator('.adprev-chip.is-active').innerText()).trim();
ok(/instagram feed/i.test(await active(first)), 'an Instagram post opens on the feed', await active(first));
ok(/tiktok/i.test(await active(cards().nth(1))), 'a TikTok reel opens on TikTok', await active(cards().nth(1)));

// What the client sees before "more" is the start of the real caption, cut.
const shown = async (c) => (await c.locator('.adprev-body, .adprev-storyhead').first().innerText()).replace(/… more$/, '').trim();
let body = await shown(first);
ok(FULL.startsWith(body.slice(0, 40)), 'the preview shows the real caption, from the top', JSON.stringify(body.slice(0, 50)));
ok(body.length < FULL.length, 'and cut rather than whole', `${body.length} of ${FULL.length}`);
ok(await first.locator('.adprev-more').count() === 1, 'with a "more" where it cuts');
ok(/something is being cut off/i.test(await first.locator('.adprev-note').innerText()),
   'and the note says so out loud');

// The hook, the caption and the hashtags are clipped as one block, because
// that is what the platform truncates. The hashtags being off the end is
// the point.
ok(body.startsWith(SP1.hook.slice(0, 30)), 'the hook is the first thing clipped against', JSON.stringify(body.slice(0, 30)));
ok(!body.includes('#gardendesign'), 'and the hashtags are already past the cut');

// Switching to LinkedIn shows more of the same caption; to a reel, less.
await first.locator('.adprev-chip', { hasText: /linkedin/i }).click();
await page.waitForTimeout(200);
const onLinkedIn = await shown(first);
ok(onLinkedIn.length > body.length, 'LinkedIn shows more of it', `${onLinkedIn.length} vs ${body.length}`);
await first.locator('.adprev-chip', { hasText: /instagram reel/i }).click();
await page.waitForTimeout(200);
const onReel = await shown(first);
ok(onReel.length < body.length, 'a reel shows less', `${onReel.length} vs ${body.length}`);
ok(FULL.startsWith(onReel.slice(0, 20)), 'and it is still the same caption', JSON.stringify(onReel));

// The frame changes shape with the surface, which is the other half of the
// question a client is answering.
const ratio = async () => page.evaluate(() => {
  const m = document.querySelector('.card .adprev-media');
  return m ? getComputedStyle(m).aspectRatio : null;
});
ok((await ratio()).replace(/\s/g, '') === '9/16', 'the reel frame is vertical', await ratio());
await first.locator('.adprev-chip', { hasText: /instagram feed/i }).click();
await page.waitForTimeout(200);
ok((await ratio()).replace(/\s/g, '') === '1/1', 'and the feed frame is square', await ratio());

// The whole caption is still reachable, because a client signs off all of
// it, and the decision buttons still work.
const cardText = await first.innerText();
ok(/the full caption/i.test(cardText), 'the full caption is still there to open');
ok(/approve/i.test(cardText) && /request changes/i.test(cardText), 'and the decision still sits on the card');

ok(errors.length === 0, 'no page errors', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
