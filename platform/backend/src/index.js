require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');
const { decrypt } = require('./utils/encryption');

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
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.PLATFORM_URL
    : ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting on auth endpoint
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// Routes
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/connectors', require('./routes/connectors'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/rankings', require('./routes/rankings'));
app.use('/api/seo', require('./routes/seoSuite'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/outreach', require('./routes/outreach'));
app.use('/api/sales-traffic', require('./routes/salesTraffic'));
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
