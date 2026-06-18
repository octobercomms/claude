const express = require('express');
const jwt = require('jsonwebtoken');
const { authenticate } = require('../middleware/auth');
const users = require('../services/users');

const router = express.Router();

const TOKEN_TTL_SECONDS = 86400; // 24h, matches the JWT expiry

// httpOnly so page scripts can't read the session token (defence-in-depth
// against XSS); SameSite=Lax so it isn't sent on cross-site POST/fetch (CSRF
// protection) while same-origin SPA calls still carry it; Secure in production
// (HTTPS only). Path=/ so it covers the whole API.
function tokenCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: TOKEN_TTL_SECONDS * 1000,
  };
}

function issueToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = await users.findByUsername(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await users.verifyPassword(user, password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  res.cookie('token', issueToken(user), tokenCookieOptions());
  // The token is no longer returned in the body — it lives only in the
  // httpOnly cookie. Return the user so the client can render immediately.
  res.json({ user: { id: user.id, username: user.username, role: user.role }, expiresIn: TOKEN_TTL_SECONDS });
});

router.post('/refresh', authenticate, (req, res) => {
  res.cookie('token', issueToken(req.user), tokenCookieOptions());
  res.json({ expiresIn: TOKEN_TTL_SECONDS });
});

// Clear the session cookie. No auth required — logging out should work even
// with an already-expired token.
router.post('/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true });
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
