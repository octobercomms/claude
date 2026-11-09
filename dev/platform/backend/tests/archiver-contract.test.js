/**
 * `require('archiver')` has to be callable, and its glob has to work.
 *
 * ── The fault this exists to have caught ─────────────────────────────
 *
 * `archiver` went in at `^8.0.0` on 8 November with the extension-download
 * route (`routes/accounts.js`, GET /accounts/extension/download). archiver 8
 * is ESM-only: `"type": "module"`, and its exports are the named classes
 * `Archiver`, `JsonArchive`, `TarArchive` and `ZipArchive` with no callable
 * default. The route is CommonJS and calls `archiver('zip', …)`, which is the
 * v7 API, so every request to it threw
 *
 *     TypeError: archiver is not a function
 *
 * It had never worked, and nothing caught it: the only use of archiver in the
 * backend is inside that one route handler, so `require` is not reached until
 * somebody clicks the button. It reached the error digest instead — five 500s
 * in twenty-four hours.
 *
 * ── Why it is pinned to 7, and what the override is for ──────────────
 *
 * Both archiver majors drag in a vulnerable `minimatch`, by different routes,
 * so npm's own `--force` fix flips between the two for ever:
 *
 *     archiver 8 → readdir-glob → minimatch        (3 moderate)
 *     archiver 7 → archiver-utils → glob → minimatch (5 moderate)
 *
 * archiver 7 is the line whose API this codebase calls, so the version is the
 * one that stays and the transitive dependencies are what move: a scoped
 * `overrides` entry under `archiver` pulls glob past GHSA-3g3m-2fjr-6pw4
 * (9.0.0 – 14.0.1) and minimatch past GHSA-g3hv-75wg-m249 (7.0.0 – 11.0.0).
 * Scoped rather than global on purpose, so nodemon's own minimatch — dev-only
 * and already an accepted trade-off in docs/omi/dependency-audit.md — is left
 * where it is.
 *
 * An override is only as good as the consumer it overrides, so this zips a
 * real directory both ways archiver can: `directory()`, which is what the
 * route calls, and `glob()`, which is the path that actually reaches the
 * overridden glob.
 *
 *   node tests/archiver-contract.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const archiver = require('archiver');

let dir;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archiver-contract-'));
  fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '1.2.3' }));
  fs.writeFileSync(path.join(dir, 'src', 'background.js'), '// background');
  fs.writeFileSync(path.join(dir, 'src', 'deep', 'nested.txt'), 'nested content');
});

after(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

/** Build a zip the way the route does, and hand back its path. */
function zip(name, build) {
  return new Promise((resolve, reject) => {
    const out = path.join(dir, name);
    const stream = fs.createWriteStream(out);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    stream.on('error', reject);
    stream.on('close', () => resolve(out));
    archive.pipe(stream);
    build(archive);
    archive.finalize();
  });
}

/**
 * What is actually inside a zip, read by a zip tool rather than by archiver.
 *
 * Directory entries are dropped. A zip holds one for each directory it walks
 * — `extension/src/deep/`, with a trailing slash and no content — and those
 * are archiver doing its job rather than anything this test is about. They
 * are asserted on their own below so nothing is quietly filtered away.
 */
function contents(file) {
  return listing(file).filter((name) => !name.endsWith('/'));
}

/** Everything zipinfo reports, directory entries included. */
function listing(file) {
  return execFileSync('zipinfo', ['-1', file], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean).sort();
}

// ── the hazard itself ─────────────────────────────────────────────────

describe('the shape the route depends on', () => {
  it('is callable', () => {
    assert.equal(
      typeof archiver, 'function',
      'require("archiver") is no longer a function. archiver 8 is ESM-only and'
      + ' exports Archiver, JsonArchive, TarArchive and ZipArchive with no'
      + ' callable default, so `archiver("zip", …)` in routes/accounts.js throws'
      + ' "archiver is not a function" on every request. Either stay on the 7'
      + ' line or port that call site to the v8 API deliberately.'
    );
  });

  it('takes the arguments the route passes it', () => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    assert.equal(typeof archive.pipe, 'function');
    assert.equal(typeof archive.directory, 'function');
    assert.equal(typeof archive.finalize, 'function');
    archive.abort();
  });
});

// ── the consumer of the overridden packages ───────────────────────────

describe('zipping a directory, which is what the route does', () => {
  it('produces a zip holding every file, at its prefixed path', async () => {
    const out = await zip('directory.zip', (a) => a.directory(dir + '/src', 'extension/src'));
    assert.deepEqual(contents(out), [
      'extension/src/background.js',
      'extension/src/deep/nested.txt',
    ]);
  });

  it('carries a directory entry for each directory it walked', async () => {
    const out = await zip('dirs.zip', (a) => a.directory(dir + '/src', 'extension/src'));
    assert.deepEqual(
      listing(out).filter((name) => name.endsWith('/')),
      ['extension/src/deep/']
    );
  });

  it('produces bytes a zip tool will open', async () => {
    // `archiver` reporting success is not the same as a readable archive, and
    // the browser is what opens this one.
    const out = await zip('readable.zip', (a) => a.directory(dir + '/src', 'extension'));
    assert.doesNotThrow(() => execFileSync('unzip', ['-t', out], { stdio: 'pipe' }));
    assert.ok(fs.statSync(out).size > 100, 'and is not an empty archive');
  });
});

describe('the glob path, which is what the override has to keep working', () => {
  it('matches and archives through the overridden glob', async () => {
    const out = await zip('glob.zip', (a) => a.glob('**/*.js', { cwd: dir }));
    assert.deepEqual(contents(out), ['src/background.js']);
  });

  it('is a glob past the advisory range, and so is its minimatch', () => {
    // The override is what puts them there. If it is removed, or npm stops
    // applying it, this says so rather than letting the audit quietly go
    // back to five moderate findings.
    const seenBy = (name) => {
      const utils = require.resolve('archiver-utils', { paths: [path.join(__dirname, '..')] });
      const resolved = require.resolve(`${name}/package.json`, { paths: [path.dirname(utils)] });
      return JSON.parse(fs.readFileSync(resolved, 'utf8')).version;
    };
    const major = (v) => Number(v.split('.')[0]);
    const glob = seenBy('glob');
    const minimatch = seenBy('minimatch');

    assert.ok(major(glob) >= 14, `archiver-utils sees glob ${glob}; GHSA-3g3m-2fjr-6pw4 covers 9.0.0 - 14.0.1`);
    assert.ok(major(minimatch) >= 11, `archiver-utils sees minimatch ${minimatch}; GHSA-g3hv-75wg-m249 covers 7.0.0 - 11.0.0`);
  });
});
