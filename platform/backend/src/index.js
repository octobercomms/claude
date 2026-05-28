require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');
const { decrypt, assertKeyValid } = require('./utils/encryption');

// Validate ENCRYPTION_KEY at boot so an operator running with a non-hex
// value sees the error immediately rather than the first time a
// connector is decrypted.
try { assertKeyValid(); }
catch (err) { console.error('FATAL:', err.message); process.exit(1); }

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
  // Bearer-only auth — credentials:true was harmless but suggested a
  // misunderstanding; drop it now so it doesn't become risky if cookie
  // auth ever lands.
  origin: process.env.NODE_ENV === 'production'
    ? process.env.PLATFORM_URL
    : ['http://localhost:3000', 'http://localhost:5173'],
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting on auth endpoint
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// Global per-IP cap to make UUID brute-forcing of public endpoints
// (report HTML, approval links, open-tracking pixel) non-trivial and
// to cap accidental loops in client code. Generous limit so normal
// dashboard use never trips it.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
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

app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/connectors', require('./routes/connectors'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/rankings', require('./routes/rankings'));
app.use('/api/seo', require('./routes/seoSuite'));
app.use('/api/social', require('./routes/social'));
app.use('/api/brand', require('./routes/brandAssets'));
app.use('/api/ad-creatives', require('./routes/adCreatives'));
app.use('/api/approvals', require('./routes/approvals'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/outreach', require('./routes/outreach'));
app.use('/api/press', require('./routes/press'));
app.use('/api/sales-traffic', require('./routes/salesTraffic'));
app.use('/api/strategist', require('./routes/strategist'));
app.use('/api/october-forms', require('./routes/octoberForms'));
app.use('/api/waitlist', require('./routes/waitlist'));
app.use('/auth', require('./routes/oauth'));

// Serve PDFs
app.use('/pdfs', require('./middleware/auth').authenticate, express.static(path.join(__dirname, '../pdfs')));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Start server, load DB settings + sync env admin in background
require('./services/scheduler');
const server = app.listen(PORT, () => {
  console.log(`October Marketing Intelligence backend running on port ${PORT}`);
  loadSettingsFromDb();
  require('./services/users').seedAdminIfMissing().catch(err => console.error('Admin seed failed:', err.message));
});

module.exports = server;
