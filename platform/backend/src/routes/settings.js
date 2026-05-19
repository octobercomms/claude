const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/encryption');
const nodemailer = require('nodemailer');

const SETTINGS_KEYS = [
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'META_APP_ID', 'META_APP_SECRET',
  'CLAUDE_API_KEY',
  'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD',
  'AMAZON_CLIENT_ID',
  'N8N_WEBHOOK_BASE_URL',
  'EMAIL_PROVIDER',
  'GMAIL_USER', 'GMAIL_APP_PASSWORD',
  'SES_SMTP_USER', 'SES_SMTP_PASS', 'SES_REGION', 'SES_FROM_EMAIL',
];

router.use(authenticate);

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
      subject: 'October Platform — Test Email',
      text: 'This is a test email from the October Performance Marketing Platform.',
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
