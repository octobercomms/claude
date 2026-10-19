// Guard — a hand-added journalist is a journalist, and is only added once.
//
// Two bugs this pins down, both found on 19 Oct 2026 when Daniel asked how to
// add a single journalist and the answer was that there was no way to.
//
// 1. POST /outreach/contacts dropped `kind`. The column defaults to
//    'prospect', and every press surface filters on kind='media', so a
//    journalist added through the one single-contact form in the product was
//    invisible to audiences, journalist search and release sends. Nothing
//    errored. You found out when they were missing from a send.
//
// 2. The library is workspace-wide with no unique index on email, so the same
//    create call would mint a second record for someone already in it — the
//    duplicates the Cleanup Centre exists to merge back.
//
// The route is exercised for real against a stubbed pool and stubbed auth, so
// this needs no database and no network: the assertions are about what SQL the
// handler issues and what it answers, not about pattern-matching its source.

const path = require('path');
const express = require('express');
const http = require('http');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

// --- stubs, installed before the route is required -------------------------

const queries = [];
let existingRow = null;  // what findExisting should turn up

const fakePool = {
  query: async (sql, params = []) => {
    queries.push({ sql, params });
    const s = sql.replace(/\s+/g, ' ');
    if (/^SELECT \* FROM outreach_contacts WHERE lower\(email\)/.test(s)) {
      return { rows: existingRow && existingRow.email === params[0] ? [existingRow] : [] };
    }
    if (/^SELECT \* FROM outreach_contacts WHERE lower\(name\)/.test(s)) {
      return { rows: [] };
    }
    if (/INSERT INTO outreach_contacts/.test(s)) {
      // Echo the kind the handler decided on, which is what we are testing.
      const kindParamIdx = s.match(/COALESCE\(\$(\d+), 'prospect'\)/);
      const kind = kindParamIdx ? (params[Number(kindParamIdx[1]) - 1] || 'prospect') : 'prospect';
      return { rows: [{ id: 'new-id', name: params[1], email: params[4], kind }] };
    }
    return { rows: [], rowCount: 0 };
  },
};

const stub = (modPath, exports) => {
  require.cache[require.resolve(modPath)] = { id: modPath, filename: modPath, loaded: true, exports };
};
const passthrough = (req, res, next) => next();

stub(path.join(__dirname, '..', 'src', 'db.js'), fakePool);
stub(path.join(__dirname, '..', 'src', 'middleware', 'auth.js'), {
  authenticate: passthrough, requireAdmin: passthrough,
});
stub(path.join(__dirname, '..', 'src', 'middleware', 'clientAccess.js'), {
  loadVisibleClientIds: passthrough,
  requireClientAccess: () => passthrough,
  checkClientIdFromBodyOrQuery: passthrough,
  assertClientAccess: async () => {},
});

const router = require('../src/routes/outreach');

// --- a throwaway server ---------------------------------------------------

const app = express();
app.use(express.json());
app.use('/api/outreach', router);
const server = app.listen(0);

function post(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method: 'POST',
      path: '/api/outreach/contacts',
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

const insertOf = () => queries.filter(q => /INSERT INTO outreach_contacts/.test(q.sql)).pop();
const attachesOf = () => queries.filter(q => /INSERT INTO outreach_contact_clients/.test(q.sql));

(async () => {
  // 1. kind=media survives the round trip.
  queries.length = 0; existingRow = null;
  let r = await post({ name: 'Jane Smith', email: 'jane@dezeen.com', company: 'Dezeen', kind: 'media' });
  check('a journalist is created as kind=media', r.status === 201 && r.body?.kind === 'media',
    `status ${r.status}, kind ${r.body?.kind} — a journalist filed as anything else is invisible to every press surface`);

  const ins = insertOf();
  check('the insert names the kind column', !!ins && /\bkind\b/.test(ins.sql),
    ins ? 'kind is missing from the column list' : 'no insert was issued');

  // 2. a kind nobody queries for cannot reach the column.
  queries.length = 0; existingRow = null;
  r = await post({ name: 'Bad Kind', email: 'bad@kind.com', kind: 'journalist' });
  check('an unrecognised kind falls back to prospect rather than being stored',
    r.status === 201 && r.body?.kind === 'prospect', `got ${r.body?.kind}`);

  // 3. no kind at all still behaves as it always did.
  queries.length = 0; existingRow = null;
  r = await post({ name: 'No Kind', email: 'no@kind.com' });
  check('a caller that states no kind gets a prospect', r.status === 201 && r.body?.kind === 'prospect',
    `got ${r.body?.kind}`);

  // 4. someone already in the library is handed back, not duplicated.
  queries.length = 0;
  existingRow = { id: 'existing-id', name: 'Jane Smith', email: 'jane@dezeen.com', company: 'Dezeen', kind: 'prospect' };
  r = await post({ name: 'Jane Smith', email: 'Jane@Dezeen.com', company: 'Dezeen', kind: 'media', client_id: 'client-1' });
  check('an email already in the library creates nothing', r.status === 200 && !insertOf(),
    insertOf() ? 'a second record was inserted' : `status ${r.status}`);
  check('the existing record comes back flagged',
    r.body?.id === 'existing-id' && r.body?.already_in_library === true,
    JSON.stringify(r.body));
  check('the existing record is still attached to the requested client',
    attachesOf().some(q => q.params[0] === 'existing-id' && q.params[1] === 'client-1'),
    'the add silently did nothing for that client');
  check('the duplicate check is case-insensitive about the address',
    queries.some(q => /lower\(email\)/.test(q.sql) && q.params[0] === 'jane@dezeen.com'),
    'a capitalised address would have slipped past and made a duplicate');
  check('an existing record is never re-kinded behind the operator\'s back',
    r.body?.kind === 'prospect',
    'the typed kind overwrote what was already filed — that belongs to the edit modal, with the change visible');

  // 5. a row nothing can find and nothing can email is refused.
  queries.length = 0; existingRow = null;
  r = await post({ company: 'Dezeen' });
  check('a contact with neither name nor email is refused', r.status === 400 && !insertOf(),
    `status ${r.status}`);

  // --- the UI half ---------------------------------------------------------
  const fs = require('fs');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', ...p), 'utf8');
  const addModal = read('components', 'AddContactModal.jsx');
  const settings = read('pages', 'SettingsPage.jsx');

  check('the add form sends the kind it was given', /kind: defaultKind/.test(addModal),
    'without this the form is the prospect-default hole again');
  check('the journalist library asks for media', /defaultKind="media"/.test(settings),
    'Settings → Database → Journalists must default to press');
  check('the journalist library offers a single add', /AddContactModal/.test(settings)
    && /Add journalist/.test(settings), 'there is no way to add one by hand');
  check('the add form handles the already-in-library answer', /already_in_library/.test(addModal),
    'a duplicate would report as a fresh save');

  // The two halves have to agree on the value, or a correctly created
  // journalist still fails to appear.
  const press = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'press.js'), 'utf8');
  check('journalist search still selects on the same value', /oc\.kind = 'media'/.test(press),
    'press.js no longer filters on kind=media — this test is pinning the wrong value');

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('harness failed:', e);
  server.close();
  process.exit(1);
});
