// The platform is the distribution point for every WordPress plugin October
// ships, and the things that break here break silently on sites we do not own.
//
// Three of them:
//
//   The legacy paths. Every site with October MI installed polls
//   /api/integrations/wordpress-plugin/info and downloads
//   /api/integrations/wordpress-plugin. Move or rename those and nothing
//   errors — the self-updater just stops seeing new versions, on every paired
//   site at once, with nothing on any screen to say so. Generalising the route
//   to take a slug is exactly the change that would do it.
//
//   The slug. WordPress installs a plugin into a folder named after the
//   archive's top-level directory, then looks for `{slug}/{slug}.php`. If the
//   registry slug, the folder inside the zip and the main file name disagree,
//   the plugin installs into a wrongly-named directory and can be neither
//   activated nor updated. Nothing in the build would complain.
//
//   The excluded folders. `bin`, `tests` and `node_modules` must not ship.
//   Shipping tests to a client site is noise; shipping node_modules is tens of
//   megabytes down somebody's connection.
//
//   node tests/wp-plugin-distribution.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pkg = require('../src/services/wpPluginPackage');
const ROUTES = fs.readFileSync(path.join(__dirname, '../src/routes/integrations.js'), 'utf8');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };

// ── the registry ─────────────────────────────────────────────────────────────

ok('every registered plugin has a readable source and a version', () => {
  const all = pkg.list();
  assert.ok(all.length >= 1, 'no plugins are registered, so this guard checks nothing');
  for (const entry of all) {
    const dir = pkg._internals.pluginDir(entry);
    assert.ok(fs.existsSync(dir), `${entry.slug}: source folder is missing at ${dir}`);
    const main = pkg._internals.mainFile(entry);
    assert.ok(fs.existsSync(main),
      `${entry.slug}: main file missing at ${main}. WordPress looks for {slug}/{slug}.php, `
      + 'so a plugin whose main file is named anything else cannot be activated');
    const version = pkg.pluginVersion(entry.slug);
    assert.ok(version && /^\d+\.\d+/.test(version),
      `${entry.slug}: no parseable Version header, so the self-updater has nothing to compare`);
  }
});

ok('the default slug is one that is actually registered', () => {
  assert.ok(pkg.get(pkg.SLUG),
    `SLUG is "${pkg.SLUG}", which is not in the registry, so every legacy request 404s`);
});

ok('an unknown slug is null, not a throw', () => {
  assert.strictEqual(pkg.get('nope'), null);
  assert.strictEqual(pkg.pluginVersion('nope'), null);
  assert.strictEqual(pkg.ensurePluginZip('nope'), null,
    'an unknown slug should resolve to nothing rather than building a zip of the wrong thing');
});

// ── the archive ──────────────────────────────────────────────────────────────

// Built fresh, not read from the cache.
//
// ensurePluginZip() returns early when a zip already exists for the version,
// which is right in production and useless in a test: the first two attempts
// at these assertions passed against an artefact built before the change they
// were meant to catch. Deleting the cached file first is what makes them test
// the builder rather than yesterday's output.
function freshZip(slug) {
  const first = pkg.ensurePluginZip(slug);
  assert.ok(first, `could not build the zip for ${slug || pkg.SLUG}`);
  fs.rmSync(first.path, { force: true });
  const rebuilt = pkg.ensurePluginZip(slug);
  assert.ok(rebuilt, 'the rebuild after clearing the cache produced nothing');
  assert.ok(fs.existsSync(rebuilt.path), 'the rebuilt zip is not on disk');
  return rebuilt;
}

ok('the archive is rooted at the slug, which is what WordPress installs by', () => {
  const built = freshZip();
  assert.strictEqual(built.slug, pkg.SLUG);

  // Read the central directory rather than trusting the builder: the file
  // names inside are what WordPress sees.
  const buf = fs.readFileSync(built.path);
  const names = [];
  // Local file headers: PK\x03\x04, name length at +26, name at +30.
  for (let i = 0; i + 30 < buf.length; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const nameLen = buf.readUInt16LE(i + 26);
      names.push(buf.slice(i + 30, i + 30 + nameLen).toString('utf8'));
    }
  }
  assert.ok(names.length > 5, `only ${names.length} entries found in the zip; the parse is probably wrong`);
  const stray = names.filter((n) => !n.startsWith(`${pkg.SLUG}/`));
  assert.deepStrictEqual(stray, [],
    'these entries are not under the slug folder, so WordPress would install the plugin '
    + `into a wrongly-named directory and the self-updater would never find it: ${stray.join(', ')}`);

  assert.ok(names.includes(`${pkg.SLUG}/${pkg.SLUG}.php`),
    `the archive has no ${pkg.SLUG}/${pkg.SLUG}.php, which is the file WordPress activates`);
});

ok('dev-only folders are not shipped to client sites', () => {
  // Named here, not read from EXCLUDE_TOP_DIRS.
  //
  // Iterating the constant under test made this pass vacuously: emptying the
  // set ran the loop zero times and reported green, which is the same mistake
  // as a guard that names a marker rather than the claim. The list the plugin
  // must not ship is a fact about the plugin, so it is stated independently.
  const MUST_NOT_SHIP = ['bin', 'tests', 'node_modules'];

  const built = freshZip();
  const text = fs.readFileSync(built.path).toString('latin1');
  for (const dir of MUST_NOT_SHIP) {
    assert.ok(!text.includes(`${pkg.SLUG}/${dir}/`),
      `${dir}/ is in the installable zip; it is excluded for a reason `
      + '(node_modules alone is tens of megabytes over somebody else\'s connection)');
  }

  // And the source still intends to exclude them, so a folder that simply
  // does not exist today cannot hide a dropped exclusion.
  for (const dir of MUST_NOT_SHIP) {
    assert.ok(pkg._internals.EXCLUDE_TOP_DIRS.has(dir),
      `${dir} is no longer in EXCLUDE_TOP_DIRS, so it will ship as soon as somebody adds that folder`);
  }
});

// ── the routes, which are the part that breaks silently ──────────────────────

ok('the legacy paths every paired site polls still exist', () => {
  assert.ok(/router\.get\('\/wordpress-plugin\/info'/.test(ROUTES),
    'the unsuffixed /wordpress-plugin/info is gone. Every site already running the plugin polls '
    + 'that URL; losing it does not error, it silently stops all updates everywhere');
  assert.ok(/router\.get\('\/wordpress-plugin',/.test(ROUTES),
    'the unsuffixed /wordpress-plugin download is gone, so the self-updater can see a new '
    + 'version and then fail to fetch it');
});

ok('the literal /info route is registered before the :slug route', () => {
  // Express matches in registration order. If :slug came first it would swallow
  // "info" as a plugin name.
  const literal = ROUTES.indexOf("router.get('/wordpress-plugin/info'");
  const param = ROUTES.indexOf("router.get('/wordpress-plugin/:slug/info'");
  assert.ok(literal > 0 && param > 0, 'one of the two manifest routes is missing');
  assert.ok(literal < param,
    'the :slug route is registered first, so /wordpress-plugin/info would be matched as a '
    + 'plugin called "info"');
});

ok('an unknown slug 404s rather than falling through to the default', () => {
  // Belt and braces for the ordering above: a slug that is not registered must
  // not quietly serve October MI to a site asking for something else.
  const slugBlock = ROUTES.slice(ROUTES.indexOf("router.get('/wordpress-plugin/:slug'"));
  assert.ok(/wpPackage\.get\(req\.params\.slug\)/.test(slugBlock),
    'the slug download route does not check the registry, so an unknown slug would build '
    + 'and serve the default plugin under the wrong name');
  assert.ok(/404/.test(slugBlock), 'an unknown slug does not 404');
});

ok('the manifest points at a slug-addressed download', () => {
  // The legacy /info has to keep working, but what it tells the site to
  // download should be the addressed URL, so adding a second plugin does not
  // require this file to know which one is the default.
  assert.ok(/wordpress-plugin\/\$\{entry\.slug\}/.test(ROUTES),
    'the manifest advertises a package URL that is not slug-addressed, so a second plugin '
    + 'would hand every site the first one');
});

ok('the version in the manifest comes from the source, not a constant', () => {
  assert.ok(/wpPackage\.pluginVersion\(/.test(ROUTES),
    'the manifest no longer reads the version from the plugin header; a hardcoded version '
    + 'means a release that never reaches any site');
});

console.log(`\n${passed} passed, 0 failed`);
