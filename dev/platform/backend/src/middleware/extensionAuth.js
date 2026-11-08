const crypto = require('crypto');
const db = require('../db');

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function authenticateExtension(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Extension token required' });
  }
  const raw = authHeader.slice(7);
  if (!raw) return res.status(401).json({ error: 'Extension token required' });

  const hash = hashToken(raw);
  const { rows } = await db.query(
    `SELECT id, label, created_at FROM acct_extension_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hash]
  );
  if (!rows.length) {
    return res.status(401).json({ error: 'Invalid or revoked extension token' });
  }

  db.query(
    'UPDATE acct_extension_tokens SET last_used = now() WHERE id = $1',
    [rows[0].id]
  ).catch(() => {});

  req.extensionToken = rows[0];
  next();
}

async function createToken(label) {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(raw);
  const { rows } = await db.query(
    `INSERT INTO acct_extension_tokens (token_hash, label)
     VALUES ($1, $2) RETURNING id, label, created_at`,
    [hash, label || 'Xero Brain Extension']
  );
  return { token: raw, id: rows[0].id, label: rows[0].label, created_at: rows[0].created_at };
}

async function revokeToken(id) {
  const { rowCount } = await db.query(
    'UPDATE acct_extension_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
    [id]
  );
  return rowCount > 0;
}

async function listTokens() {
  const { rows } = await db.query(
    `SELECT id, label, created_at, last_used, revoked_at
     FROM acct_extension_tokens ORDER BY created_at DESC`
  );
  return rows;
}

module.exports = { authenticateExtension, createToken, revokeToken, listTokens, hashToken };
