// The nine screens that lost a render branch, driven rather than trusted.
//
// Each was a page in its own right once and kept a standalone layout behind
// an `embedded` prop that its one caller always passed — a kicker, a hero, a
// max-width wrapper, a second ?tab= key. Deleting a branch is exactly where a
// clean build and a blank screen look identical, so each screen is opened and
// asked three things: that its own content drew, that the chrome the parent
// owns is not doubled, and that nothing threw.
//
// The headings are checked by hit-testing the h1.display the parent draws:
// counting the word "Video" or "Brand" in the page text would match a nav
// row, a button or a sentence, and did while this was being written.
//
//   node drive-embedded.mjs     (needs stub-server.js on :4599)
import pw from './pw.mjs';

const { chromium } = pw;
const B = 'http://127.0.0.1:4599';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };

let errors = [];
page.on('pageerror', e => errors.push(e.message));

const main = () => page.evaluate(() => {
  const m = document.querySelector('.app-main');
  return m ? m.innerText : '';
});
// Every .display heading inside the main column, which is the one the page
// shell draws. A screen that still carried its own hero would add a second.
const displays = () => page.evaluate(() =>
  [...document.querySelectorAll('.app-main .display')].map(h => h.innerText.trim()));
const kickers = () => page.evaluate(() =>
  [...document.querySelectorAll('.app-main .kicker')].length);

async function screen({ path, name, shows, maxDisplays = 1 }) {
  errors = [];
  await page.goto(`${B}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const text = await main();
  const ds = await displays();
  const ks = await kickers();
  ok(shows.test(text), `${name} draws its own content`, shows.source);
  ok(ds.length <= maxDisplays, `${name} draws at most ${maxDisplays} hero heading`, JSON.stringify(ds));
  ok(ks <= 1, `${name} does not stack kickers`, `kickers=${ks}`);
  ok(errors.length === 0, `${name} throws nothing`, errors.join(' | '));
}

// --- Settings tabs: the shell owns the title, so these draw none of their own.
await screen({ path: '/settings/integrations', name: 'Integrations',
  shows: /How each client integration works/i });
await screen({ path: '/settings/users', name: 'Users & access',
  shows: /Users & access/i });
await screen({ path: '/settings/reports', name: 'Reports',
  shows: /Trigger Report/i });
await screen({ path: '/biz-dev/leads', name: 'Biz dev Leads',
  shows: /New snapshot|Draft snapshot/i });

// --- Client Produce tabs.
await screen({ path: '/clients/c1/produce/record', name: 'Produce Record',
  shows: /Start recording/i });
await screen({ path: '/clients/c1/produce/compose', name: 'Produce Compose',
  shows: /Editor|Frame size|Loading editor/i });
await screen({ path: '/clients/c1/produce/design', name: 'Produce Design',
  shows: /Layered posts for this client/i });
await screen({ path: '/clients/c1/produce/transcribe', name: 'Produce Transcribe',
  shows: /Upload a recording|separate each speaker/i });

// --- Visualise: its ?tab= key is now permanently 'vtab', and the Produce
// page owns 'tab'. Opening a project must not move the parent's tab.
errors = [];
await page.goto(`${B}/clients/c1/produce/visualise`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
ok((await displays()).length <= 1, 'Visualise draws at most one hero heading',
  JSON.stringify(await displays()));
ok(!/[?&]tab=/.test(page.url()), 'Visualise does not write the parent\'s ?tab', page.url());
ok(errors.length === 0, 'Visualise throws nothing', errors.join(' | '));

// --- Setup → Brand sits below the brief inside Setup, so one hero for both.
await screen({ path: '/clients/c1/dashboard/setup', name: 'Setup with Brand below it',
  shows: /Upload the brand|logos/i });

// --- A publication record still opens as a modal, not a pane. The pane half
// went when Publications returned to a full-width table on 1 November.
errors = [];
await page.goto(`${B}/database/publications`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
const rowBtn = page.locator('.app-main table tbody button.btn-link').first();
const haveRow = await rowBtn.count();
ok(haveRow > 0, 'Publications lists a publication to open');
if (haveRow) {
  await rowBtn.click();
  await page.waitForTimeout(1200);
  const backdrops = await page.evaluate(() => document.querySelectorAll('.modal-backdrop').length);
  ok(backdrops === 1, 'the publication record opens in a modal', `backdrops=${backdrops}`);
  const panes = await page.evaluate(() => document.querySelectorAll('.ds-workbench').length);
  ok(panes === 0, 'Publications is not a two-pane workbench', `workbenches=${panes}`);
  // Escape still closes it: the listener was behind `if (embedded) return`.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => document.querySelectorAll('.modal-backdrop').length);
  ok(after === 0, 'Escape closes the publication record', `backdrops=${after}`);
}
ok(errors.length === 0, 'Publications throws nothing', errors.join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
