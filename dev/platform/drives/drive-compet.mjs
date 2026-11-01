// Competitors leave Shared's Review screen. The fixture client has no
// competitors and two batches, so before the change Review's own
// headline was "Add 3-10 competitors to start" on a measurement screen.
import pw from './pw.mjs';
const { chromium } = pw;
const B = 'http://127.0.0.1:4599';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto(`${B}/clients/c1/social/review`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const review = await page.evaluate(() => {
  const main = document.querySelector('.app-main');
  const next = [...main.querySelectorAll('.card')].find(c => /next up/i.test(c.innerText));
  return {
    pills: [...main.querySelectorAll('span')]
      .filter(s => /^\s*competitors\b/i.test(s.innerText || ''))
      .map(s => s.innerText.trim()),
    nextHeading: next ? (next.querySelector('h2')?.innerText || '') : null,
    nextActions: next ? [...next.querySelectorAll('button')].map(b => b.innerText.trim()) : [],
    text: main.innerText,
  };
});
ok(review.pills.length === 0, 'Review carries no competitor count', JSON.stringify(review.pills));
ok(review.nextHeading !== null, 'Review still shows what to do next');
ok(!/competitor/i.test(review.nextHeading || ''),
   'and it is not asking for competitor handles', JSON.stringify(review.nextHeading));
ok(/batch(es)? waiting/i.test(review.nextHeading || ''),
   'it is the next real step in the loop', JSON.stringify(review.nextHeading));
ok(!review.nextActions.some(a => /competitor/i.test(a)),
   'no button on Review leads to competitors', JSON.stringify(review.nextActions));
ok(!/whose hooks to model against/i.test(review.text),
   'and the competitors explainer is not repeated here');

// Compare is where they live, unchanged.
await page.goto(`${B}/clients/c1/social/compare`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const compare = await page.evaluate(() => ({
  text: document.querySelector('.app-main').innerText,
  editor: !!document.querySelector('#competitor-editor-anchor'),
}));
ok(compare.editor, 'Compare still holds the competitor editor');
ok(/whose hooks to model against/i.test(compare.text), 'with its heading');
ok(/3–10 competitor handles/i.test(compare.text), 'and the explainer that was on two screens');

// The vault is a screen, so nothing on Shared opens it as a modal any more.
await page.goto(`${B}/clients/c1/social/hook-vault`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const vault = await page.evaluate(() => document.querySelector('.app-main').innerText);
ok(/Every opening line you have written/i.test(vault),
   'the hook vault is still a screen of its own');

ok(errors.length === 0, 'no page errors', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
