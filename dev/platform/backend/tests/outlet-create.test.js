// Guard — a publication can be added by hand, and only once.
//
// Until 1 November a publication could only arrive two ways: by being named in
// a piece of coverage, or by a CSV import. A title Daniel wanted to pitch but
// had never covered could not be put in the database at all, which is why
// Publications had no primary action of its own and wore a whole-database
// sweep instead.
//
// The duplicate check is the point of the route rather than a nicety. Every
// dedup tool on the Database tools page exists because near-identical
// publications got in, and a create form that waved them through would be
// feeding the thing that cleans up after it. So a clash answers 409 and hands
// back the row it clashed with, which the UI turns into "open it".
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
let clashRow = null;   // what the clash SELECT should turn up

const fakePool = {
  query: async (sql, params = []) => {
    queries.push({ sql, params });
    const s = sql.replace(/\s+/g, ' ');
    if (/SELECT id, name, domain FROM pr_outlets/.test(s)) {
      return { rows: clashRow ? [clashRow] : [], rowCount: clashRow ? 1 : 0 };
    }
    if (/INSERT INTO pr_outlets/.test(s)) {
      return { rows: [{
        id: 'new-outlet', name: params[0], domain: params[1], url: params[2],
        tier: params[3], region: params[4], rss_url: null, rss_status: 'unknown',
      }], rowCount: 1 };
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
// requireAdmin comes from clientAccess in pr.js, not from auth. Stubbing the
// wrong one leaves it undefined and express refuses the route outright, which
// is how this was caught.
stub(path.join(__dirname, '..', 'src', 'middleware', 'clientAccess.js'), {
  requireAdmin: passthrough,
  loadVisibleClientIds: passthrough,
  requireClientAccess: () => passthrough,
  checkClientIdFromBodyOrQuery: passthrough,
  assertClientAccess: async () => {},
});

const router = require('../src/routes/pr');

const app = express();
app.use(express.json());
app.use('/api/pr', router);
const server = app.listen(0);

function post(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method: 'POST',
      path: '/api/pr/outlets',
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

const insertOf = () => queries.filter((q) => /INSERT INTO pr_outlets/.test(q.sql)).pop();
const clashOf = () => queries.filter((q) => /SELECT id, name, domain FROM pr_outlets/.test(q.sql)).pop();

(async () => {
  // 1. The ordinary case.
  queries.length = 0; clashRow = null;
  let r = await post({ name: 'Dezeen', url: 'dezeen.com', tier: 'T1', region: 'UK' });
  check('a named publication is created', r.status === 201 && r.body?.id === 'new-outlet',
    `status ${r.status}, body ${r.raw}`);
  check('and comes back with the zero counts the list column expects',
    r.body?.coverage === 0 && r.body?.contacts === 0,
    'the Publications row renders coverage and contacts, so undefined would print blank cells');

  // 2. The URL is made a URL, and the domain falls out of it.
  //
  // The domain is what the dedup scan and the feed finder both match on, and
  // nobody types it twice. A bare "dezeen.com" with no scheme is what anyone
  // actually types, and `new URL()` throws on it.
  let ins = insertOf();
  check('a scheme-less website is stored as https', ins?.params?.[2] === 'https://dezeen.com',
    `stored ${JSON.stringify(ins?.params?.[2])}`);
  check('and the domain is derived from it', ins?.params?.[1] === 'dezeen.com',
    `stored ${JSON.stringify(ins?.params?.[1])}`);

  queries.length = 0; clashRow = null;
  await post({ name: 'Wallpaper', url: 'https://www.wallpaper.com/section/design' });
  ins = insertOf();
  check('www and the path are stripped off the derived domain', ins?.params?.[1] === 'wallpaper.com',
    `stored ${JSON.stringify(ins?.params?.[1])}`);

  queries.length = 0; clashRow = null;
  await post({ name: 'Icon', domain: 'HTTPS://WWW.Iconeye.com/' });
  ins = insertOf();
  check('a domain typed as a URL is normalised rather than stored raw',
    ins?.params?.[1] === 'iconeye.com', `stored ${JSON.stringify(ins?.params?.[1])}`);

  // 3. A name is the one thing required.
  queries.length = 0; clashRow = null;
  r = await post({ url: 'nowhere.com' });
  check('a publication with no name is refused', r.status === 400 && !insertOf(),
    insertOf() ? 'it was inserted anyway' : `status ${r.status}`);

  queries.length = 0; clashRow = null;
  r = await post({ name: '   ' });
  check('and so is one whose name is only spaces', r.status === 400 && !insertOf(),
    insertOf() ? 'it was inserted anyway' : `status ${r.status}`);

  // 4. The duplicate check, which is why the route exists in this shape.
  queries.length = 0;
  clashRow = { id: 'already-here', name: 'Dezeen', domain: 'dezeen.com' };
  r = await post({ name: 'dezeen', url: 'dezeen.com' });
  check('a name already in the database inserts nothing', !insertOf(),
    'a second Dezeen was created');
  check('it answers 409', r.status === 409, `status ${r.status}`);
  check('and hands back the row it clashed with, so the UI can offer to open it',
    r.body?.existing?.id === 'already-here',
    `body ${r.raw} — without the row the user is told "already there" and left to find it`);

  const q = clashOf();
  check('the clash check runs before the insert and ignores case',
    !!q && /lower\(name\) = lower\(/.test(q.sql.replace(/\s+/g, ' ')),
    'a case-sensitive check lets Dezeen and dezeen both in, which is the exact duplicate the dedup tool merges');
  check('it checks canonical_name too',
    !!q && /lower\(canonical_name\)/.test(q.sql.replace(/\s+/g, ' ')),
    'merged outlets keep their old name in canonical_name; skipping it lets a merged-away title back in');
  check('and it skips the domain comparison when no domain was given',
    !!q && /\$2 <> ''/.test(q.sql.replace(/\s+/g, ' ')),
    'otherwise every publication with a blank domain clashes with every other one');

  queries.length = 0;
  clashRow = { id: 'already-here', name: 'Dezeen', domain: 'dezeen.com' };
  r = await post({ name: 'Something Else Entirely', url: 'dezeen.com' });
  check('a clash on the domain alone is still a clash', r.status === 409 && !insertOf(),
    `status ${r.status} — two rows on one domain is the other half of what the dedup scan finds`);

  // 5. Tier is a closed set.
  queries.length = 0; clashRow = null;
  await post({ name: 'Tiered', tier: 'T9' });
  ins = insertOf();
  check('an unrecognised tier is stored blank rather than kept', ins?.params?.[3] === '',
    `stored ${JSON.stringify(ins?.params?.[3])} — tier drives targeting and reporting, and T9 means nothing to either`);

  // 6. canonical_name is written in lockstep with name.
  //
  // PATCH already does this, after the two diverged and the chip on the
  // Publications row kept showing the old canonical_name. A create that set
  // only one of them would put every new publication straight into that state.
  queries.length = 0; clashRow = null;
  await post({ name: 'Locked' });
  ins = insertOf();
  const cols = ins?.sql.replace(/\s+/g, ' ') || '';
  check('the insert writes canonical_name as well as name',
    /\(name, canonical_name,/.test(cols) && /VALUES \(\$1, \$1,/.test(cols),
    `insert reads: ${cols.slice(0, 120)}`);

  server.close();
  console.log('---');
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
  console.log('A PUBLICATION CAN BE ADDED, AND ONLY ONCE');
})().catch((e) => { console.error(e); process.exit(1); });
