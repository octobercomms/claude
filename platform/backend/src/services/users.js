const bcrypt = require('bcryptjs');
const pool = require('../db');

const BCRYPT_ROUNDS = 10;

async function findByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listAll() {
  const { rows } = await pool.query(`
    SELECT u.id, u.username, u.role, u.created_at, u.updated_at,
           COALESCE(json_agg(uc.client_id) FILTER (WHERE uc.client_id IS NOT NULL), '[]') AS client_ids
    FROM users u
    LEFT JOIN user_clients uc ON uc.user_id = u.id
    GROUP BY u.id
    ORDER BY u.role, u.username
  `);
  return rows;
}

async function create({ username, password, role = 'viewer', clientIds = [] }) {
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
      [username, hash, role]
    );
    const user = rows[0];
    for (const cid of clientIds) {
      await client.query('INSERT INTO user_clients (user_id, client_id) VALUES ($1, $2)', [user.id, cid]);
    }
    await client.query('COMMIT');
    return { ...user, client_ids: clientIds };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function update(id, { password, role, clientIds }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (password) {
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
    }
    if (role) {
      await client.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
    }
    if (Array.isArray(clientIds)) {
      await client.query('DELETE FROM user_clients WHERE user_id = $1', [id]);
      for (const cid of clientIds) {
        await client.query('INSERT INTO user_clients (user_id, client_id) VALUES ($1, $2)', [id, cid]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function remove(id) {
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
}

async function verifyPassword(user, password) {
  if (!user || !user.password_hash) return false;
  return bcrypt.compare(password, user.password_hash);
}

// Visibility: admins see everything (null sentinel); viewers see only assigned clients.
async function getVisibleClientIds(user) {
  if (!user) return [];
  if (user.role === 'admin') return null;
  const { rows } = await pool.query('SELECT client_id FROM user_clients WHERE user_id = $1', [user.id]);
  return rows.map(r => r.client_id);
}

function canAccessClient(visibleIds, clientId) {
  if (visibleIds === null) return true;
  return Array.isArray(visibleIds) && visibleIds.includes(clientId);
}

// Called from index.js on boot — keeps the env admin in sync with the DB
// so the legacy ADMIN_USERNAME/ADMIN_PASSWORD env vars remain the source of
// truth for the primary admin. Idempotent.
async function syncAdminFromEnv() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  const hash = password.startsWith('$2') ? password : await bcrypt.hash(password, BCRYPT_ROUNDS);
  await pool.query(`
    INSERT INTO users (username, password_hash, role)
    VALUES ($1, $2, 'admin')
    ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'
  `, [username, hash]);
}

module.exports = {
  findByUsername, findById, listAll, create, update, remove,
  verifyPassword, getVisibleClientIds, canAccessClient, syncAdminFromEnv,
};
