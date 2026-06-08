// Serves the downloadable integration artifacts referenced by the
// Integrations page, and acts as the distribution point for the WordPress
// plugin. Everything here is public and non-sensitive (the GTM template has no
// secrets; the plugin is GPL and carries no secrets — per-site secrets live in
// WP options after pairing), so it's mounted before the session-auth routes so
// plain download links and the plugin's self-updater work without a token.

const express = require('express');
const path = require('path');
const fs = require('fs');
const wpPackage = require('../services/wpPluginPackage');

const router = express.Router();

// Repo root, five levels up from this file (src/routes → src → backend →
// platform → dev → repo root). The artifacts live alongside the backend in the
// deploy checkout.
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const GTM_CONTAINER = path.join(REPO_ROOT, 'docs', 'october-mi-gtm', 'october-mi-v1.json');

const WP_SLUG = wpPackage.SLUG;

router.get('/gtm-container', (req, res) => {
  if (!fs.existsSync(GTM_CONTAINER)) {
    return res.status(404).json({ error: 'GTM container template not found on the server.' });
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="october-mi-v1.json"');
  fs.createReadStream(GTM_CONTAINER).pipe(res);
});

// ─── WordPress plugin distribution ──────────────────────────────────────────
// The platform is the single distribution point: it builds the plugin zip from
// the deployed source (dependency-free, see services/wpPluginPackage.js) and
// the plugin's self-updater polls /info. A merge that bumps the version →
// deploy rebuilds the zip → every paired site updates, with no GitHub token on
// any site and no `zip` CLI on the host.

// Manifest the plugin's self-updater polls.
router.get('/wordpress-plugin/info', (req, res) => {
  const version = wpPackage.pluginVersion();
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
  let built;
  try {
    built = wpPackage.ensurePluginZip();
  } catch (err) {
    console.error('[integrations] plugin package build failed:', err.message);
  }
  if (!built) {
    return res.status(503).json({ error: 'The plugin package is not available yet — try again shortly.' });
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${WP_SLUG}-${built.version}.zip"`);
  fs.createReadStream(built.path).pipe(res);
});

module.exports = router;
