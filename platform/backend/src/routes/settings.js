const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/clientAccess');
const { encrypt, decrypt } = require('../utils/encryption');
const nodemailer = require('nodemailer');
const dataforseo = require('../connectors/dataforseo');

const bcrypt = require('bcryptjs');

const SETTINGS_KEYS = [
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_MCC_ID',
  'META_APP_ID', 'META_APP_SECRET', 'META_REDIRECT_URI',
  'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET', 'SHOPIFY_REDIRECT_URI',
  'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REDIRECT_URI',
  'CLAUDE_API_KEY',
  'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD',
  'REPLICATE_API_TOKEN', 'IDEOGRAM_API_KEY',
  'ADOBE_CLIENT_ID', 'ADOBE_CLIENT_SECRET',
  'AMAZON_CLIENT_ID', 'AMAZON_CLIENT_SECRET', 'AMAZON_REDIRECT_URI',
  'HUNTER_API_KEY', 'ICYPEAS_API_KEY', 'ICYPEAS_API_SECRET', 'ICYPEAS_USER_ID', 'SERPER_API_KEY',
  'OUTREACH_IMAP_HOST', 'OUTREACH_IMAP_PORT', 'OUTREACH_IMAP_USER', 'OUTREACH_IMAP_PASSWORD',
  'N8N_WEBHOOK_BASE_URL',
  'EMAIL_PROVIDER',
  'GMAIL_USER', 'GMAIL_APP_PASSWORD',
  'SES_SMTP_USER', 'SES_SMTP_PASS', 'SES_REGION', 'SES_FROM_EMAIL',
  'SES_ACCESS_KEY_ID', 'SES_SECRET_ACCESS_KEY',
  'OUTREACH_SENDING_DOMAIN', 'OUTREACH_DEFAULT_REPLY_TO',
  'ALERT_EMAIL',
  // Editable report footer — three lines printed on every PDF page beneath
  // the "Page X of Y" line. Leave blank to use the built-in defaults.
  'REPORT_FOOTER_LINE_1', 'REPORT_FOOTER_LINE_2', 'REPORT_FOOTER_LINE_3',
];

router.use(authenticate);
// Every endpoint in this router exposes or mutates platform-wide secrets
// (API keys, OAuth client secrets, SMTP credentials, account password
// hashes). Viewers must never reach any of these.
router.use(requireAdmin);

// GET masked settings (•••• if set)
router.get('/platform-keys', async (req, res) => {
  try {
    const result = await db.query('SELECT key FROM platform_settings');
    const saved = new Set(result.rows.map(r => r.key));
    const settings = {};
    for (const key of SETTINGS_KEYS) {
      settings[key] = saved.has(key) ? '••••••••' : (process.env[key] ? '••••••••' : '');
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET revealed settings (decrypted values)
router.get('/platform-keys/values', async (req, res) => {
  try {
    const result = await db.query('SELECT key, value FROM platform_settings');
    const settings = {};
    for (const row of result.rows) {
      try {
        settings[row.key] = decrypt(JSON.parse(row.value)) || '';
      } catch {
        settings[row.key] = '';
      }
    }
    // Fill in env vars for keys not in DB
    for (const key of SETTINGS_KEYS) {
      if (!settings[key] && process.env[key]) settings[key] = process.env[key];
      if (!settings[key]) settings[key] = '';
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST save settings
router.post('/platform-keys', async (req, res) => {
  try {
    const updates = [];
    for (const key of SETTINGS_KEYS) {
      const val = req.body[key];
      if (!val || val === '••••••••') continue;
      const encrypted = encrypt(val);
      await db.query(
        `INSERT INTO platform_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, JSON.stringify(encrypted)]
      );
      process.env[key] = val;
      updates.push(key);
    }
    res.json({ updated: updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST test DataForSEO credentials (uses supplied values, or the saved ones)
router.post('/test-dataforseo', async (req, res) => {
  const clean = v => (v && v !== '••••••••' ? v : undefined);
  try {
    const result = await dataforseo.testCredentials({
      login: clean(req.body.login),
      password: clean(req.body.password),
    });
    res.json(result);
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

// GET account info (username only)
router.get('/account', async (req, res) => {
  try {
    const result = await db.query(`SELECT value FROM platform_settings WHERE key = 'ADMIN_USERNAME'`);
    let username = '';
    if (result.rows.length) {
      try { username = decrypt(JSON.parse(result.rows[0].value)) || ''; } catch {}
    }
    res.json({ username: username || process.env.ADMIN_USERNAME || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST update account credentials
router.post('/account', async (req, res) => {
  const { username, currentPassword, newPassword } = req.body;
  if (!currentPassword) return res.status(400).json({ error: 'Current password required' });

  try {
    // Verify current password
    const storedHash = await (async () => {
      const r = await db.query(`SELECT value FROM platform_settings WHERE key = 'ADMIN_PASSWORD'`);
      if (r.rows.length) {
        try { return decrypt(JSON.parse(r.rows[0].value)) || null; } catch { return null; }
      }
      return null;
    })();

    const envPassword = process.env.ADMIN_PASSWORD || '';
    const passwordToCheck = storedHash || envPassword;

    const valid = passwordToCheck.startsWith('$2')
      ? await bcrypt.compare(currentPassword, passwordToCheck)
      : currentPassword === passwordToCheck;

    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    // Update username
    if (username) {
      const encUser = encrypt(username);
      await db.query(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES ('ADMIN_USERNAME', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [JSON.stringify(encUser)]
      );
      process.env.ADMIN_USERNAME = username;
    }

    // Update password
    if (newPassword) {
      const hash = await bcrypt.hash(newPassword, 12);
      const encPass = encrypt(hash);
      await db.query(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES ('ADMIN_PASSWORD', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [JSON.stringify(encPass)]
      );
      process.env.ADMIN_PASSWORD = hash;
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test email using whichever provider is configured
router.post('/test-email', async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Missing to address' });
  try {
    const transporter = buildTransporter();
    const from = process.env.EMAIL_PROVIDER === 'ses'
      ? process.env.SES_FROM_EMAIL
      : `"October Communications" <${process.env.GMAIL_USER}>`;
    await transporter.sendMail({
      from,
      to,
      subject: 'October Marketing Intelligence — Test Email',
      text: 'This is a test email from October Marketing Intelligence.',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildTransporter() {
  if (process.env.EMAIL_PROVIDER === 'ses') {
    const region = process.env.SES_REGION || 'eu-west-1';
    return nodemailer.createTransport({
      host: `email-smtp.${region}.amazonaws.com`,
      port: 587,
      secure: false,
      auth: { user: process.env.SES_SMTP_USER, pass: process.env.SES_SMTP_PASS },
    });
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

module.exports = router;
module.exports.buildTransporter = buildTransporter;
