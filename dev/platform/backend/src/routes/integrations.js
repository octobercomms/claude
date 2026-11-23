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

// Shared by the legacy and the slug-addressed manifest routes.
function manifest(req, slug) {
  const entry = wpPackage.get(slug);
  if (!entry) return null;
  const version = wpPackage.pluginVersion(slug);
  if (!version) return null;
  const base = `${req.protocol}://${req.get('host')}`;
  return {
    name: entry.name,
    slug: entry.slug,
    version,
    // Slug-addressed, so a plugin added later gets a correct download URL
    // without this having to know which one is the legacy default.
    package: `${base}/api/integrations/wordpress-plugin/${entry.slug}`,
    homepage: entry.homepage || 'https://octobercomms.com',
  };
}

function sendZip(res, slug) {
  let built;
  try {
    built = wpPackage.ensurePluginZip(slug);
  } catch (err) {
    console.error('[integrations] plugin package build failed:', err.message);
  }
  if (!built) {
    return res.status(503).json({ error: 'The plugin package is not available yet — try again shortly.' });
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${built.slug}-${built.version}.zip"`);
  return fs.createReadStream(built.path).pipe(res);
}

// ── Legacy paths, which paired sites are polling right now ──────────────────
//
// Every site that already has October MI installed asks these two URLs. If
// they moved, nothing would error: the self-updater would simply stop seeing
// new versions, on every site at once, with nothing on any screen to say so.
// They stay, and they serve the default plugin.
//
// Registered BEFORE the :slug routes so Express matches the literal `/info`
// first. The :slug handler also 404s an unknown slug, so even if that ordering
// were broken later, `/wordpress-plugin/info` could not be read as a plugin
// called "info".
router.get('/wordpress-plugin/info', (req, res) => {
  const body = manifest(req, wpPackage.SLUG);
  if (!body) return res.status(503).json({ error: 'Plugin version unavailable.' });
  res.json(body);
});

router.get('/wordpress-plugin', (req, res) => sendZip(res, wpPackage.SLUG));

// ── Slug-addressed, for every plugin including the default ──────────────────
router.get('/wordpress-plugin/:slug/info', (req, res) => {
  const body = manifest(req, req.params.slug);
  if (!body) return res.status(404).json({ error: 'Unknown plugin.' });
  res.json(body);
});

router.get('/wordpress-plugin/:slug', (req, res) => {
  if (!wpPackage.get(req.params.slug)) return res.status(404).json({ error: 'Unknown plugin.' });
  return sendZip(res, req.params.slug);
});

module.exports = router;
