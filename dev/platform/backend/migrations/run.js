require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');

async function runMigrations() {
  const client = await pool.connect();
  try {
    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(__dirname);
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [file]
      );
      if (rows.length > 0) {
        console.log(`Skipping ${file} (already applied)`);
        continue;
      }

      console.log(`Applying ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`Applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    console.log('All migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(err => {
  console.error(err.message);
  process.exit(1);
});
