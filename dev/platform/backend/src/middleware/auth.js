const jwt = require('jsonwebtoken');
const pool = require('../db');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice(7);
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
  next();
}

module.exports = { authenticate };
