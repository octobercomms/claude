const express = require('express');
const jwt = require('jsonwebtoken');
const { authenticate } = require('../middleware/auth');
const users = require('../services/users');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = await users.findByUsername(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await users.verifyPassword(user, password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({ token, expiresIn: 86400 });
});

router.post('/refresh', authenticate, (req, res) => {
  const token = jwt.sign(
    { id: req.user.id, username: req.user.username, role: req.user.role },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
  res.json({ token, expiresIn: 86400 });
});

router.get('/me', authenticate, (req, res) => {
  // dataforseo_availability lets the frontend render the "becomes
  // available on 1 July 2026" banner without having to know the
  // cutover date itself.
  const { availabilityForClient } = require('../services/dfsAvailability');
  res.json({
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    dataforseo_availability: availabilityForClient(),
  });
});

// Self-service password change for the authenticated user. Requires
// current password, enforces a minimum length on the new one, then
// re-hashes and stores. Any role can use this for their own account.
router.post('/change-password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password and new_password required' });
  }
  try {
    await users.changePassword(req.user.id, current_password, new_password);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
