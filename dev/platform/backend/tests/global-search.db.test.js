/**
 * The search box, against a real Postgres.
 *
 * tests/global-search.test.js reads the generated SQL as text, which is how it
 * checks every entity carries the tenant scope. What it cannot do is run the
 * query — and the first version it passed did not execute at all: each UNION
 * ALL arm carries its own ORDER BY and LIMIT, and Postgres rejects those unless
 * the arm is parenthesised. Every assertion was green against SQL that answered
 * `syntax error at or near "UNION"`.
 *
 * So the claim that matters most — a client login never sees another client's
 * records — is made here, against two real clients with real rows in six
 * tables, rather than inferred from the shape of a string.
 *
 *   DB_HOST=/tmp DB_PORT=55434 DB_NAME=omi DB_USER=postgres node tests/global-search.db.test.js
 */
const pool = require('../src/db');
const { search } = require('../src/services/globalSearch');

let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label, extra === undefined ? '' : `— ${JSON.stringify(extra)}`); failures += 1; }
};

// A term both clients share, so scoping is the only thing that separates them.
const TERM = 'Kestrelware';

async function main() {
  const tag = `kestrel-${Date.now()}`;
  let A, B;
  try {
    A = (await pool.query(
      `INSERT INTO clients (name, slug) VALUES ($1, $2) RETURNING id`,
      [`${TERM} Ltd`, `${tag}-a`])).rows[0].id;
    B = (await pool.query(
      `INSERT INTO clients (name, slug) VALUES ($1, $2) RETURNING id`,
      [`${TERM} Rival`, `${tag}-b`])).rows[0].id;

    // One row per searchable kind for A, and a matching one for B wherever the
    // table has a client_id, so any missing scope shows up as a B row in A's
    // results rather than as an absence.
    const seed = async (cid, who) => {
      await pool.query(`INSERT INTO outreach_contacts (client_id, name, company) VALUES ($1,$2,'Dezeen')`,
        [cid, `${TERM} ${who} contact`]);
      await pool.query(`INSERT INTO pr_press_releases (client_id, title, status) VALUES ($1,$2,'draft')`,
        [cid, `${TERM} ${who} release`]);
      await pool.query(`INSERT INTO pr_editorial_log (client_id, story_title, status) VALUES ($1,$2,'published')`,
        [cid, `${TERM} ${who} coverage`]);
      await pool.query(`INSERT INTO outreach_campaigns (client_id, name, kind, status) VALUES ($1,$2,'press_release','draft')`,
        [cid, `${TERM} ${who} campaign`]);
      await pool.query(`INSERT INTO recordings (client_id, title, status, public_token) VALUES ($1,$2,'ready',gen_random_uuid()::text)`,
        [cid, `${TERM} ${who} recording`]);
    };
    await seed(A, 'own');
    await seed(B, 'rival');

    console.log('the search box, against a real database\n');

    // ── the one that matters ─────────────────────────────────────────────────
    const asA = await search(TERM, { visibleClientIds: [A] });
    const foreign = asA.filter(r => r.client_id !== A);
    ok(foreign.length === 0,
      'a login scoped to one client sees none of the other\'s records',
      foreign.map(r => `${r.type}:${r.title}`));
    ok(asA.length >= 6,
      'and still sees its own, across every kind',
      asA.map(r => r.type));
    ok(new Set(asA.map(r => r.type)).size >= 6,
      'six kinds of record are reachable at once',
      [...new Set(asA.map(r => r.type))]);

    // ── the query runs at all ────────────────────────────────────────────────
    const both = await search(TERM, { visibleClientIds: [A, B] });
    ok(both.length > asA.length, 'an agency login sees more than one client\'s worth',
      { both: both.length, one: asA.length });
    ok(both.every(r => r.leaf && r.screen && r.client_id),
      'every result carries somewhere to open',
      both.filter(r => !(r.leaf && r.screen && r.client_id)));

    // ── the edges ────────────────────────────────────────────────────────────
    ok((await search(TERM, { visibleClientIds: [] })).length === 0,
      'a caller with no visible clients gets nothing');
    ok((await search(TERM, { visibleClientIds: null })).length === 0,
      'and a missing scope is not read as "everything"');
    ok((await search('K', { visibleClientIds: [A, B] })).length === 0,
      'a single character does not run a query');

    const inject = await search(`'; DROP TABLE clients; --`, { visibleClientIds: [A, B] });
    const clientsAlive = (await pool.query('SELECT count(*)::int AS n FROM clients')).rows[0].n;
    ok(inject.length === 0 && clientsAlive > 0,
      'a term full of SQL is a term, not SQL',
      { results: inject.length, clients: clientsAlive });

    // ── ranking ──────────────────────────────────────────────────────────────
    const exact = await search(`${TERM} Ltd`, { visibleClientIds: [A, B] });
    ok(exact.length > 0 && exact[0].title === `${TERM} Ltd`,
      'an exact title comes first', exact.slice(0, 3).map(r => r.title));
  } finally {
    // clients cascade to everything seeded above.
    for (const id of [A, B]) {
      if (id) await pool.query('DELETE FROM clients WHERE id = $1', [id]).catch(() => {});
    }
    await pool.end();
  }

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
  console.log('\nall passed');
}

main().catch(err => { console.error(err); process.exit(1); });
