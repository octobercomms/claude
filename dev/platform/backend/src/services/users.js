const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db');

const BCRYPT_ROUNDS = 12;

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

// Called from index.js on boot. Seeds an admin user from
// ADMIN_USERNAME / ADMIN_PASSWORD only when the users table has no admin
// yet — useful for first boot, harmless on subsequent restarts.
//
// The previous behaviour was an upsert on every boot, which clobbered any
// password change made through the UI and caused real lockouts when env
// drifted. The new behaviour leaves existing admins alone; the operator
// manages their password via /api/auth/change-password instead.
async function seedAdminIfMissing() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  const { rows } = await pool.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
  if (rows.length) return;
  const hash = password.startsWith('$2') ? password : await bcrypt.hash(password, BCRYPT_ROUNDS);
  await pool.query(`
    INSERT INTO users (username, password_hash, role)
    VALUES ($1, $2, 'admin')
    ON CONFLICT (username) DO NOTHING
  `, [username, hash]);
}

// Change a user's own password — verifies the current password before
// applying the update. Used by /api/auth/change-password.
async function changePassword(userId, currentPassword, newPassword) {
  const user = await findById(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  const ok = await verifyPassword(user, currentPassword);
  if (!ok) throw Object.assign(new Error('Current password is incorrect'), { status: 401 });
  if (!newPassword || newPassword.length < 8) {
    throw Object.assign(new Error('New password must be at least 8 characters'), { status: 400 });
  }
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
}

// Invite a read-only client by email: create a client-role user (username =
// email, an unusable random password) scoped to their client(s), with a
// one-time set-password token. Returns the raw token so the caller can email
// the link.
async function inviteClient({ email, clientIds = [] }) {
  const norm = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm)) throw new Error('a valid email is required');
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const unusableHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), BCRYPT_ROUNDS);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // username + email are separate params (they're different column types —
    // varchar vs text — so a single $1 for both makes Postgres reject it with
    // "inconsistent types deduced for parameter $1").
    const { rows } = await client.query(
      `INSERT INTO users (username, email, password_hash, role, invite_token, invite_expires_at)
       VALUES ($1, $2, $3, 'client', $4, $5)
       RETURNING id, username, email, role, created_at`,
      [norm, norm, unusableHash, token, expires]
    );
    const user = rows[0];
    for (const cid of clientIds) {
      await client.query('INSERT INTO user_clients (user_id, client_id) VALUES ($1, $2)', [user.id, cid]);
    }
    await client.query('COMMIT');
    return { ...user, invite_token: token };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Public: the email tied to a valid, unexpired invite token (so the
// set-password page can greet them). Returns null if invalid/expired.
async function inviteInfo(token) {
  if (!token) return null;
  const { rows } = await pool.query('SELECT email, invite_expires_at FROM users WHERE invite_token = $1', [token]);
  if (!rows.length) return null;
  if (rows[0].invite_expires_at && new Date(rows[0].invite_expires_at) < new Date()) return null;
  return { email: rows[0].email };
}

// Public: set a password from a valid invite token; consumes the token.
async function setPasswordByToken(token, password) {
  if (!token || !password || String(password).length < 8) {
    const e = new Error('A password of at least 8 characters is required.'); e.status = 400; throw e;
  }
  const { rows } = await pool.query('SELECT id, invite_expires_at FROM users WHERE invite_token = $1', [token]);
  if (!rows.length) { const e = new Error('This link is invalid or has already been used.'); e.status = 400; throw e; }
  if (rows[0].invite_expires_at && new Date(rows[0].invite_expires_at) < new Date()) {
    const e = new Error('This link has expired — ask your account manager to re-send it.'); e.status = 400; throw e;
  }
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await pool.query('UPDATE users SET password_hash = $1, invite_token = NULL, invite_expires_at = NULL WHERE id = $2', [hash, rows[0].id]);
  return { ok: true };
}

module.exports = {
  findByUsername, findById, listAll, create, update, remove,
  verifyPassword, changePassword, getVisibleClientIds, canAccessClient,
  seedAdminIfMissing, inviteClient, inviteInfo, setPasswordByToken,
};
