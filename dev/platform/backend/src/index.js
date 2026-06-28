require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');
const { decrypt, assertKeyValid } = require('./utils/encryption');
const errorTracker = require('./services/errorTracker');

// Force DNS lookups to prefer IPv4. Node 18 changed the default DNS
// result order to 'verbatim' (use whatever the resolver returns,
// usually IPv6 first). Many origins answer differently on IPv4 vs
// IPv6 — e.g. architourian.com on 20i hosting served a "Security
// Verification" anti-bot challenge over IPv6 while normal Apache
// served traffic correctly on IPv4. Browsers + curl prefer IPv4
// by default; matching that behaviour fixes a whole class of
// connector 401/403 quirks without per-origin patching.
require('dns').setDefaultResultOrder('ipv4first');

// Validate ENCRYPTION_KEY at boot so an operator running with a non-hex
// value sees the error immediately rather than the first time a
// connector is decrypted.
try { assertKeyValid(); }
catch (err) { console.error('FATAL:', err.message); process.exit(1); }

// Process-level safety nets. Without these, an unhandled promise
// rejection from any async path (a forgotten await in a cron job, an
// axios error past the catch, etc.) goes to stderr only and we find
// out from a user. Funnel them through errorTracker so the daily
// digest catches them.
process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason || 'unhandledRejection');
  console.error('[unhandledRejection]', msg);
  errorTracker.recordError({ source: 'backend', message: msg, stack: reason?.stack, context: { kind: 'unhandledRejection' } })
    .catch(() => {});
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
  errorTracker.recordError({ source: 'backend', message: err.message, stack: err.stack, context: { kind: 'uncaughtException' } })
    .catch(() => {});
  // Don't exit — pm2 would restart us; a single bad request shouldn't
  // bounce the whole process. If we ever see corruption-class errors
  // here (out-of-memory, EBADF) we'd reconsider.
});

async function loadSettingsFromDb() {
  try {
    const result = await db.query('SELECT key, value FROM platform_settings');
    for (const row of result.rows) {
      try {
        const decrypted = decrypt(JSON.parse(row.value));
        if (decrypted) process.env[row.key] = decrypted;
      } catch {}
    }
  } catch {}
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// Security middleware
// CSP is set permissively — the platform serves API JSON and an SPA
// from one domain, but the report HTML route renders Claude-authored
// content into an iframe. Loose default-src + inline style/script is
// pragmatic here; tighten later if we restructure report rendering.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'https:'],
      'media-src': ["'self'", 'https:', 'data:', 'blob:'],
      'connect-src': ["'self'", 'https:'],
      'frame-src': ["'self'", 'https:'],
      'object-src': ["'none'"],
    },
  },
}));
app.use(cors({
  // Cookie-based session auth — credentials:true lets the browser send the
  // httpOnly token cookie on API requests. The origin is pinned (never '*'),
  // which is required when credentials are allowed.
  credentials: true,
  origin: process.env.NODE_ENV === 'production'
    ? process.env.PLATFORM_URL
    : ['http://localhost:3000', 'http://localhost:5173'],
}));
// Capture the raw body so HMAC-signed webhooks (the WordPress plugin and
// Shopify app ingests) can verify signatures over the exact bytes the sender
// signed.
app.use(express.json({ limit: '10mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

// WordPress plugin ingest — called by client WP sites with per-request HMAC
// auth (no platform session). Mounted before the global per-IP limiter so a
// busy store's event stream isn't throttled by the dashboard cap; it has its
// own generous limiter and verifies every signature.
const wpConnectLimiter = rateLimit({ windowMs: 60 * 1000, max: 1200 });
app.use('/api/wp-connect', wpConnectLimiter, require('./routes/wpConnect'));

// Shopify app ingest — called by the public Shopify app with a shared-secret
// HMAC (no platform session). Mounted before the global per-IP limiter with its
// own generous limiter so a busy store's forwarded webhook stream isn't
// throttled by the dashboard cap.
const shopifyAppLimiter = rateLimit({ windowMs: 60 * 1000, max: 1200 });
app.use('/api/shopify-app', shopifyAppLimiter, require('./routes/shopifyApp'));

// Video worker API — the dedicated worker box polls this (WORKER_TOKEN auth).
// Mounted before the global per-IP limiter so frequent polling/clip-pulls
// aren't throttled, and before the session-authed /api/video router so the
// /worker subtree never hits the user-auth middleware. Its own generous limiter.
const videoWorkerLimiter = rateLimit({ windowMs: 60 * 1000, max: 1200 });
app.use('/api/video/worker', videoWorkerLimiter, require('./routes/videoWorker'));

// Instagram DM webhook — Meta calls this (no session). HMAC-verified against
// META_APP_SECRET. Mounted before the global limiter so Meta's retry bursts and
// the subscription handshake are never throttled. See routes/dmWebhook.js.
app.use('/api/social/dm-webhook', require('./routes/dmWebhook'));

// Brute-force defence on the password-checking endpoints only. Scoped tight on
// purpose: an earlier version covered the whole /api/auth/* tree, which meant
// /api/auth/me (the bearer-validation ping every page load fires) counted toward
// the budget — opening ~20 tabs in 15 minutes locked the user out. /me and
// /refresh are token-gated so they aren't a brute-force surface; they sit under
// the global limiter only.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// Global per-IP cap to make UUID brute-forcing of public endpoints
// (report HTML, approval links, open-tracking pixel) non-trivial and
// to cap accidental loops in client code. A single dashboard load fans
// out to many panel requests, so this is set high enough that repeatedly
// refreshing never locks a legitimate user out — brute-force protection
// on the sensitive endpoints lives in authLimiter, not here.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2500,
  message: { error: 'Too many requests. Slow down and try again shortly.' },
});
app.use('/api', globalLimiter);
app.use('/auth', globalLimiter);

// Tighter per-IP cap on the unauthenticated open-tracking pixel — it's
// the easiest endpoint to brute-force send-ids against.
const pixelLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });

// Routes
// Public unsubscribe — no auth, signature-validated. Mounted before
// the rate-limited auth route so it never blocks unsubscribes.
app.use('/api/unsubscribe', require('./routes/unsubscribe'));
// SES bounce/complaint webhook — mounted before auth so SNS can POST to it.
app.use('/api/ses', require('./routes/sesWebhook'));
// Public integration artifacts (GTM container template — no secrets). Before
// auth so a plain download link works.
app.use('/api/integrations', require('./routes/integrations'));

// Coverage-entry attachments (PDF scans/cutouts), served under /api so they
// ride the same nginx proxy as every other API call. The bare
// /coverage-attachments path (mounted below) depends on its own nginx location
// block, which proved unreliable in production — a request that misses it falls
// through to the SPA and renders a blank screen. /api/* is always proxied to
// the backend, so this path is the durable one; the public coverage page +
// links now point here. Public + unguessable filename = the access control,
// same as the token-gated portal. Mounted before auth so the client (not
// logged in) and the PDF/CSV export can read it.
app.use('/api/coverage-attachments', express.static(path.join(__dirname, '../coverage-attachments')));

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/change-password', authLimiter);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/connectors', require('./routes/connectors'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/rankings', require('./routes/rankings'));
app.use('/api/seo', require('./routes/seoSuite'));
app.use('/api/social', require('./routes/social'));
app.use('/api/ig-outreach', require('./routes/igOutreach'));
app.use('/api/brand', require('./routes/brandAssets'));
app.use('/api/ad-creatives', require('./routes/adCreatives'));
app.use('/api/approvals', require('./routes/approvals'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/docs', require('./routes/docs'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/security', require('./routes/security'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/outreach', require('./routes/outreach'));
app.use('/api/press', require('./routes/press'));
app.use('/api/pr', require('./routes/pr'));
app.use('/api/pr-portal', require('./routes/prPortal')); // public, token-gated
app.use('/api/pr-addon', require('./routes/prAddon')); // Gmail add-on, X-OMI-Key auth
app.use('/api/sales-traffic', require('./routes/salesTraffic'));
app.use('/api/strategist', require('./routes/strategist'));
app.use('/api/october-forms', require('./routes/octoberForms'));
app.use('/api/waitlist', require('./routes/waitlist'));
app.use('/api/audiences', require('./routes/audiences'));
app.use('/api/video', require('./routes/video'));
app.use('/api/ai-visibility', require('./routes/aiVisibility'));
app.use('/api/ai-seo', require('./routes/aiSeo'));
app.use('/api/clarity', require('./routes/clarity'));
app.use('/api/strategy', require('./routes/strategy'));
app.use('/api/competitor-ads', require('./routes/competitorAds'));
app.use('/api/_internal', require('./routes/internal'));
app.use('/auth', require('./routes/oauth'));

// Express error handler — catches anything thrown inside a route that
// wasn't caught by the route's own try/catch. Without it Express logs
// a generic message and the error never reaches errorTracker.
app.use((err, req, res, next) => {
  errorTracker.recordError({
    source: 'backend',
    message: err.message,
    stack: err.stack,
    context: { route: `${req.method} ${req.path}`, status: err.status || 500 },
  }).catch(() => {});
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

// Serve PDFs
app.use('/pdfs', require('./middleware/auth').authenticate, express.static(path.join(__dirname, '../pdfs')));

// Serve coverage attachments (PDFs the AM uploads against a coverage entry —
// magazine scans, print cutouts, advance copies). Public, unguessable-UUID
// filenames are the access control — same pattern as the public coverage
// portal URL — so we can render these inside <iframe> previews on the
// client-facing coverage report without forcing the client to log in.
app.use('/coverage-attachments', express.static(path.join(__dirname, '../coverage-attachments')));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Start server, then load DB settings BEFORE registering cron jobs. The
// scheduler registers crons (e.g. the 10am weekly-report run) on require, and
// those jobs need the real API keys — which live in the encrypted
// platform_settings store, not the boot-time env. Loading settings first
// (awaited) avoids the failure mode where the first scheduled run fires with a
// placeholder key still in process.env. PR #421 follow-up.
const server = app.listen(PORT, async () => {
  console.log(`October Marketing Intelligence backend running on port ${PORT}`);
  try {
    await loadSettingsFromDb();
  } catch (err) {
    console.error('Failed to load settings from DB on boot:', err.message);
  }
  require('./services/scheduler');
  require('./services/users').seedAdminIfMissing().catch(err => console.error('Admin seed failed:', err.message));
});

module.exports = server;
