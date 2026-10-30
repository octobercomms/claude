// The search box reaches across eight tables at once, which makes it the one
// endpoint where a scoping mistake hands one client another client's records.
//
// Every other route file guards its own tables and was reviewed on its own.
// This one borrows all of them, so "did I remember the WHERE clause" has eight
// chances to be wrong and only one place to check. These assertions read the
// generated SQL rather than trusting the shape of the source, because the
// predicate is what the database acts on.
//
// Also guards the half that is easy to break silently: every result names a
// section leaf and a screen slug, and the browser builds the URL from them
// against nav/sections.js. A renamed screen would leave search pointing at a
// slug that resolves to the section default — no error, just the wrong page.
//
//   node tests/global-search.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ENTITIES, selectFor, PER_TYPE, TOTAL } = require('../src/services/globalSearch');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('the search box');

// ── tenant isolation ─────────────────────────────────────────────────────────

check('every entity filters on the caller\'s visible clients', () => {
  for (const e of ENTITIES) {
    const sql = selectFor(e);
    const col = e.scopeColumn || 'client_id';
    assert.ok(sql.includes(`${col} = ANY($1::uuid[])`),
      `${e.type} (${e.table}) does not scope on ${col}. Without it this entity returns `
      + 'every row in the table to every logged-in user.');
  }
});

check('the scope is a WHERE, not a filter applied afterwards', () => {
  for (const e of ENTITIES) {
    const sql = selectFor(e);
    const where = sql.indexOf('WHERE');
    const scope = sql.indexOf('= ANY($1::uuid[])');
    const limit = sql.indexOf('LIMIT');
    assert.ok(where > -1 && scope > where,
      `${e.type}: the scope predicate is not inside the WHERE clause`);
    assert.ok(scope < limit,
      `${e.type}: the row limit is applied before the scope, so a client with many `
      + 'records could push another client\'s rows into the result');
  }
});

check('the search term is a parameter, never interpolated', () => {
  // The term comes straight off a query string. Interpolating it would be an
  // injection into a query that reads eight tables.
  for (const e of ENTITIES) {
    const sql = selectFor(e);
    assert.ok(sql.includes('ILIKE $2'), `${e.type}: the term is not bound as $2`);
    assert.ok(!/ILIKE\s*'/.test(sql), `${e.type}: the term looks interpolated into the SQL`);
  }
});

check('the route takes the scope from the session, never from the request', () => {
  // visibleClientIds is what the middleware worked out. A client_id in the
  // query string must not be able to widen it.
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'search.js'), 'utf8');
  assert.ok(/visibleClientIds:\s*req\.visibleClientIds/.test(route),
    'the route must pass req.visibleClientIds');
  assert.ok(!/req\.query\.client_id|req\.body\.client_id/.test(route),
    'the route reads a client id from the request — the scope must come from the session alone');
  assert.ok(/loadVisibleClientIds/.test(route) && /authenticate/.test(route),
    'the route must authenticate and load the visible clients before searching');
});

check('an empty scope returns nothing rather than everything', () => {
  // A user with no visible clients must not fall through to an unfiltered
  // query. `= ANY('{}')` is false for every row, but the service returns early
  // rather than relying on that, because an early return cannot be defeated by
  // a later change to how the array is passed.
  const svc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'globalSearch.js'), 'utf8');
  assert.ok(/if \(!ids\.length\) return \[\]/.test(svc),
    'globalSearch must return early when the caller can see no clients');
});

// ── results point somewhere real ─────────────────────────────────────────────

// Where each entity's results open is checked from the frontend side, in
// tests/routeTargets.test.mjs: nav/sections.js is an ES module that this CJS
// test cannot import, and a first attempt at parsing it with a regex silently
// read tab keys where it meant slugs and reported a screen as missing that was
// there. A check that can be wrong about what it is checking is worse than one
// that lives on the other side of the fence.

check('a client result links to the client it is', () => {
  // The clients entity has no client_id column; its own id is the link target.
  const c = ENTITIES.find(e => e.type === 'client');
  assert.ok(c, 'there is no client entity');
  assert.strictEqual(c.scopeColumn, 'id');
  assert.strictEqual(c.clientIdExpr, 'id');
  assert.ok(selectFor(c).includes('id::text AS client_id'),
    'a client result must carry its own id as the client to open');
});

check('every entity says what opening its result does', () => {
  // Three answers, and a kind added later has to pick one rather than
  // defaulting to "land on a list and leave them to find it", which is what
  // every result did before.
  const KINDS = ['record', 'reveal', 'screen'];
  for (const e of ENTITIES) {
    assert.ok(KINDS.includes(e.opens),
      `${e.type}: opens is ${JSON.stringify(e.opens)}, not one of ${KINDS.join(' / ')}`);
  }
  // 'screen' is for a result that IS its screen. Only a client is, and giving
  // another entity that answer silently drops the record id from the URL.
  const asScreen = ENTITIES.filter(e => e.opens === 'screen').map(e => e.type);
  assert.deepStrictEqual(asScreen, ['client'],
    'only the client entity is its own screen; anything else with opens:"screen" '
    + 'loses the record id and lands on a list');
});

check('an entity whose screen shows a subset of its table says so', () => {
  // Coverage was the case: the screen lists `status NOT IN ('new','dismissed')`
  // and search read the whole table, so a 'new' row — one still in the Monitor
  // review queue — could be found and then not be on the screen it opened.
  const coverage = ENTITIES.find(e => e.type === 'coverage');
  assert.ok(coverage.where && /status NOT IN/.test(coverage.where),
    'the coverage entity no longer narrows to what its screen shows');
  assert.ok(selectFor(coverage).includes(coverage.where),
    'the where clause is declared but never reaches the SQL');

  // And the clause is a WHERE, not something applied after the per-type limit.
  const sql = selectFor(coverage);
  assert.ok(sql.indexOf(coverage.where) < sql.indexOf('LIMIT'),
    'the entity condition is applied after the row limit, so excluded rows '
    + 'still take up slots the visible ones should have had');
});

check('an entity with no condition generates no stray AND', () => {
  // `where` is optional; the ones without it must not emit an empty predicate.
  const plain = ENTITIES.find(e => !e.where);
  assert.ok(plain, 'every entity now has a where clause — this check is moot');
  assert.ok(!/AND \(\)/.test(selectFor(plain)), `${plain.type} emits an empty AND ()`);
});

check('the entity table can be read without a database', () => {
  // routeTargets.test.mjs loads this table to check where each kind of result
  // opens, and it runs in the frontend CI job, which installs only the
  // frontend's dependencies. A require here reaches src/db.js and `pg`, which
  // is not there — and passes locally, where the backend's node_modules are.
  const entities = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'globalSearch.entities.js'), 'utf8');
  const requires = entities.match(/\brequire\s*\(/g) || [];
  assert.deepStrictEqual(requires, [],
    'globalSearch.entities.js must require nothing: the frontend test that reads it '
    + 'runs where the backend\'s dependencies are not installed');

  const svc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'globalSearch.js'), 'utf8');
  assert.ok(/require\('\.\/globalSearch\.entities'\)/.test(svc),
    'the service must take the table from that file, or there are two tables');
  assert.ok(!/^const ENTITIES = \[/m.test(svc),
    'the service declares its own ENTITIES again — the two would drift');
});

// ── shape ────────────────────────────────────────────────────────────────────

check('every entity declares what it needs', () => {
  const seen = new Set();
  for (const e of ENTITIES) {
    for (const k of ['type', 'label', 'table', 'title', 'columns', 'leaf', 'screen']) {
      assert.ok(e[k], `${e.type || e.table}: missing '${k}'`);
    }
    assert.ok(Array.isArray(e.columns) && e.columns.length, `${e.type}: no searchable columns`);
    assert.ok(e.columns.includes(e.title), `${e.type}: the title column must itself be searchable`);
    assert.ok(!seen.has(e.type), `two entities share the type '${e.type}'`);
    seen.add(e.type);
  }
});

check('one kind of record cannot crowd out the rest', () => {
  assert.ok(PER_TYPE > 0 && PER_TYPE <= 10, `PER_TYPE is ${PER_TYPE}`);
  assert.ok(TOTAL >= PER_TYPE * 2, 'the overall cap must leave room for more than two kinds');
  for (const e of ENTITIES) {
    // Anchored on the closing paren of the UNION arm, not a substring: a cap
    // raised to 500 still "includes" LIMIT 5, and that mutation went
    // uncaught the first time.
    assert.ok(new RegExp(`LIMIT ${PER_TYPE}\\)`).test(selectFor(e)),
      `${e.type} does not cap its own rows at ${PER_TYPE}, so it could fill the whole result`);
  }
});

check('rows with no title are not returned', () => {
  // An untitled draft is a blank line in the results that navigates somewhere.
  for (const e of ENTITIES) {
    const sql = selectFor(e);
    assert.ok(sql.includes(`${e.title} IS NOT NULL`) && sql.includes(`${e.title} <> ''`),
      `${e.type}: a row with an empty ${e.title} would render as a blank result`);
  }
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
