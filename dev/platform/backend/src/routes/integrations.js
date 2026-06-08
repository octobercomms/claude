// Serves the downloadable integration artifacts referenced by the
// Integrations page, and acts as the distribution point for the WordPress
// plugin. Everything here is public and non-sensitive (the GTM template has no
// secrets; the plugin is GPL and carries no secrets — per-site secrets live in
// WP options after pairing), so it's mounted before the session-auth routes so
// plain download links and the plugin's self-updater work without a token.

const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const router = express.Router();

// Repo root, five levels up from this file (src/routes → src → backend →
// platform → dev → repo root). The artifacts live alongside the backend in the
// deploy checkout.
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const GTM_CONTAINER = path.join(REPO_ROOT, 'docs', 'october-mi-gtm', 'october-mi-v1.json');

const WP_SLUG = 'october-marketing-intelligence';
const WP_PLUGIN_DIR = path.join(REPO_ROOT, 'dev', 'october-mi-wp');
const WP_PLUGIN_MAIN = path.join(WP_PLUGIN_DIR, `${WP_SLUG}.php`);
const WP_BUILD_SCRIPT = path.join(WP_PLUGIN_DIR, 'bin', 'build-zip.sh');
// Built zips live here; update.sh pre-builds on deploy, and we build on demand
// as a fallback. Kept out of git (see .gitignore).
const WP_ZIP_DIR = path.join(__dirname, '..', '..', 'assets', 'plugin');

router.get('/gtm-container', (req, res) => {
  if (!fs.existsSync(GTM_CONTAINER)) {
    return res.status(404).json({ error: 'GTM container template not found on the server.' });
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="october-mi-v1.json"');
  fs.createReadStream(GTM_CONTAINER).pipe(res);
});

// ─── WordPress plugin distribution ──────────────────────────────────────────
// The platform is the single distribution point: it serves the plugin zip built
// from the deployed source, and the plugin's self-updater polls /info. A merge
// that bumps the version → deploy rebuilds the zip → every paired site updates,
// with no GitHub token on any site.

function readPluginVersion() {
  try {
    const src = fs.readFileSync(WP_PLUGIN_MAIN, 'utf8');
    const m = src.match(/^\s*\*\s*Version:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// Path to the current plugin zip, building it on demand if the deploy step
// didn't (or this is a fresh box). Returns { version, path } or null.
function ensurePluginZip() {
  const version = readPluginVersion();
  if (!version) return null;
  const target = path.join(WP_ZIP_DIR, `${WP_SLUG}-${version}.zip`);
  if (fs.existsSync(target)) return { version, path: target };
  try {
    fs.mkdirSync(WP_ZIP_DIR, { recursive: true });
    execFileSync('bash', [WP_BUILD_SCRIPT, WP_ZIP_DIR], { stdio: 'ignore' });
  } catch (err) {
    console.error('[integrations] plugin zip build failed (is `zip` installed?):', err.message);
    return null;
  }
  return fs.existsSync(target) ? { version, path: target } : null;
}

// Manifest the plugin's self-updater polls.
router.get('/wordpress-plugin/info', (req, res) => {
  const version = readPluginVersion();
  if (!version) return res.status(503).json({ error: 'Plugin version unavailable.' });
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    name: 'October Marketing Intelligence',
    slug: WP_SLUG,
    version,
    package: `${base}/api/integrations/wordpress-plugin`,
    homepage: 'https://octobercomms.com',
  });
});

// The plugin zip itself (initial install from the Integrations page, and the
// self-updater's download).
router.get('/wordpress-plugin', (req, res) => {
  const built = ensurePluginZip();
  if (!built) {
    return res.status(503).json({ error: 'The plugin package is not available yet — try again shortly.' });
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${WP_SLUG}-${built.version}.zip"`);
  fs.createReadStream(built.path).pipe(res);
});

module.exports = router;
