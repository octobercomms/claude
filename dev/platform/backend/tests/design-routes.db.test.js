// Design routes against a real Postgres.
//
// Not in CI: CI has no database, the same reason press-segments and
// contact-country are not there either. Run it locally against a scratch
// database when you touch routes/design.js or migration 208:
//
//   initdb + start a server, then
//   createdb designtest
//   psql -d designtest -f <this file's header SQL, see SCHEMA below>
//   psql -d designtest -f migrations/208_design_studio.sql
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

(async () => {
  await pool.query(SCHEMA);
  const { rows: cl } = await pool.query("INSERT INTO clients (name) VALUES ('Scratch') RETURNING id");
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
