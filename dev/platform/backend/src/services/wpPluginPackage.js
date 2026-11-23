// Builds a WordPress plugin zip from the deployed source, dependency-free (no
// `zip` CLI). The platform is the distribution point for every plugin here —
// this is what both the Integrations download and each plugin's self-updater
// serve.
//
// Mirrors dev/october-mi-wp/bin/build-zip.sh: the archive's top-level folder is
// the WP slug, and dev-only files are excluded. Cached on disk per version.
//
// Registry rather than one hardcoded plugin, because October MI is no longer
// the only thing distributed this way. Adding a plugin is one entry here; the
// routes, the zip builder and the version manifest all key off it.
//
// The slug is the contract. WordPress installs the zip into a folder named
// after its top-level directory and then looks for `{slug}/{slug}.php`, so a
// mismatch between the registry slug, the folder in the archive and the main
// file name installs a plugin that cannot be activated or updated.

const fs = require('fs');
const path = require('path');
const { buildZip } = require('../utils/zip');

// Repo root, five levels up (src/services → src → backend → platform → dev → root).
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const OUT_DIR = path.join(__dirname, '..', '..', 'assets', 'plugin');

// Keyed by slug. `dir` is the folder under dev/; `main` defaults to
// `{slug}.php` inside it, which is the WordPress convention.
const PLUGINS = {
  'october-marketing-intelligence': {
    slug: 'october-marketing-intelligence',
    dir: 'october-mi-wp',
    name: 'October Marketing Intelligence',
    homepage: 'https://octobercomms.com',
  },
};

// The plugin the unsuffixed legacy routes serve.
//
// Paired sites in the wild are polling /api/integrations/wordpress-plugin/info
// and downloading /api/integrations/wordpress-plugin today. Moving those paths
// would not error — the self-updater would simply stop seeing new versions,
// on every site at once, with nothing on any screen to say so. So they keep
// working and point here.
const SLUG = 'october-marketing-intelligence';

function get(slug) {
  return Object.prototype.hasOwnProperty.call(PLUGINS, slug) ? PLUGINS[slug] : null;
}

function list() {
  return Object.values(PLUGINS);
}

function pluginDir(entry) {
  return path.join(REPO_ROOT, 'dev', entry.dir);
}

function mainFile(entry) {
  return path.join(pluginDir(entry), entry.main || `${entry.slug}.php`);
}

// Top-level folders that never ship in the installable plugin.
const EXCLUDE_TOP_DIRS = new Set(['bin', 'tests', 'node_modules']);

function pluginVersion(slug = SLUG) {
  const entry = get(slug);
  if (!entry) return null;
  try {
    const m = fs.readFileSync(mainFile(entry), 'utf8').match(/^\s*\*\s*Version:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function collect(dir, rel, entries, slug) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.DS_Store' || name.startsWith('.git') || name.toLowerCase().endsWith('.zip')) continue;
    const abs = path.join(dir, name);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      if (rel === '' && EXCLUDE_TOP_DIRS.has(name)) continue;
      collect(abs, rel ? `${rel}/${name}` : name, entries, slug);
    } else if (stat.isFile()) {
      entries.push({ name: `${slug}/${rel ? `${rel}/` : ''}${name}`, data: fs.readFileSync(abs) });
    }
  }
}

// Build (if needed) and return { slug, version, path } for a plugin's current
// zip, or null if the source or version cannot be read.
function ensurePluginZip(slug = SLUG) {
  const entry = get(slug);
  if (!entry) return null;
  const version = pluginVersion(slug);
  if (!version) return null;

  const target = path.join(OUT_DIR, `${entry.slug}-${version}.zip`);
  if (fs.existsSync(target)) return { slug: entry.slug, version, path: target };

  const entries = [];
  collect(pluginDir(entry), '', entries, entry.slug);
  if (!entries.length) return null;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Write atomically so a concurrent request never reads a half-written file.
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buildZip(entries));
  fs.renameSync(tmp, target);
  return { slug: entry.slug, version, path: target };
}

module.exports = {
  SLUG, PLUGINS, get, list, pluginVersion, ensurePluginZip,
  // Exported for the guard: it checks the archive's folder against the slug,
  // which is what WordPress installs by.
  _internals: { pluginDir, mainFile, EXCLUDE_TOP_DIRS },
};
