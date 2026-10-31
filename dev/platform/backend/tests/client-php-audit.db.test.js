// The PHP running on client sites, end to end, against a real Postgres.
//
// Not in CI: CI has no database, same as design-routes.db.test.js. Run it when
// you touch migration 210, routes/wpConnect.js or the H3 check:
//
//   DB_HOST=/tmp DB_PORT=55434 DB_NAME=phptest DB_USER=postgres \
//     node tests/client-php-audit.db.test.js
//
// What it protects is the answer to "which of our clients are exposed", which
// on 21 Oct 2026 was a round of phone calls. Two unauthenticated RCEs in PHP
// had been published with exploits demonstrated through WordPress, October
// ships plugins to client sites, and the platform threw away the version
// numbers the plugin was already sending it.

const path = require('path');
const fs = require('fs');

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE TABLE IF NOT EXISTS clients (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name TEXT);
CREATE TABLE IF NOT EXISTS connectors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  connector_type TEXT,
  credentials JSONB,
  status TEXT,
  store_label TEXT,
  error_message TEXT,
  last_checked TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const pool = require('../src/db');
const { phpSupport } = require('../src/utils/phpSupport');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

// The same statement routes/wpConnect.js runs, kept here so the test exercises
// the real write rule rather than a paraphrase of it.
const NOTE = `
  UPDATE connectors
     SET php_version = COALESCE($2, php_version),
         wp_version = COALESCE($3, wp_version),
         plugin_version = COALESCE($4, plugin_version),
         versions_seen_at = NOW()
   WHERE id = $1
     AND (php_version IS DISTINCT FROM COALESCE($2, php_version)
       OR wp_version IS DISTINCT FROM COALESCE($3, wp_version)
       OR plugin_version IS DISTINCT FROM COALESCE($4, plugin_version)
       OR versions_seen_at IS NULL
       OR versions_seen_at < NOW() - INTERVAL '1 day')`;

// The statement above is a copy, and a copy drifts. This is the lesson the
// design suite learned the hard way: a test that holds its own version of what
// the product runs will keep passing after the product changes.
function sameStatement(a, b) {
  const norm = (x) => x.replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

(async () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'wpConnect.js'), 'utf8');
  // Anchored on SET php_version: the file has another UPDATE connectors above
  // this one, and a looser pattern matched that and ran on through it.
  const live = (route.match(/`UPDATE connectors\s+SET php_version[\s\S]*?INTERVAL '1 day'\)`/) || [''])[0]
    .replace(/`/g, '');
  check('the statement under test is the one the route runs',
    !!live && sameStatement(live, NOTE),
    'routes/wpConnect.js and this test have drifted apart');

  await pool.query(SCHEMA);
  await pool.query(fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '210_connector_runtime_versions.sql'), 'utf8'));

  // Start from nothing. Without this the second run sees the first run's
  // rows, two clients named the same thing, and assertions that passed once
  // fail for a reason that has nothing to do with the code.
  await pool.query('TRUNCATE connectors, clients RESTART IDENTITY CASCADE');

  check('the migration adds the columns', true);
  const { rows: cols } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'connectors' AND column_name = ANY($1)`,
    [['php_version', 'wp_version', 'plugin_version', 'versions_seen_at']]);
  check('all four of them', cols.length === 4, cols.map(c => c.column_name).join(', '));

  const mk = async (name, status = 'active') => {
    // clients.slug is NOT NULL, so a fixture that omits it cannot insert.
    const slug = `php-audit-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
    const { rows: c } = await pool.query('INSERT INTO clients (name, slug) VALUES ($1, $2) RETURNING id', [name, slug]);
    const { rows: n } = await pool.query(
      `INSERT INTO connectors (client_id, connector_type, status) VALUES ($1, 'wordpress_plugin', $2) RETURNING id`,
      [c[0].id, status]);
    return n[0].id;
  };

  const old = await mk('Practice on 7.4');
  const soon = await mk('Practice on 8.2');
  const fine = await mk('Practice on 8.3');
  const quiet = await mk('Never pushed');

  await pool.query(NOTE, [old, '7.4.33', '6.7', '1.2.0']);
  await pool.query(NOTE, [soon, '8.2.35', '6.8', '1.2.0']);
  await pool.query(NOTE, [fine, '8.3.36', '6.8', '1.2.0']);

  const read = async (id) => (await pool.query('SELECT * FROM connectors WHERE id = $1', [id])).rows[0];
  check('a push records what the site runs', (await read(old)).php_version === '7.4.33');
  check('and when it said so', !!(await read(old)).versions_seen_at);
  check('a site that never pushed stays blank', (await read(quiet)).php_version === null);

  // --- the write rule ------------------------------------------------------
  // A push happens per event. Writing every time would be thousands of
  // pointless updates a day, so it writes on a change or once a day.
  // Compared as instants, not as strings: String(date) renders to whole
  // seconds, so two writes inside the same second read as identical and the
  // assertion passes whatever the statement did.
  const ms = (d) => new Date(d).getTime();
  const before = ms((await read(fine)).versions_seen_at);
  await new Promise(r => setTimeout(r, 50));
  await pool.query(NOTE, [fine, '8.3.36', '6.8', '1.2.0']);
  check('an unchanged push does not write again',
    ms((await read(fine)).versions_seen_at) === before);

  await pool.query(NOTE, [fine, '8.4.1', '6.8', '1.2.0']);
  check('a changed version does write', (await read(fine)).php_version === '8.4.1');
  check('and moves the timestamp', ms((await read(fine)).versions_seen_at) > before,
    `${new Date(before).toISOString()} -> ${(await read(fine)).versions_seen_at}`);

  await pool.query(`UPDATE connectors SET versions_seen_at = NOW() - INTERVAL '2 days' WHERE id = $1`, [fine]);
  await pool.query(NOTE, [fine, '8.4.1', '6.8', '1.2.0']);
  const refreshed = (await read(fine)).versions_seen_at;
  check('a day-old record refreshes even unchanged',
    new Date(refreshed).getTime() > Date.now() - 60000, String(refreshed));

  // A missing field must not wipe what is already known.
  await pool.query(NOTE, [old, null, null, '1.3.0']);
  const keptOld = await read(old);
  check('a push that omits a field keeps the stored one',
    keptOld.php_version === '7.4.33' && keptOld.plugin_version === '1.3.0',
    JSON.stringify(keptOld));

  // --- the finding ---------------------------------------------------------
  const { rows } = await pool.query(
    `SELECT c.name AS client, n.php_version FROM connectors n JOIN clients c ON c.id = n.client_id
      WHERE n.connector_type = 'wordpress_plugin' AND n.status = 'active'`);
  const now = new Date('2026-10-26T12:00:00Z');
  const seen = rows.filter(r => r.php_version).map(r => ({ ...r, ...phpSupport(r.php_version, now) }));
  const eol = seen.filter(r => r.state === 'eol');
  const ending = seen.filter(r => r.state === 'ending');

  check('the 7.4 site is reported as end of life',
    eol.length === 1 && eol[0].client === 'Practice on 7.4',
    JSON.stringify(eol));
  check('the 8.2 site is reported as running out',
    ending.length === 1 && ending[0].client === 'Practice on 8.2',
    JSON.stringify(ending));
  check('the supported one is reported as neither',
    !eol.concat(ending).some(r => r.client === 'Practice on 8.3'));
  check('and a site that never reported is not counted as safe',
    seen.length === 3 && rows.length === 4,
    `${seen.length} reporting of ${rows.length} connected`);

  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\nThis suite needs a database.', e.message);
  console.error('See the header for how to stand one up.');
  process.exit(1);
});
