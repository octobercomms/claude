// Settings → Usage → Prompt caching. The point of the panel is that it tells
// three states apart, because each needs the opposite fix — and the one that
// matters, "wasting", costs money while looking like an optimisation.
import pw from './pw.mjs';
const browser = await pw.chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1500 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto('http://127.0.0.1:4599/settings/costs', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

const panel = () => page.evaluate(() => {
  const h = [...document.querySelectorAll('.app-main *')]
    .find(e => e.textContent.trim() === 'Prompt caching' && e.children.length === 0);
  return h ? h.closest('.card').innerText : '';
});
let text = await panel();
// CardTitle is uppercased by CSS.
ok(/prompt caching/i.test(text), 'the panel renders on Usage');
ok(/61\.8%/.test(text), 'and leads with how much input came from cache');
ok(/\$88\.4[0-9]/.test(text), 'with the net saving in money', (text.match(/\$[\d.]+/g) || []).slice(0, 3).join(' '));

// The three states, told apart.
const rows = await page.evaluate(() => {
  const h = [...document.querySelectorAll('.app-main *')]
    .find(e => e.textContent.trim() === 'Prompt caching' && e.children.length === 0);
  return [...h.closest('.card').querySelectorAll('tbody tr')].map(r => ({
    feature: r.children[0].innerText.trim(),
    state: r.children[1].innerText.trim(),
    hit: r.children[6].innerText.trim(),
    saved: r.children[7].innerText.trim(),
    savedColour: getComputedStyle(r.children[7]).color,
  }));
});
ok(rows.length === 4, 'one row per feature', `rows: ${rows.length}`);
const by = Object.fromEntries(rows.map(r => [r.feature, r]));
ok(by.report_narrative?.state === 'Working', 'a feature that reads its cache back is Working', by.report_narrative?.state);
ok(by.ad_creative?.state === 'Wasting', 'one that writes and never reads is Wasting, not Working', by.ad_creative?.state);
ok(by.ai_visibility_scan?.state === 'Not cached', 'one with no caching at all says so', by.ai_visibility_scan?.state);
ok(by.contact_tidy?.state === 'Too quiet to say', 'and a feature with no traffic makes no claim', by.contact_tidy?.state);

// The negative saving has to read as a loss, not as a small win.
ok(/^-\$7\.88$/.test(by.ad_creative?.saved || ''), 'a wasting feature shows a negative saving', by.ad_creative?.saved);
const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
ok(by.ad_creative && by.report_narrative
   && by.ad_creative.savedColour !== by.report_narrative.savedColour,
   'and in a different colour from a real one',
   `${by.ad_creative?.savedColour} vs ${by.report_narrative?.savedColour}`);
ok(by.ad_creative && lum(by.ad_creative.savedColour) < 0.5, 'which is legible, not a pale red', by.ad_creative?.savedColour);

// The window switches.
await page.evaluate(() => {
  const h = [...document.querySelectorAll('.app-main *')]
    .find(e => e.textContent.trim() === 'Prompt caching' && e.children.length === 0);
  [...h.closest('.card').querySelectorAll('button.tab')].find(b => b.innerText.trim() === '7d').click();
});
await page.waitForTimeout(900);
ok(await page.evaluate(() => {
  const h = [...document.querySelectorAll('.app-main *')]
    .find(e => e.textContent.trim() === 'Prompt caching' && e.children.length === 0);
  return [...h.closest('.card').querySelectorAll('button.tab')].some(b => b.innerText.trim() === '7d' && b.classList.contains('active'));
}), 'the window switches');

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await page.screenshot({ path: '/tmp/claude-0/-home-user-claude/678f754e-8874-5413-b278-fc834fcb4dab/scratchpad/cache.png' });
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
