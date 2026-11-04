// Migration 225 added source_url and stored_bytes to client_assets so that a
// remote clip's provenance is tracked. The old edit route that motivated the
// original test is deleted; what remains guards the assets service and the
// migration.
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const assets = read('src', 'services', 'assets.js');
const migration = read('migrations', '225_client_asset_source.sql');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, '\n  ' + (detail || '')); }
};

// ─── The service ─────────────────────────────────────────────────────────
check('keepRemote refuses a row with no link to fetch from',
  /no provider link recorded to fetch from/.test(assets),
  'without this it hands an undefined to the URL parser and reports "Invalid URL"');

check('it keeps the provider link rather than overwriting it',
  /source_url = COALESCE\(source_url, \$3\)/.test(assets),
  'the provider link is worth retrying from while it lives, and it is the only record of where the bytes came from');

check('it records the size, which is also the did-it-work flag',
  /stored_bytes = \$4/.test(assets) && /got\.bytes/.test(assets),
  'NULL stored_bytes is how the unstored query finds rows still on somebody else\'s server');

check('the URL guard is on unless a caller replaces it',
  /\.\.\.\(check \? \{ check \} : \{\}\)/.test(assets),
  'a default-permissive guard would let a provider answer with 169.254.169.254 and have this box fetch its own cloud credentials');

check('the guard is only injectable, never disabled',
  !/check:\s*\(\)\s*=>/.test(assets) && !/check:\s*null/.test(assets),
  'a hard-coded permissive check is the same hole with extra steps');

check('unstored only lists rows that really are elsewhere',
  /stored_bytes IS NULL AND url LIKE 'http%'/.test(assets),
  'otherwise a backfill offers to keep clips that are already kept');

// ─── The migration ───────────────────────────────────────────────────────
check('225 adds both columns, idempotently',
  /ADD COLUMN IF NOT EXISTS source_url TEXT/.test(migration)
    && /ADD COLUMN IF NOT EXISTS stored_bytes BIGINT/.test(migration),
  'the migration runner replays on every deploy');

check('and indexes exactly the question the backfill asks',
  /WHERE archived_at IS NULL AND stored_bytes IS NULL AND url LIKE 'http%'/.test(migration),
  'a full index on a column that is normally NULL for nothing is waste');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
