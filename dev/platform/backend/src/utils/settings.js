const db = require('../db');
const { decrypt } = require('./encryption');

// Reads a platform setting from the database — the source of truth that the
// Settings page writes to — decrypting the stored value. Falls back to
// process.env so values supplied purely via the environment still work.
async function getSetting(key) {
  try {
    const { rows } = await db.query('SELECT value FROM platform_settings WHERE key = $1', [key]);
    if (rows.length) {
      const val = decrypt(JSON.parse(rows[0].value));
      if (val) return val;
    }
  } catch {
    // Fall through to the environment variable.
  }
  return process.env[key] || null;
}

module.exports = { getSetting };
