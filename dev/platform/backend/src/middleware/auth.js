const jwt = require('jsonwebtoken');
const pool = require('../db');

// Pull the JWT from the httpOnly `token` cookie (the primary path) or, as a
// fallback, a Bearer header. The cookie keeps the token out of reach of
// page scripts (XSS can't read httpOnly cookies); the Bearer fallback keeps
// any header-based caller — and sessions mid-transition during a deploy —
// working. Cookie parsed by hand to avoid pulling in cookie-parser.
function tokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  const raw = req.headers.cookie;
  if (raw) {
    for (const part of raw.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === 'token') {
        return decodeURIComponent(part.slice(eq + 1).trim());
      }
    }
  }
  return null;
}

async function authenticate(req, res, next) {
  const token = tokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Always re-read id + role from the users table so a role change (e.g.
  // demoting an admin to viewer) takes effect immediately rather than
  // waiting up to 24h for the JWT to expire. We accept a legacy token that
  // carries only the username — look it up by username.
  try {
    const where = payload.id ? 'id = $1' : 'username = $1';
    const value = payload.id || payload.username;
    const { rows } = await pool.query(`SELECT id, username, role FROM users WHERE ${where}`, [value]);
    if (!rows[0]) return res.status(401).json({ error: 'User no longer exists' });
    req.user = { id: rows[0].id, username: rows[0].username, role: rows[0].role };
  } catch {
    return res.status(500).json({ error: 'Auth lookup failed' });
  }

  // Read-only client logins: a 'client' role can never mutate data or spend AI
  // credits. Every generator/producer in the app is a POST, so blocking all
  // non-GET requests for this role is a single, auditable guarantee. Auth
  // self-service (login/logout/change-password/me) is exempt — none of it
  // spends anything. GET/HEAD/OPTIONS pass through (OPTIONS is CORS preflight).
  if (req.user.role === 'client'
      && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      && !(req.originalUrl || '').startsWith('/api/auth/')) {
    return res.status(403).json({ error: 'Your account has read-only access.' });
  }

  next();
}

// Guard for endpoints that spend money on a GET (e.g. live DataForSEO
// lookups) — the read-only client gate only blocks non-GET, so these paid
// reads need an explicit block for the 'client' role. Use on any route that
// hits a paid external API from a GET handler.
function agencyOnly(req, res, next) {
  if (req.user?.role === 'client') {
    return res.status(403).json({ error: 'This isn’t available on a read-only account.' });
  }
  next();
}

module.exports = { authenticate, tokenFromRequest, agencyOnly };
