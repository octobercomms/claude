const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (username !== adminUsername) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Support both plain text (dev) and bcrypt hashed passwords
  let valid = false;
  if (adminPassword.startsWith('$2')) {
    valid = await bcrypt.compare(password, adminPassword);
  } else {
    valid = password === adminPassword;
  }

  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { username, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({ token, expiresIn: 86400 });
});

router.post('/refresh', authenticate, (req, res) => {
  const token = jwt.sign(
    { username: req.user.username, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
  res.json({ token, expiresIn: 86400 });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

module.exports = router;
