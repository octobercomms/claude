const pool = require('../db');

const COLS = 'id, client_id, created_by, title, data, source_assets, transcripts, status, created_at, updated_at';

async function create({ clientId, createdBy, title, data }) {
  const { rows } = await pool.query(
    `INSERT INTO compositions (client_id, created_by, title, data)
     VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
    [clientId, createdBy || null, title || 'Untitled', JSON.stringify(data || {})],
  );
  return rows[0];
}

async function list(clientId) {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM compositions WHERE client_id = $1 ORDER BY updated_at DESC LIMIT 100`,
    [clientId],
  );
  return rows;
}

async function get(id) {
  const { rows } = await pool.query(`SELECT ${COLS} FROM compositions WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function update(id, { title, data, sourceAssets, transcripts, status }) {
  const sets = ['updated_at = now()'];
  const vals = [];
  let n = 1;
  if (title !== undefined) { sets.push(`title = $${n}`); vals.push(title); n++; }
  if (data !== undefined) { sets.push(`data = $${n}`); vals.push(JSON.stringify(data)); n++; }
  if (sourceAssets !== undefined) { sets.push(`source_assets = $${n}`); vals.push(JSON.stringify(sourceAssets)); n++; }
  if (transcripts !== undefined) { sets.push(`transcripts = $${n}`); vals.push(JSON.stringify(transcripts)); n++; }
  if (status !== undefined) { sets.push(`status = $${n}`); vals.push(status); n++; }
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE compositions SET ${sets.join(', ')} WHERE id = $${n} RETURNING ${COLS}`,
    vals,
  );
  return rows[0] || null;
}

async function remove(id) {
  await pool.query('DELETE FROM compositions WHERE id = $1', [id]);
}

module.exports = { create, list, get, update, remove };
