// Unticking a post on Shared's Review step takes it out of the steps that
// follow. The fixture batch holds two posts, sp1 (instagram) and sp2
// (tiktok), both ticked when the batch opens.
import pw from './pw.mjs';
const { chromium } = pw;
const B = 'http://127.0.0.1:4599';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const boxes = () => page.locator('.app-main input[type="checkbox"][aria-label^="Include post"]');
const mainText = () => page.evaluate(() => document.querySelector('.app-main').innerText);
const dlLabel = () => page.evaluate(() => {
  const b = [...document.querySelectorAll('.app-main button')].find(x => /download/i.test(x.innerText));
  return b ? { label: b.innerText.trim(), disabled: b.disabled } : null;
});

await page.goto(`${B}/clients/c1/social/brief`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);

ok(await boxes().count() === 2, 'every post on Review has a tick', String(await boxes().count()));
ok((await boxes().nth(0).isChecked()) && (await boxes().nth(1).isChecked()),
   'and a batch opens with all of them ticked');
ok(/2 of 2 posts going forward/i.test(await mainText()),
   'the count says what goes to the next step');
ok(/only take the ticked posts/i.test(await mainText()),
   'and Review says what the ticks control');

// Untick the tiktok one.
await boxes().nth(1).click();
await page.waitForTimeout(300);
let text = await mainText();
ok(/1 of 2 posts going forward/i.test(text), 'unticking one drops the count', text.match(/\d of \d posts going forward/i)?.[0]);
ok(await boxes().nth(0).isChecked() && !(await boxes().nth(1).isChecked()),
   'and leaves the other one ticked');

// Schedule carries the subset through.
await page.goto(`${B}/clients/c1/social/schedule`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
let dl = await dlLabel();
ok(/1 of 2 posts/i.test(dl?.label || ''), 'Schedule names the subset on the download', JSON.stringify(dl));
ok(dl?.disabled === false, 'and the download is live');

// And the download asks the server for only that post.
await page.evaluate(() => {
  [...document.querySelectorAll('.app-main button')].find(x => /download/i.test(x.innerText))?.click();
});
await page.waitForTimeout(1200);
const asked = await page.evaluate(async () => (await fetch('/__last-social-export')).json());
ok(asked && asked.ids.length === 1 && asked.ids[0] === 'sp1',
   'the export request carries just the ticked post', JSON.stringify(asked));

// Ticking everything back asks for the whole batch, with no filter at all.
await page.goto(`${B}/clients/c1/social/brief`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
// page.goto is a full reload, so this is the refresh case: the ticks are
// persisted, not held in a component that unmounts.
ok(await boxes().nth(1).isChecked() === false, 'the ticks survive a reload');
await page.locator('.app-main button', { hasText: /^Tick all$/ }).click();
await page.waitForTimeout(300);
ok(/2 of 2 posts going forward/i.test(await mainText()), 'Tick all brings them back');
await page.goto(`${B}/clients/c1/social/schedule`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.evaluate(() => {
  [...document.querySelectorAll('.app-main button')].find(x => /download/i.test(x.innerText))?.click();
});
await page.waitForTimeout(1200);
const whole = await page.evaluate(async () => (await fetch('/__last-social-export')).json());
ok(!/posts=/.test(whole?.query || ''), 'a fully ticked batch asks for no filter at all', JSON.stringify(whole?.query));

// Nothing ticked is a real state: the next step says it has nothing.
await page.goto(`${B}/clients/c1/social/brief`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
await page.locator('.app-main button', { hasText: /^Untick all$/ }).click();
await page.waitForTimeout(300);
ok(/nothing ticked/i.test(await mainText()), 'unticking all of them says so');
await page.goto(`${B}/clients/c1/social/schedule`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
dl = await dlLabel();
ok(dl?.disabled === true, 'and the download is off rather than quietly empty', JSON.stringify(dl));

// Bulk schedule starts from the ticks too. Only sp1 (instagram) is one
// the autopilot can publish, so unticking it leaves the modal with none.
await page.goto(`${B}/clients/c1/social/brief`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
await page.locator('.app-main button', { hasText: /^Tick all$/ }).click();
await page.waitForTimeout(250);
await boxes().nth(0).click();
await page.waitForTimeout(250);
await page.goto(`${B}/clients/c1/social/schedule`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.locator('.app-main button', { hasText: /^Bulk schedule$/ }).click();
await page.waitForTimeout(500);
const modal = await page.evaluate(() => {
  const h = [...document.querySelectorAll('h2')].find(x => /bulk schedule/i.test(x.innerText));
  return h ? h.innerText.trim() : null;
});
ok(/0 of 1/i.test(modal || ''), 'bulk schedule opens on what Review ticked', JSON.stringify(modal));

ok(errors.length === 0, 'no page errors', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
