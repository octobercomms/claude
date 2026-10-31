// "When I clicked on an old clip it said That clip is not on this server any
// more." Reported 31 Oct 2026, the third appearance of one fault and the first
// appearance of a second one sitting in front of it.
//
// Fault one, the message: socialCaptionRender.localPath hands an external URL
// straight back, on purpose, because ffmpeg reads https directly and a
// download step would be waste. Edit's from-asset route then tested the result
// with fs.existsSync, which a URL always fails — so Edit refused every
// CDN-hosted clip in the library, including every one whose link still worked.
//
// Fault two, underneath it: client_assets had nowhere to record where a remote
// clip came from, so a provider link was the only copy and expired on its own
// schedule. Migration 225 adds source_url and stored_bytes, the same shape as
// ad creative (223) and the avatar reels (224).
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const route = read('src', 'routes', 'edit.js');
const assets = read('src', 'services', 'assets.js');
const migration = read('migrations', '225_client_asset_source.sql');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, '\n  ' + (detail || '')); }
};

// ─── The route ───────────────────────────────────────────────────────────
const fromAsset = (() => {
  const at = route.indexOf("'/clients/:clientId/edit/from-asset'");
  if (at < 0) return null;
  const end = route.indexOf('\n// ', at);
  return route.slice(at, end < 0 ? route.length : end);
})();
check('the from-asset route was found', !!fromAsset);

check('it does not ask the filesystem about a URL',
  !!fromAsset && !/fs\.existsSync\(\s*(disk|resolved)\s*\)\s*\)\s*\{[\s\S]{0,120}not on this server/.test(fromAsset)
    && /!\/\^https\?:/.test(fromAsset),
  'fs.existsSync on an http URL is always false, which refused every clip on a provider CDN');

check('a remote clip is kept rather than refused',
  !!fromAsset && /keepRemote/.test(fromAsset),
  'the clip the account lead clicked had a working link; the route just would not use it');

check('and a clip with no file and no link says which case it is',
  !!fromAsset && /no file on this server and no link/.test(fromAsset),
  'one message for two different problems is a message that helps with neither');

check('a fetch that fails does not pretend to have worked',
  !!fromAsset && /did not work either/.test(fromAsset),
  'an expired link and a missing row need different answers');

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
