// The reel checks on the post card in Shared. They lived only on Produce →
// Video and Produce → Edit, beside the render button, so having produced a
// reel from Shared you never saw the verdict.
//
// The fixture records two judgements: sp1 passed 5 of 7 with two real
// failures and nothing unjudged, sp2 passed 3 with four unjudged because it
// was never transcribed. Assertions compare the screen against those numbers,
// not against "a number is present".
import pw from './pw.mjs';
const { chromium } = pw;
const B = 'http://127.0.0.1:4599';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const HOOKS = ['The one bed rule', 'Autumn is the planting season'];

// PostCard is an editor, so a card is identified by the hook in its input.
const cards = () => page.evaluate((hooks) => {
  const out = [];
  for (const c of document.querySelectorAll('.app-main .card')) {
    const vals = [...c.querySelectorAll('input, textarea')].map(i => i.value);
    const hook = hooks.find(h => vals.includes(h));
    if (hook) out.push({ hook, text: c.innerText });
  }
  return out;
}, HOOKS);

// Start from everything ticked so Produce lists both posts.
await page.goto(`${B}/clients/c1/social/refine`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);

// The rename landed: step 2 is Refine, at its own slug.
const railText = await page.evaluate(() => document.querySelector('.app-main').innerText);
ok(/refine/i.test(railText), 'step 2 is called Refine');
ok(!/Review your batches/i.test(railText), 'and no longer calls itself Review');
ok(/the Review screen under Measure is the monthly read-out/i.test(railText),
   'and says which Review is which');

const tickAll = page.locator('.app-main button', { hasText: /^Tick all$/ });
if (await tickAll.count()) { await tickAll.click(); await page.waitForTimeout(250); }

await page.goto(`${B}/clients/c1/social/produce`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
const shown = await cards();
ok(shown.length === 2, 'both ticked posts are on Produce', String(shown.length));

const byHook = (h) => shown.find(c => c.hook === h);
const one = byHook(HOOKS[0]);
const two = byHook(HOOKS[1]);

ok(/reel checks/i.test(one?.text || ''), 'the post card carries the reel checks');
ok(/5 of 7 pass/i.test(one?.text || ''), 'with the recorded count, not a recomputed one',
   one?.text.match(/\d of \d pass/i)?.[0]);
// The two that failed, named from the shared LABELS map.
ok(/The hook states a fact, not a claim/i.test(one?.text || ''), 'naming the first failure');
ok(/Not the account talking about itself/i.test(one?.text || ''), 'and the second');
// And not naming the ones that passed.
ok(!/Thirty to forty-five seconds/i.test(one?.text || ''),
   'and not listing what passed, which would bury the two that did not');
ok(/Advice, not a gate/i.test(one?.text || ''), 'it says it is advisory');
ok(/Taken when this reel rendered/i.test(one?.text || ''),
   'and that the judgement came from the render, not from this page');

// Unjudged is not failed, and the card says which.
ok(/3 of 7 pass/i.test(two?.text || ''), 'the second post shows its own count',
   two?.text.match(/\d of \d pass/i)?.[0]);
ok(/4 not judged/i.test(two?.text || ''), 'and how many were never judged',
   two?.text.match(/\d not judged/i)?.[0]);
ok(/needs a transcript/i.test(two?.text || ''), 'and why');
ok(!/not judged/i.test(one?.text || ''),
   'while the post that was transcribed says nothing about unjudged checks');

// A post with no recorded judgement shows nothing rather than an empty panel.
const none = await page.evaluate(async () => {
  const r = await fetch('/api/social/clients/c1/reel-checks');
  const d = await r.json();
  return Object.keys(d.byPost || {});
});
ok(none.length === 2, 'the route returns one judgement per post', JSON.stringify(none));

ok(errors.length === 0, 'no page errors', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
