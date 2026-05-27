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

  // Legacy tokens (issued before the users table existed) carry only
  // { username, role }. Look the id up so downstream visibility checks have
  // something to filter on.
  if (!payload.id && payload.username) {
    try {
      const { rows } = await pool.query('SELECT id, role FROM users WHERE username = $1', [payload.username]);
      if (rows[0]) {
        payload.id = rows[0].id;
        payload.role = rows[0].role;
      }
    } catch {}
  }
  req.user = payload;
  next();
}

module.exports = { authenticate };
