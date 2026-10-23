// Mount the Design page in a real browser and use it.
//
// Why this exists: twice in one afternoon the Design tab shipped broken and
// the person using it found out, not CI. Both were render-time crashes —
// `vite build` compiled them, the rules-of-hooks lint passed them, and the
// source-level guards passed because the code was all present and correct.
// Nothing anywhere rendered the component. This does.
//
// It also covers the one that cost real work: autosave used to dispose the
// canvas and reload a stale scene, silently discarding everything added since
// the project was opened. The last assertion below is exactly that — save,
// then check the layer is still there.
//
//   npm run test:browser          (builds first, then runs this)
//
// PW_CHROMIUM may point at an existing Chromium; otherwise Playwright uses
// the one it downloaded.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('No build to test. Run: npx vite build --config tests/browser/vite.config.js');
  process.exit(1);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(dist, rel);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const CLIENT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const PAGE = '33333333-3333-4333-8333-333333333333';

let saves = 0;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

const problems = [];
page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });

// Google Fonts, served locally as nothing. The editor injects a stylesheet
// for each family it loads, and a test that reaches the internet fails on a
// restricted runner for reasons that have nothing to do with the code.
await page.route('https://fonts.googleapis.com/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ status: 200, body: '' }));

// Every request the page makes, answered here. The api helper, the auth
// provider's raw fetch and the thumbnail <img> all go through this.
await page.route('**/api/**', async (route) => {
  const url = new URL(route.request().url());
  const p = url.pathname;
  const json = (body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  if (p === '/api/auth/me') return json({ id: 'u1', name: 'Test', role: 'admin' });
  if (p.endsWith('/assets')) return json([]);
  if (p === `/api/design/clients/${CLIENT}/projects`) {
    return json({ items: [{ id: PROJECT, name: 'Tours Social Posts', width: 1080, height: 1350,
      page_count: 1, cover_page_id: null, cover_updated_at: null, updated_at: '2026-10-23T12:00:00Z' }] });
  }
  if (p === `/api/design/projects/${PROJECT}`) {
    return json({ id: PROJECT, client_id: CLIENT, name: 'Tours Social Posts', width: 1080, height: 1350,
      pages: [{ id: PAGE, project_id: PROJECT, sort_order: 0, scene: {}, has_thumbnail: false,
        updated_at: '2026-10-23T12:00:00Z' }] });
  }
  if (p === `/api/design/pages/${PAGE}` && route.request().method() === 'PUT') {
    saves += 1;
    return json({ id: PAGE, has_thumbnail: true, thumbnail_rejected: false,
      updated_at: new Date().toISOString() });
  }
  return json({});
});

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

try {
  await page.goto(origin, { waitUntil: 'networkidle' });

  // 1. It renders at all. This is the one that would have caught both crashes.
  const listed = await page.getByText('Tours Social Posts').isVisible().catch(() => false);
  check('the set list renders', listed,
    'a render-time throw lands here, and neither the build nor the hooks lint sees one');

  // 2. Opening a set gives a canvas.
  await page.getByText('Tours Social Posts').click();
  await page.waitForSelector('canvas', { timeout: 5000 });
  check('opening a set builds the canvas', (await page.locator('canvas').count()) > 0);
  check('and the layer panel starts empty', await page.getByText('Empty page.').isVisible());

  // 3. Adding layers reaches both the panel and the canvas.
  await page.getByRole('button', { name: 'Text' }).click();
  await page.getByRole('button', { name: 'Shade block' }).click();
  await page.waitForTimeout(300);
  check('adding text puts a layer in the panel',
    await page.getByText('Your headline').first().isVisible().catch(() => false));

  // The shade block is what makes this measurable: the default headline is
  // white on a white page, so pixels alone cannot tell whether it is there.
  const darkness = () => page.evaluate(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(
      Math.floor(c.width * 0.5), Math.floor(c.height * 0.8), 1, 1).data;
    return d[0];
  });
  check('and the canvas actually has it drawn on it', (await darkness()) < 220,
    'the shade block darkens the lower half of the page');

  // 4. The one that cost a real afternoon. save() used to replace the project
  //    state object; the canvas effect depended on its identity, disposed the
  //    canvas and rebuilt it empty, throwing away everything added since.
  //
  //    Asserting on the layers panel does NOT catch this — checked by putting
  //    the bug back. Nothing fires a canvas event after the rebuild, so the
  //    panel keeps the layer list it already had and reads perfectly while the
  //    page behind it is blank. The canvas has to be asked directly, and the
  //    container Fabric wraps it in is a new node after a dispose.
  await page.evaluate(() => document.querySelector('.canvas-container')?.setAttribute('data-smoke', '1'));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(800);
  check('the save reached the server', saves >= 1, `${saves} PUTs seen`);
  check('the work is still on the canvas after a save', (await darkness()) < 220,
    'this is the autosave-wipes-the-canvas regression');
  check('and the canvas was never torn down and rebuilt',
    await page.evaluate(() => !!document.querySelector('.canvas-container[data-smoke]')),
    'a dispose replaces the container, so the marker goes with it');

  // 5. Nothing threw along the way.
  check('nothing threw', problems.length === 0, problems.join('\n  '));
} catch (e) {
  fail += 1;
  console.log('FAIL  the run itself', `\n  ${e.message}`);
  if (problems.length) console.log(`  page problems:\n  ${problems.join('\n  ')}`);
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
