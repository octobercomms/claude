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
  'GMAIL_USER', 'GMAIL_APP_PASSWORD',
];

router.use(authenticate);

// GET current settings (shows whether each key is set, not the value)
router.get('/platform-keys', async (req, res) => {
  try {
    const result = await db.query('SELECT key FROM platform_settings');
    const saved = new Set(result.rows.map(r => r.key));
    const settings = {};
    for (const key of SETTINGS_KEYS) {
      settings[key] = saved.has(key) ? '••••••••' : '';
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
      // Apply to running process immediately
      process.env[key] = val;
      updates.push(key);
    }
    res.json({ updated: updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test email
router.post('/test-email', async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Missing to address' });
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject: 'October Platform — Test Email',
      text: 'This is a test email from the October Performance Marketing Platform.',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
