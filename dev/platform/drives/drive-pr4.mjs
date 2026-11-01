import pw from './pw.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

// PR 4, driven.
//
// Two items. The drop target is a visible state and an interaction, which a
// diff cannot show: whether one file goes one way and three go another,
// whether a rejected file says which one it was, whether the grid below
// actually reloads. The design link is a path, which is the class of thing
// this repo has shipped six dead ones of in a single commit.
const b = await pw.chromium.launch();
const errs = [];
let fails = 0;
const say = (ok, what, extra = '') => {
  if (!ok) fails += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  — ' + extra : ''}`);
};

// Real files on disk, because setInputFiles needs them and a drive that fakes
// the file is not driving the upload.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-'));
const write = (name, bytes) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, bytes);
  return p;
};
const ONE = write('one.mp4', Buffer.alloc(2048, 1));
const TWO = write('two.mp4', Buffer.alloc(2048, 2));
const SVG = write('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');

const open = async (p2, routes = []) => {
  const page = await b.newPage();
  page.on('pageerror', (e) => {
    if (/stub: no route/.test(e.message)) return;
    errs.push(`${p2}: ${e.message}`);
  });
  for (const [glob, handler] of routes) await page.route(glob, handler);
  await page.goto('http://127.0.0.1:4599' + p2, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  return page;
};
const text = async (p2) => (await p2.locator('body').innerText()).replace(/\s+/g, ' ');
const json = (body, status = 200) => (r) => r.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body) });

// ── 1. One target, and it says what it does with one file and with several ─
{
  const p = await open('/clients/c1/produce/video');
  const t = await text(p);
  say(/Drop your clips here, or click to choose/i.test(t), 'the Footage step has a drop target');
  say(/One clip opens straight in the editor/i.test(t), 'and says what one file does');
  say(/Several are filed in/i.test(t), 'and what several do');
  // Two upload affordances side by side is the two-doors shape this review
  // keeps finding.
  const old = p.getByRole('button', { name: /^Upload a clip$/i });
  say(await old.count() === 0, 'and the old single-file button is gone',
    `found ${await old.count()}`);
  await p.close();
}

// ── 2. One file goes to the editor, as it always did ──────────────────────
{
  let draftPosted = false;
  let uploadPosted = false;
  const p = await open('/clients/c1/produce/video', [
    ['**/api/edit/clients/*/edit', (r) => {
      if (r.request().method() === 'POST') { draftPosted = true; return json({ id: 'draft-1', status: 'draft' })(r); }
      return r.continue();
    }],
    ['**/api/clients/*/assets/upload', (r) => { uploadPosted = true; return json({ added: [], failed: [] })(r); }],
  ]);
  await p.locator('input[type=file]').setInputFiles([ONE]);
  await p.waitForTimeout(1200);
  say(draftPosted, 'one file posts a draft edit job');
  say(!uploadPosted, 'and is not filed in the library on the way',
    'the edit job records its own output when it renders');
  const t = await text(p);
  // "Start with something else" only exists on the editor step. /Format/
  // alone was too loose to prove anything.
  say(/Start with something else/i.test(t), 'and the editor step opens',
    t.match(/.{0,40}Start with something else/i)?.[0] || t.slice(0, 80));
  await p.close();
}

// ── 3. Several files are filed, and the grid is told ──────────────────────
{
  let uploaded = null;
  let listCalls = 0;
  const p = await open('/clients/c1/produce/video', [
    ['**/api/clients/*/assets/upload', (r) => {
      uploaded = r.request().method();
      return json({ added: [
        { id: 'n1', title: 'one.mp4', kind: 'video', source: 'upload', url: '/vite.svg' },
        { id: 'n2', title: 'two.mp4', kind: 'video', source: 'upload', url: '/vite.svg' },
      ], failed: [] }, 201)(r);
    }],
    ['**/api/clients/*/assets?**', (r) => {
      listCalls += 1;
      return json({ assets: listCalls > 1 ? [
        { id: 'n1', title: 'one.mp4', kind: 'video', source: 'upload', url: '/vite.svg' },
      ] : [], counts: {}, sources: ['upload'] })(r);
    }],
  ]);
  const before = listCalls;
  await p.locator('input[type=file]').setInputFiles([ONE, TWO]);
  await p.waitForTimeout(1500);
  say(uploaded === 'POST', 'two files post to the upload route', `method ${uploaded}`);
  const t = await text(p);
  say(/2 files filed/i.test(t), 'and it says how many were filed',
    t.match(/.{0,10}files filed.{0,40}/i)?.[0] || '');
  say(/Pick the one to start with/i.test(t), 'and what to do next');
  // The grid refetching is the whole reason refreshKey exists: without it the
  // five clips just uploaded are missing from the list of what exists.
  say(listCalls > before, 'and the grid below reloads', `${before} → ${listCalls} list calls`);
  say(/one\.mp4/.test(t), 'so the new clip is in it');
  await p.close();
}

// ── 4. A rejected file is named ───────────────────────────────────────────
{
  let uploadPosted = false;
  const p = await open('/clients/c1/produce/video', [
    ['**/api/clients/*/assets/upload', (r) => { uploadPosted = true; return json({ added: [], failed: [] })(r); }],
  ]);
  await p.locator('input[type=file]').setInputFiles([SVG, ONE, TWO]);
  await p.waitForTimeout(1400);
  const t = await text(p);
  // Named, not counted: "1 file was rejected" leaves you to work out which.
  say(/logo\.svg — SVG belongs in the brand kit/i.test(t),
    'a rejected file is named, with the reason',
    t.match(/logo\.svg[^.]{0,60}/i)?.[0] || '');
  say(uploadPosted, 'and the two good ones still go');
  await p.close();
}

// ── 5. A filed design links back to its set ───────────────────────────────
{
  const p = await open('/clients/c1/produce/library', [
    ['**/api/clients/*/assets?**', json({
      assets: [{
        id: 'd1', client_id: 'c1', title: 'Autumn launch · page 2', kind: 'image',
        source: 'design', url: '/vite.svg',
        metadata: { design_project_id: 'proj-9', design_project_name: 'Autumn launch', page_index: 1 },
      }, {
        id: 'u1', client_id: 'c1', title: 'one.mp4', kind: 'video', source: 'upload',
        url: '/vite.svg', metadata: {},
      }],
      counts: { total: 2, image: 1, video: 1 }, sources: ['design', 'upload'],
    })],
  ]);
  const t = await text(p);
  say(/Designed/i.test(t), 'a filed design is in the library');
  const link = p.getByRole('link', { name: /Open Autumn launch/i }).first();
  say(await link.count() > 0, 'and names the set it came from');
  if (await link.count()) {
    const href = await link.getAttribute('href');
    // The path is the thing: a typed one rots the next time the Design slug
    // moves, and the set has to actually open.
    say(href === '/clients/c1/produce/design?design=proj-9',
      'with a link that opens that set', href || '');
  }
  // An upload has no set, so no link.
  const any = await p.getByRole('link', { name: /Open the set/i }).count();
  say(any === 0, 'and an asset with no set shows no link', `found ${any}`);
  await p.close();
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(errs.length ? 'PAGE ERRORS: ' + errs.join(' | ') : 'no page errors');
console.log(fails === 0 && errs.length === 0 ? '--- PR 4 DRIVES PASS ---' : `--- ${fails} FAILED ---`);
await b.close();
