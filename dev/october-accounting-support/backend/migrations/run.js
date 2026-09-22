require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

// Minimal forward-only migration runner. Applies every *.sql file in this
// directory in filename order, tracking applied files in a migrations table.

async function run() {
  await pool.query(`CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const done = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (done.rowCount) continue;
    const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }
  }
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
