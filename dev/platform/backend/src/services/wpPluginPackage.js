// Builds the WordPress plugin zip from the deployed source, dependency-free
// (no `zip` CLI). The platform is the plugin's distribution point — this is
// what both the Integrations download and the plugin's self-updater serve.
//
// Mirrors dev/october-mi-wp/bin/build-zip.sh: the archive's top-level folder is
// the WP slug, and dev-only files are excluded. Cached on disk per version.

const fs = require('fs');
const path = require('path');
const { buildZip } = require('../utils/zip');

const SLUG = 'october-marketing-intelligence';
// Repo root, five levels up (src/services → src → backend → platform → dev → root).
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const PLUGIN_DIR = path.join(REPO_ROOT, 'dev', 'october-mi-wp');
const MAIN_FILE = path.join(PLUGIN_DIR, `${SLUG}.php`);
const OUT_DIR = path.join(__dirname, '..', '..', 'assets', 'plugin');

// Top-level folders that never ship in the installable plugin.
const EXCLUDE_TOP_DIRS = new Set(['bin', 'tests', 'node_modules']);

function pluginVersion() {
  try {
    const m = fs.readFileSync(MAIN_FILE, 'utf8').match(/^\s*\*\s*Version:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function collect(dir, rel, entries) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.DS_Store' || name.startsWith('.git') || name.toLowerCase().endsWith('.zip')) continue;
    const abs = path.join(dir, name);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      if (rel === '' && EXCLUDE_TOP_DIRS.has(name)) continue;
      collect(abs, rel ? `${rel}/${name}` : name, entries);
    } else if (stat.isFile()) {
      entries.push({ name: `${SLUG}/${rel ? `${rel}/` : ''}${name}`, data: fs.readFileSync(abs) });
    }
  }
}

// Build (if needed) and return { version, path } for the current plugin zip,
// or null if the source/version can't be read.
function ensurePluginZip() {
  const version = pluginVersion();
  if (!version) return null;
  const target = path.join(OUT_DIR, `${SLUG}-${version}.zip`);
  if (fs.existsSync(target)) return { version, path: target };

  const entries = [];
  collect(PLUGIN_DIR, '', entries);
  if (!entries.length) return null;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Write atomically so a concurrent request never reads a half-written file.
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buildZip(entries));
  fs.renameSync(tmp, target);
  return { version, path: target };
}

module.exports = { SLUG, pluginVersion, ensurePluginZip };
