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
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('No build to test. Run: npx vite build --config tests/browser/vite.config.js');
  process.exit(1);
}

// The same PSD the import tests use. Importing into an open set is the one
// part of the import that only exists in the editor, so it is exercised here
// rather than in the parser's own suite.
execFileSync(process.execPath, [path.join(here, 'psd-fixture.mjs'), path.join(dist, 'fixture.psd')]);

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
const PAGE2 = '44444444-4444-4444-8444-444444444444';
const PROJECT2 = '55555555-5555-4555-8555-555555555555';

let saves = 0;
let renamed = null;   // the name a rename sent
let reorder = null;   // the ids the strip asked the server to store
let movedTo = null;   // { page, project } from a move
let pagesAdded = [];  // project ids a new page was created in
let scenesPut = 0;    // pages written with a scene
let assetsPosted = 0; // layer images uploaded to the brand library

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
  if (p.endsWith('/assets') && route.request().method() === 'POST') {
    assetsPosted += 1;
    return json({ id: `a${assetsPosted}`, kind: 'product_image', name: 'Layer',
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      metadata: {} });
  }
  if (/^\/api\/design\/projects\/[^/]+\/pages$/.test(p) && route.request().method() === 'POST') {
    pagesAdded.push(p.split('/')[4]);
    return json({ id: `new-page-${pagesAdded.length}`, project_id: p.split('/')[4], sort_order: 9 });
  }
  if (p.endsWith('/assets')) {
    // A palette from the Brand tab, which is where the swatches come from.
    return json([{ id: 'pal1', kind: 'palette', name: 'Brand', url: null,
      metadata: { colors: ['#f2c100', '#111111'] } }]);
  }
  if (p === `/api/design/clients/${CLIENT}/projects`) {
    return json({ items: [
      { id: PROJECT, name: 'Tours Social Posts', width: 1080, height: 1350,
        page_count: 2, cover_page_id: null, cover_updated_at: null, updated_at: '2026-10-23T12:00:00Z' },
      // same size, so the strip may offer it as somewhere to move a page
      { id: PROJECT2, name: 'ADF 2026', width: 1080, height: 1350,
        page_count: 1, cover_page_id: null, cover_updated_at: null, updated_at: '2026-10-23T11:00:00Z' },
    ] });
  }
  if (p === `/api/design/projects/${PROJECT}` && route.request().method() === 'GET') {
    return json({ id: PROJECT, client_id: CLIENT, name: 'Tours Social Posts', width: 1080, height: 1350,
      pages: [
        { id: PAGE, project_id: PROJECT, sort_order: 0, scene: {}, has_thumbnail: false, updated_at: '2026-10-23T12:00:00Z' },
        { id: PAGE2, project_id: PROJECT, sort_order: 1, scene: {}, has_thumbnail: false, updated_at: '2026-10-23T12:00:00Z' },
      ] });
  }
  if (p === `/api/design/projects/${PROJECT}` && route.request().method() === 'PATCH') {
    renamed = JSON.parse(route.request().postData() || '{}');
    return json({ id: PROJECT, name: renamed.name || 'Tours Social Posts' });
  }
  if (p === `/api/design/projects/${PROJECT}/page-order` && route.request().method() === 'PUT') {
    reorder = JSON.parse(route.request().postData() || '{}').ids;
    return json({ ok: true });
  }
  if (/\/api\/design\/pages\/[^/]+\/project$/.test(p) && route.request().method() === 'PUT') {
    movedTo = { page: p.split('/')[4], project: JSON.parse(route.request().postData() || '{}').project_id };
    return json({ ok: true });
  }
  if (/^\/api\/design\/pages\/[^/]+$/.test(p) && route.request().method() === 'PUT') {
    saves += 1;
    if ((JSON.parse(route.request().postData() || '{}').scene || {}).objects) scenesPut += 1;
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

  // --- every edit saves, without being asked ------------------------------
  // Fifteen seconds was a window in which switching tab, which unmounts this
  // page, threw the work away. Nothing has been clicked but Text and Shade.
  await page.waitForTimeout(1800);
  check('an edit saves on its own', saves >= 1,
    `${saves} PUTs after an edit and no Save click`);

  // --- undo ----------------------------------------------------------------
  const before = await darkness();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  check('undo takes the last layer back off', (await darkness()) > before + 20,
    `darkness ${before} -> ${await darkness()}; the shade block should be gone`);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(600);
  check('and redo puts it back', (await darkness()) < 220,
    `darkness ${await darkness()}`);

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
  check('the save reached the server', saves >= 2, `${saves} PUTs seen`);
  check('the work is still on the canvas after a save', (await darkness()) < 220,
    'this is the autosave-wipes-the-canvas regression');
  check('and the canvas was never torn down and rebuilt',
    await page.evaluate(() => !!document.querySelector('.canvas-container[data-smoke]')),
    'a dispose replaces the container, so the marker goes with it');

  // 5. Nothing threw along the way.
  // --- the client's own colours, one click away ---------------------------
  // Restoring a scene clears the selection, so pick a layer again first.
  await page.getByText('Shape', { exact: true }).first().click();
  await page.waitForTimeout(300);
  // The shade block is the selected layer here, and until now it had no way
  // to change its colour at all.
  const swatch = page.getByRole('button', { name: 'Brand colour #f2c100' }).first();
  check('the brand palette shows beside the colour picker',
    await swatch.isVisible().catch(() => false),
    'the colours are already in the brand kit; nobody should eyedrop them out of a screenshot');
  await swatch.click();
  await page.waitForTimeout(250);
  check('and clicking one sets the colour',
    (await page.locator('input[title="Fill colour"]').inputValue()) === '#f2c100',
    await page.locator('input[title="Fill colour"]').inputValue());

  // --- the page's own background ------------------------------------------
  // A full-bleed graphic covers the background, so a control that needs the
  // background selected is a control you reach by dragging the artwork away.
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('.canvas-container')?.setAttribute('data-bg', '1'));
  const bgSwatch = page.getByRole('button', { name: 'Page background #f2c100' });
  check('the background colour is set without selecting anything',
    await bgSwatch.isVisible().catch(() => false),
    'it is not a layer, so there is nothing to select');

  const corner = () => page.evaluate(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(2, 2, 1, 1).data;
    return [d[0], d[1], d[2]].join(',');
  });

  // Let the edit before this one finish saving first. Without the pause the
  // next assertion counts a PUT the colour change had nothing to do with, and
  // passes with the save wiring taken out — checked by taking it out.
  await page.waitForTimeout(2000);
  const bgSaves = saves;

  await bgSwatch.click();
  await page.waitForTimeout(300);
  check('and the page behind the layers changes colour', (await corner()) === '242,193,0',
    `top-left pixel rgb(${await corner()}), expected the brand yellow`);
  check('the canvas survived it', await page.evaluate(
    () => !!document.querySelector('.canvas-container[data-bg]')));

  await page.waitForTimeout(1600);
  check('changing the background saves on its own', saves > bgSaves,
    `${saves} PUTs, was ${bgSaves} before the colour changed`);

  // Undo alone proves little: stepping back to any earlier state leaves a
  // white corner whether or not the colour was ever recorded. Redo is the
  // half that fails when it was not.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  check('and undo takes the colour back off', (await corner()) !== '242,193,0',
    `top-left pixel rgb(${await corner()})`);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(600);
  check('and redo puts it back', (await corner()) === '242,193,0',
    `top-left pixel rgb(${await corner()}); the colour was never put on the undo stack`);

  // --- renaming a set ------------------------------------------------------
  page.once('dialog', d => d.accept('Tours renamed'));
  await page.getByRole('button', { name: 'Rename this set' }).click();
  await page.waitForTimeout(400);
  check('a set can be renamed', renamed && renamed.name === 'Tours renamed',
    JSON.stringify(renamed));

  // --- the page strip: reorder by dragging, and move to another set -------
  const thumbs = page.locator('[title^="Page "]');
  check('every page is in the strip', (await thumbs.count()) === 2,
    `${await thumbs.count()} thumbnails`);

  await thumbs.nth(1).dragTo(thumbs.nth(0));
  await page.waitForTimeout(400);
  check('dragging a page reorders the set',
    Array.isArray(reorder) && reorder.length === 2 && reorder[0] === PAGE2,
    `server was sent: ${JSON.stringify(reorder)}`);

  await page.getByRole('button', { name: /Move page .* to another set/ }).first().click();
  await page.waitForTimeout(200);
  const target = page.getByText('ADF 2026', { exact: true });
  check('the move menu offers the other set of the same size',
    await target.isVisible().catch(() => false));
  await target.click();
  await page.waitForTimeout(400);
  check('and moving sends the page to it',
    movedTo && movedTo.project === PROJECT2,
    JSON.stringify(movedTo));

  // --- importing a PSD into the set that is open --------------------------
  // The destination is the part worth testing: the files have to become pages
  // of this set rather than a set of their own, and they have to be new pages
  // rather than written over the ones already there.
  const was = { pages: pagesAdded.length, scenes: scenesPut };
  await page.locator('input[type=file][accept=".psd"]')
    .setInputFiles(path.join(dist, 'fixture.psd'));
  await page.waitForTimeout(3000);
  check('the editor reviews a PSD before writing anything',
    await page.getByText(/file read/).isVisible().catch(() => false),
    'the review step is what stops forty wrong pages appearing unasked');
  check('and nothing was written yet', pagesAdded.length === was.pages);

  const addBtn = page.getByRole('button', { name: /^Add 1 page to / });
  check('the open set is the default destination',
    await addBtn.isVisible().catch(() => false),
    'reading files with a set open nearly always means pages for that set');

  await addBtn.click();
  await page.waitForTimeout(4000);
  check('the pages go into the open set', pagesAdded.slice(was.pages).every(id => id === PROJECT)
    && pagesAdded.length === was.pages + 1,
    `pages created in: ${JSON.stringify(pagesAdded)}`);
  check('as new pages, not over the ones already there',
    scenesPut > was.scenes,
    `${scenesPut} scenes written, was ${was.scenes}`);
  check('and the layer images reached the brand library', assetsPosted > 0,
    `${assetsPosted} uploads`);

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
