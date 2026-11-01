// Guard — a finished design is findable.
//
// Design export was entirely client-side: the canvas rasterised, the browser
// downloaded the file, and nothing in OMI knew a design had ever been
// finished. The asset library — the one thing that can answer "what have we
// made for this client" — could not see the design studio at all.
//
// Two halves matter, and the second is the one that would rot quietly. The
// render has to be filed, and it has to carry the set it came from, or the
// library row is a picture with no way back to the artwork that made it.
//
// The route runs for real against a stubbed pool, so the assertions are about
// what it writes and what it answers rather than about its source text.

const path = require('path');
const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

// A 1x1 PNG, which is a real PNG and small enough to live in a test.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

// loadProject validates the id against UUID_RE before it queries, so the
// fixtures have to be real uuids. A 'proj-1' got "Project not found".
const PROJ = '99999999-8888-7777-6666-555555555555';

const recorded = [];
let project = { id: PROJ, client_id: 'client-1', name: 'Autumn launch', width: 1080, height: 1080 };
let pageRow = { id: '11111111-2222-3333-4444-555555555555', project_id: PROJ, width: null, height: null };

const fakePool = {
  query: async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ');
    if (/SELECT id, project_id, width, height FROM design_pages/.test(s)) {
      return { rows: pageRow && pageRow.id === params[0] ? [pageRow] : [], rowCount: pageRow ? 1 : 0 };
    }
    if (/SELECT \* FROM design_projects/.test(s)) {
      return { rows: project ? [project] : [], rowCount: project ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  },
};

const stub = (modPath, exports) => {
  require.cache[require.resolve(modPath)] = { id: modPath, filename: modPath, loaded: true, exports };
};
const passthrough = (req, res, next) => next();

stub(path.join(__dirname, '..', 'src', 'db.js'), fakePool);
stub(path.join(__dirname, '..', 'src', 'middleware', 'auth.js'), { authenticate: passthrough });
stub(path.join(__dirname, '..', 'src', 'middleware', 'clientAccess.js'), {
  loadVisibleClientIds: passthrough,
  requireClientAccess: () => passthrough,
  assertClientAccess: () => {},
  requireAdmin: passthrough,
});
// assets.record is the library's own, guarded elsewhere. What matters here is
// what this route hands it.
stub(path.join(__dirname, '..', 'src', 'services', 'assets.js'), {
  record: async (a) => { recorded.push(a); return { id: 'asset-1', ...a }; },
});

const router = require('../src/routes/design');

const app = express();
app.use('/api/design', router);
const server = app.listen(0);

function post(pageId, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method: 'POST',
      path: `/api/design/pages/${pageId}/render`,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* leave null */ }
        resolve({ status: res.statusCode, body: json, raw: data });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

(async () => {
  const PAGE = pageRow.id;

  // 1. A rendered page is filed.
  recorded.length = 0;
  let r = await post(PAGE, { data_url: PNG, index: 2, width: 1080, height: 1350 });
  check('a rendered page is filed in the library', r.status === 201 && recorded.length === 1,
    `status ${r.status}, ${recorded.length} recorded — ${r.raw}`);

  const a = recorded[0] || {};
  check('under the client that owns the set', a.client_id === 'client-1', `got ${a.client_id}`);
  check('as a design', a.source === 'design', `got ${a.source}`);
  check('keyed on the page, so a second export replaces it rather than piling up',
    a.source_id === PAGE, `got ${a.source_id}`);

  // 2. The link back, which is the half that would rot unnoticed.
  check('it carries the set it came from',
    a.metadata?.design_project_id === PROJ,
    `metadata ${JSON.stringify(a.metadata)} — without the set id the row is a picture with no way home`);
  check('and the set\'s name, so the library can name the link',
    a.metadata?.design_project_name === 'Autumn launch', `got ${a.metadata?.design_project_name}`);
  check('and which page of it this was', a.metadata?.page_index === 2,
    `got ${a.metadata?.page_index}`);

  // 3. Named after the work, not after the file on disk.
  check('the title names the set and the page', a.title === 'Autumn launch · page 3',
    `got ${JSON.stringify(a.title)} — "design-1762012800-a1b2c3.png" is not a title`);

  recorded.length = 0;
  r = await post(PAGE, { data_url: PNG, title: 'Hero, final' });
  check('a title the caller supplies wins', recorded[0]?.title === 'Hero, final',
    `got ${JSON.stringify(recorded[0]?.title)}`);

  // 4. The file really lands on disk, at the URL the row advertises.
  const url = recorded[0]?.url || '';
  const m = /^\/api\/brand\/file\/client-1\/(design-[\w.-]+)$/.exec(url);
  check('the url is a brand-file path under the client', !!m, `got ${url}`);
  if (m) {
    const onDisk = path.join(__dirname, '..', 'uploads', 'client-1', m[1]);
    check('and the bytes are there', fs.existsSync(onDisk), onDisk);
    if (fs.existsSync(onDisk)) {
      const b = fs.readFileSync(onDisk);
      check('as a real PNG, not the data URL text',
        b[0] === 0x89 && b.slice(1, 4).toString() === 'PNG', `first bytes ${b.slice(0, 8).toString('hex')}`);
      fs.rmSync(path.join(__dirname, '..', 'uploads', 'client-1'), { recursive: true, force: true });
    }
  }

  // 5. The page's own size wins over the set's, because a set holds a post
  //    and the story cut from it.
  recorded.length = 0;
  pageRow = { ...pageRow, width: 1080, height: 1920 };
  await post(PAGE, { data_url: PNG });
  check('the page\'s own size is recorded when the caller sends none',
    recorded[0]?.width === 1080 && recorded[0]?.height === 1920,
    `got ${recorded[0]?.width}x${recorded[0]?.height}`);

  // 6. What it refuses.
  recorded.length = 0;
  r = await post(PAGE, { data_url: 'data:image/svg+xml;base64,PHN2Zy8+' });
  check('an SVG data URL is refused', r.status === 400 && !recorded.length,
    `status ${r.status} — it is stored and served back with a Content-Type, so this is the stored-XSS case`);

  r = await post(PAGE, { data_url: 'not a data url' });
  check('so is anything that is not a PNG or JPEG data URL', r.status === 400 && !recorded.length,
    `status ${r.status}`);

  // `base64,` with nothing after it fails the data-URL pattern, so it never
  // reaches the length check. `base64,=` passes the pattern and decodes to
  // zero bytes, which is the input that check exists for — found by the
  // mutation run, where deleting the check changed nothing.
  r = await post(PAGE, { data_url: 'data:image/png;base64,=' });
  check('and a render that decodes to nothing', r.status === 400 && !recorded.length,
    `status ${r.status} — ${r.raw}`);

  // Under express's own 20mb body limit, so the route's cap is what refuses
  // it. 18MB of base64 decodes to ~13.5MB, over the 12MB cap. Sending more
  // than 20mb threw PayloadTooLargeError before this route saw it, which is
  // a different answer to a different question.
  r = await post(PAGE, { data_url: `data:image/png;base64,${'A'.repeat(18 * 1024 * 1024)}` });
  check('and one too large to file', r.status === 413 && !recorded.length, `status ${r.status}`);

  // 7. A scratch set has no client, so there is nowhere to file it.
  recorded.length = 0;
  project = { id: PROJ, client_id: null, name: 'Scratch', width: 1080, height: 1080 };
  r = await post(PAGE, { data_url: PNG });
  // Checked by its reason, not just by the status. Without the guard the
  // route gets as far as path.join(UPLOAD_ROOT, null), throws, and answers
  // 400 from the catch — the same status for a different reason, which the
  // mutation run showed this assertion could not tell apart.
  check('a set with no client is refused, and says why',
    r.status === 400 && !recorded.length
      && /does not belong to a client/.test(r.body?.error || ''),
    `status ${r.status} — ${r.raw}`);
  project = { id: PROJ, client_id: 'client-1', name: 'Autumn launch', width: 1080, height: 1080 };

  // 8. A page that does not exist.
  r = await post('11111111-0000-0000-0000-000000000000', { data_url: PNG });
  check('an unknown page is a 404', r.status === 404, `status ${r.status}`);
  r = await post('not-a-uuid', { data_url: PNG });
  check('and so is an id that is not a uuid', r.status === 404, `status ${r.status}`);

  server.close();
  console.log('---');
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
  console.log('A FINISHED DESIGN IS FINDABLE, AND KNOWS WHERE IT CAME FROM');
})().catch((e) => { console.error(e); process.exit(1); });
