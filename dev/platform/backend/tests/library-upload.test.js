// Guard — footage can be dropped in, several at a time.
//
// The only way footage entered OMI was the single-file picker on the Footage
// step, which turns one clip into one draft edit job. Drop five and four were
// discarded: there was nowhere to put them, because the asset library took no
// uploads at all. "Assets are created by whichever tool produced them, never
// by posting here" is the rule at the top of routes/assets.js, and an upload
// is the one case where the posting *is* the producer.
//
// What this pins down is the part that is easy to get wrong in a file upload
// and expensive to get wrong: what is accepted, what the file is called on
// disk, and whether a file that failed to index is reported rather than left
// sitting on disk invisible.
//
// The route runs for real, with multipart bodies built by hand, against a
// stubbed library.

const path = require('path');
const express = require('express');
const http = require('http');
const fs = require('fs');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

const recorded = [];
let indexFails = false;

const stub = (modPath, exports) => {
  require.cache[require.resolve(modPath)] = { id: modPath, filename: modPath, loaded: true, exports };
};
const passthrough = (req, res, next) => next();

stub(path.join(__dirname, '..', 'src', 'db.js'), { query: async () => ({ rows: [], rowCount: 0 }) });
stub(path.join(__dirname, '..', 'src', 'middleware', 'auth.js'), { authenticate: passthrough });
stub(path.join(__dirname, '..', 'src', 'middleware', 'clientAccess.js'), {
  loadVisibleClientIds: passthrough,
  requireClientAccess: () => passthrough,
  assertClientAccess: () => {},
  requireAdmin: passthrough,
});
stub(path.join(__dirname, '..', 'src', 'services', 'assets.js'), {
  // record() never throws at its caller, by design. The upload route has to
  // notice a null and say so, which is what indexFails exercises.
  record: async (a) => {
    if (indexFails) return null;
    recorded.push(a);
    return { id: `asset-${recorded.length}`, ...a };
  },
  list: async () => [], counts: async () => ({}), get: async () => null,
});

const router = require('../src/routes/assets');

const app = express();
app.use('/api', router);
const server = app.listen(0);

const CLIENT = 'client-1';
const DIR = path.join(__dirname, '..', 'uploads', CLIENT);

// A multipart body, built by hand so this needs no test-only dependency.
function multipart(files) {
  const b = '----omitest' + Math.random().toString(36).slice(2);
  const parts = [];
  for (const f of files) {
    parts.push(Buffer.from(
      `--${b}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\n`
      + `Content-Type: ${f.type}\r\n\r\n`));
    parts.push(Buffer.isBuffer(f.body) ? f.body : Buffer.from(f.body || 'x'));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${b}` };
}

function upload(files) {
  const { body, type } = multipart(files);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method: 'POST',
      path: `/api/clients/${CLIENT}/assets/upload`,
      headers: { 'content-type': type, 'content-length': body.length },
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
    req.end(body);
  });
}

const clean = () => fs.rmSync(DIR, { recursive: true, force: true });

(async () => {
  // 1. Several files in one go, which is the whole point.
  recorded.length = 0; indexFails = false; clean();
  let r = await upload([
    { name: 'one.mp4', type: 'video/mp4', body: 'aaa' },
    { name: 'two.mov', type: 'video/quicktime', body: 'bbb' },
    { name: 'three.png', type: 'image/png', body: 'ccc' },
  ]);
  check('three files in one request are all filed',
    r.status === 201 && r.body?.added?.length === 3,
    `status ${r.status}, added ${r.body?.added?.length} — ${r.raw.slice(0, 200)}`);
  check('each as an upload', recorded.every((a) => a.source === 'upload'),
    recorded.map((a) => a.source).join(','));
  check('under the client in the path', recorded.every((a) => a.client_id === CLIENT),
    recorded.map((a) => a.client_id).join(','));

  // 2. The name the operator sees is theirs; the name on disk is not.
  check('the title is the name the operator gave the file',
    recorded.map((a) => a.title).join(',') === 'one.mp4,two.mov,three.png',
    recorded.map((a) => a.title).join(','));
  check('but nothing on disk is named from the upload',
    recorded.every((a) => /\/up-\d+-[0-9a-f]{6}\.(mp4|mov|png)$/.test(a.url)),
    `${recorded.map((a) => a.url).join(' ')} — a filename from a client is attacker input, `
    + 'and this one ends up in a URL that is served back with a Content-Type');
  check('and each file is distinct on disk',
    new Set(recorded.map((a) => a.url)).size === 3,
    'two files uploaded in the same millisecond must not collide');

  // 3. The kind is worked out, because the library filters on it.
  check('a video is filed as a video and a png as an image',
    recorded[0].mime === 'video/mp4' && recorded[2].mime === 'image/png',
    recorded.map((a) => a.mime).join(','));

  // 4. The bytes are on disk at the URL the row advertises.
  const first = /\/api\/brand\/file\/client-1\/(up-[\w.-]+)$/.exec(recorded[0].url);
  check('the url is a brand-file path under the client', !!first, recorded[0].url);
  if (first) {
    check('and the bytes are there', fs.existsSync(path.join(DIR, first[1])),
      path.join(DIR, first[1]));
  }

  // 5. What it refuses. SVG is the one worth naming: the brand kit allows it
  //    and pays for it with a sanitiser and a serve-time CSP sandbox.
  recorded.length = 0; clean();
  r = await upload([{ name: 'logo.svg', type: 'image/svg+xml', body: '<svg/>' }]);
  check('an SVG is refused, with a reason', r.status === 400 && /brand kit/i.test(r.body?.error || ''),
    `status ${r.status}, ${r.body?.error}`);
  check('and nothing was filed', !recorded.length);

  recorded.length = 0; clean();
  r = await upload([{ name: 'notes.pdf', type: 'application/pdf', body: '%PDF' }]);
  check('so is a document', r.status === 400 && !recorded.length,
    `status ${r.status} — this is the footage library, not a drive`);

  // 6. An empty request.
  recorded.length = 0; clean();
  r = await upload([]);
  check('an empty request is a 400, not a 201 with nothing in it',
    r.status === 400 && !recorded.length, `status ${r.status}`);

  // 7. A file that cannot be indexed is reported.
  //
  // record() swallows its own errors so a finished render is never lost to a
  // library that is briefly down. Here the file on disk with no row is simply
  // invisible, so the upload has to name what did not make it.
  recorded.length = 0; clean(); indexFails = true;
  r = await upload([{ name: 'lost.mp4', type: 'video/mp4', body: 'zzz' }]);
  check('a file that could not be indexed comes back under failed',
    r.body?.failed?.includes('lost.mp4'),
    `${r.raw} — a file on disk with no library row is invisible, so silence is the wrong answer`);
  check('and the request is not reported as a success',
    r.status !== 201, `status ${r.status}`);
  indexFails = false;

  clean();
  server.close();
  console.log('---');
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
  console.log('FOOTAGE GOES IN, SEVERAL AT A TIME');
})().catch((e) => { console.error(e); process.exit(1); });
