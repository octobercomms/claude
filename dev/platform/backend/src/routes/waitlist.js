const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');

// Public — homepage waitlist signups. Emailed straight through; not stored.
router.post('/', async (req, res) => {
  const email = (req.body.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  try {
    await emailService.sendWaitlistSignup(email);
    res.json({ ok: true });
  } catch (err) {
    console.error('Waitlist signup notification failed:', err.message);
    res.status(500).json({ error: 'Could not record signup.' });
  }
});

module.exports = router;
