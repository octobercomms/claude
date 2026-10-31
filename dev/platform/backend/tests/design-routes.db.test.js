// Design routes against a real Postgres.
//
// Not in CI: CI has no database, the same reason press-segments and
// contact-country are not there either. Run it locally against a scratch
// database when you touch routes/design.js or migration 208:
//
//   initdb + start a server, then
//   createdb designtest
//   psql -d designtest -f <this file's header SQL, see SCHEMA below>
//   (the migrations are applied by the test itself)
//   DB_HOST=/tmp DB_PORT=55432 DB_NAME=designtest DB_USER=postgres \
//     node tests/design-routes.db.test.js
//
// What it is here to protect is the thumbnail path. A thumbnail is 26KB of
// base64; embedding it in the project list meant a hundred sets weighed 2.6MB
// on every visit, none of it cacheable. It is now served as an image, and the
// properties below are the ones that make that safe and correct: no blob in
// any JSON payload, bytes rather than base64 on the wire, a private immutable
// cache keyed to the save time, a 304 when nothing changed, and raster types
// only — 'data:image/svg+xml' served back with its own Content-Type would be
// a stored-XSS hole on the API origin.

const path = require('path');

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE TABLE IF NOT EXISTS clients (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name TEXT);
CREATE TABLE IF NOT EXISTS users   (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name TEXT);
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
`;

// Auth and client visibility are covered by their own suites; here they are a
// signed-in staff member so the routes themselves are what is under test.
const Module = require('module');
const stubs = {
  'middleware/auth': { authenticate: (req, _res, next) => { req.user = { id: null, role: 'admin' }; next(); } },
  'middleware/clientAccess': {
    loadVisibleClientIds: (req, _res, next) => { req.visibleClientIds = null; next(); },
    assertClientAccess: () => true,
    requireClientAccess: () => (req, _res, next) => next(),
  },
};
// Intercept at _load, which sees the request as written. Rewriting
// _resolveFilename instead hands the loader a path it then tries to read off
// disk.
const load = Module._load;
Module._load = function (req, ...rest) {
  for (const key of Object.keys(stubs)) if (req.endsWith(key)) return stubs[key];
  return load.call(this, req, ...rest);
};

const express = require('express');
const request = require('supertest');
const pool = require('../src/db');
const router = require('../src/routes/design');

const app = express();
app.use('/api/design', router);

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

// A 1x1 JPEG, which is all that is needed to prove the bytes survive the trip.
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

// The migrations themselves, not a copy of them. A hand-written schema in a
// test is a schema that drifts from the one the product runs on, and the
// drift shows up as a passing test over a broken column.
const fs = require('fs');
const MIGRATIONS = ['208_design_studio.sql', '209_design_page_sizes.sql'];

(async () => {
  await pool.query(SCHEMA);
  for (const file of MIGRATIONS) {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'));
  }
  // clients.slug is NOT NULL, so a fixture that omits it cannot insert.
  const { rows: cl } = await pool.query("INSERT INTO clients (name, slug) VALUES ('Scratch', 'scratch-design-test') RETURNING id");
  const clientId = cl[0].id;

  const made = await request(app).post(`/api/design/clients/${clientId}/projects`).send({ name: 'Tours' });
  check('a project is created with a page', made.status === 201);
  const pid = made.body.id;

  const proj = await request(app).get(`/api/design/projects/${pid}`);
  check('the project returns its pages', proj.body.pages?.length === 1);
  check('a page carries no thumbnail blob', !('thumbnail' in proj.body.pages[0]),
    `keys: ${Object.keys(proj.body.pages[0]).join(', ')}`);
  check('it says whether it has one', proj.body.pages[0].has_thumbnail === false);
  const pageId = proj.body.pages[0].id;

  const put = await request(app).put(`/api/design/pages/${pageId}`)
    .send({ scene: { objects: [{ type: 'textbox', text: 'Hi' }] }, thumbnail: JPEG });
  check('a save accepts a JPEG thumbnail', put.status === 200 && put.body.thumbnail_rejected === false);
  check('and does not send it back on every autosave', !('thumbnail' in put.body));
  check('but reports that the page now has one', put.body.has_thumbnail === true);

  const img = await request(app).get(`/api/design/pages/${pageId}/thumbnail?v=1`);
  check('the thumbnail serves as an image', img.status === 200 && img.headers['content-type'] === 'image/jpeg');
  check('as bytes, not base64',
    Buffer.isBuffer(img.body) && img.body[0] === 0xff && img.body[1] === 0xd8,
    `${img.body && img.body.length} bytes`);
  check('cached privately and immutably',
    /private/.test(img.headers['cache-control']) && /immutable/.test(img.headers['cache-control']),
    'public would let a shared cache hand one client\'s artwork to another');
  check('and with nosniff', img.headers['x-content-type-options'] === 'nosniff');
  const unchanged = await request(app).get(`/api/design/pages/${pageId}/thumbnail`)
    .set('If-None-Match', img.headers.etag);
  check('an unchanged thumbnail answers 304', unchanged.status === 304);

  const list = await request(app).get(`/api/design/clients/${clientId}/projects`);
  const row = list.body.items[0];
  check('the list names the cover page rather than embedding it',
    row.cover_page_id === pageId && !('cover' in row), `keys: ${Object.keys(row).join(', ')}`);
  check('and gives a version to cache-bust on', !!row.cover_updated_at);
  check('so the list stays small', JSON.stringify(list.body).length < 2000,
    `${JSON.stringify(list.body).length} chars for one set`);

  const svg = await request(app).put(`/api/design/pages/${pageId}`)
    .send({ scene: {}, thumbnail: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' });
  check('an SVG thumbnail is refused', svg.body.thumbnail_rejected === true,
    'it would be served back with its own Content-Type, which is stored XSS');
  const survived = await request(app).get(`/api/design/pages/${pageId}/thumbnail`);
  check('and the good one survives the refusal',
    survived.status === 200 && survived.headers['content-type'] === 'image/jpeg');

  const big = await request(app).put(`/api/design/pages/${pageId}`)
    .send({ scene: {}, thumbnail: `data:image/png;base64,${'A'.repeat(200001)}` });
  check('an oversized thumbnail is refused', big.body.thumbnail_rejected === true);

  const blankPage = await request(app).post(`/api/design/projects/${pid}/pages`).send({});
  const missing = await request(app).get(`/api/design/pages/${blankPage.body.id}/thumbnail`);
  check('a page with no thumbnail is a 404, not an empty image', missing.status === 404);

  const dup = await request(app).post(`/api/design/pages/${pageId}/duplicate`);
  check('a duplicated page has the thumbnail', dup.body.has_thumbnail === true && !('thumbnail' in dup.body));
  check('and serves it', (await request(app).get(`/api/design/pages/${dup.body.id}/thumbnail`)).status === 200);

  // --- moving a page between sets ------------------------------------------
  const other = await request(app).post(`/api/design/clients/${clientId}/projects`)
    .send({ name: 'Other', width: 1080, height: 1350 });
  const wrongSize = await request(app).post(`/api/design/clients/${clientId}/projects`)
    .send({ name: 'Story', width: 1080, height: 1920 });
  const otherClient = await pool.query("INSERT INTO clients (name, slug) VALUES ('Elsewhere', 'elsewhere-design-test') RETURNING id");
  const elsewhere = await request(app).post(`/api/design/clients/${otherClient.rows[0].id}/projects`)
    .send({ name: 'Theirs', width: 1080, height: 1350 });

  const moved = await request(app).put(`/api/design/pages/${pageId}/project`)
    .send({ project_id: other.body.id });
  check('a page moves to another set', moved.status === 200,
    JSON.stringify(moved.body));
  const movedProj = await request(app).get(`/api/design/projects/${other.body.id}`);
  check('and lands at the end of it',
    movedProj.body.pages.length === 2 && movedProj.body.pages[1].id === pageId,
    movedProj.body.pages.map(p2 => p2.id).join(', '));
  check('it keeps its thumbnail through the move',
    (await request(app).get(`/api/design/pages/${pageId}/thumbnail`)).status === 200);

  const back = await request(app).put(`/api/design/pages/${pageId}/project`).send({ project_id: pid });
  check('and moves back', back.status === 200);

  // A page carries its own size now, so a set of another size takes it and
  // the page arrives the size it already was. This used to be refused, back
  // when every page in a set had to be the set's size.
  const intoStory = await request(app).put(`/api/design/pages/${pageId}/project`)
    .send({ project_id: wrongSize.body.id });
  check('a set of a different size takes the page', intoStory.status === 200,
    JSON.stringify(intoStory.body));
  const storyNow = await request(app).get(`/api/design/projects/${wrongSize.body.id}`);
  const landed = (storyNow.body.pages || []).find(p2 => p2.id === pageId);
  check('and the page keeps the size it was made at',
    landed && landed.width === 1080 && landed.height === 1350,
    landed && `${landed.width}x${landed.height} in a 1080x1920 set`);
  await request(app).put(`/api/design/pages/${pageId}/project`).send({ project_id: pid });
  const crossClient = await request(app).put(`/api/design/pages/${pageId}/project`)
    .send({ project_id: elsewhere.body.id });
  check('and so does another client\u2019s set', crossClient.status === 400,
    'its images are brand assets served under its own client\u2019s path');

  // --- a page's own size ----------------------------------------------------
  const sized = await request(app).post(`/api/design/clients/${clientId}/projects`)
    .send({ name: 'Mixed', width: 1080, height: 1350 });
  const sizedId = sized.body.id;
  const inherits = (await request(app).get(`/api/design/projects/${sizedId}`)).body.pages[0];
  check('a page with no size of its own reports the set\u2019s',
    inherits.width === 1080 && inherits.height === 1350,
    `${inherits.width}x${inherits.height}`);

  const story = await request(app).post(`/api/design/projects/${sizedId}/pages`)
    .send({ width: 1080, height: 1920 });
  check('a page can be added at another size',
    story.status === 201 && story.body.width === 1080 && story.body.height === 1920,
    JSON.stringify(story.body));
  const mixed = await request(app).get(`/api/design/projects/${sizedId}`);
  check('so one set holds both',
    mixed.body.pages.length === 2
    && mixed.body.pages[0].height === 1350 && mixed.body.pages[1].height === 1920,
    mixed.body.pages.map(p2 => `${p2.width}x${p2.height}`).join(', '));

  const resized = await request(app).put(`/api/design/pages/${inherits.id}/size`)
    .send({ width: 1080, height: 1080 });
  check('a page resizes on its own', resized.status === 200 && resized.body.height === 1080,
    JSON.stringify(resized.body));
  const siblings = await request(app).get(`/api/design/projects/${sizedId}`);
  check('without touching the page beside it',
    siblings.body.pages[1].height === 1920,
    siblings.body.pages.map(p2 => `${p2.width}x${p2.height}`).join(', '));

  const silly = await request(app).put(`/api/design/pages/${inherits.id}/size`)
    .send({ width: 99999, height: 2 });
  check('a size outside the bounds is clamped rather than stored',
    silly.body.width === 8000 && silly.body.height === 50,
    JSON.stringify(silly.body));

  // Resizing the set means all of it, including pages given a size of their
  // own; otherwise "resize this set" quietly means "resize some of it".
  await request(app).patch(`/api/design/projects/${sizedId}`).send({ width: 1200, height: 1200 });
  const flattened = await request(app).get(`/api/design/projects/${sizedId}`);
  check('resizing the set takes every page with it',
    flattened.body.pages.every(p2 => p2.width === 1200 && p2.height === 1200),
    flattened.body.pages.map(p2 => `${p2.width}x${p2.height}`).join(', '));

  const dupSet = await request(app).post(`/api/design/projects/${sizedId}/duplicate`).send({});
  const dupPages = (await request(app).get(`/api/design/projects/${dupSet.body.id}`)).body.pages;
  check('a duplicated set keeps each page\u2019s size',
    dupPages.length === 2 && dupPages.every(p2 => p2.width === 1200),
    dupPages.map(p2 => `${p2.width}x${p2.height}`).join(', '));

  const onlyPage = await request(app).get(`/api/design/projects/${other.body.id}`);
  const lone = await request(app).post(`/api/design/clients/${clientId}/projects`).send({ name: 'Lone' });
  const loneFull = await request(app).get(`/api/design/projects/${lone.body.id}`);
  const lastOut = await request(app).put(`/api/design/pages/${loneFull.body.pages[0].id}/project`)
    .send({ project_id: other.body.id });
  check('a set will not give up its last page', lastOut.status === 400,
    `${onlyPage.body.pages.length} pages in the target; source had 1`);

  // --- reordering ------------------------------------------------------------
  const toOrder = await request(app).get(`/api/design/projects/${pid}`);
  const ids = toOrder.body.pages.map(p2 => p2.id);
  const reordered = await request(app).put(`/api/design/projects/${pid}/page-order`)
    .send({ ids: [...ids].reverse() });
  check('pages reorder', reordered.status === 200);
  const after2 = await request(app).get(`/api/design/projects/${pid}`);
  check('and the new order sticks',
    after2.body.pages.map(p2 => p2.id).join() === [...ids].reverse().join(),
    after2.body.pages.map(p2 => p2.id).join(' '));

  const blank = await request(app).post(`/api/design/clients/${clientId}/projects`).send({ name: 'Blank' });
  const after = await request(app).get(`/api/design/clients/${clientId}/projects`);
  check('a set with no thumbnails has no cover',
    after.body.items.find(r => r.id === blank.body.id).cover_page_id === null,
    'the cover is the first page that actually has one, not the first page');

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(`\nThis suite needs a database. ${e.message}`);
  console.error(`See the header of ${path.basename(__filename)} for how to stand one up.`);
  process.exit(1);
});
