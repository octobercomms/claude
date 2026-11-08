const pool = require('../db');

// Every column a caller reads back. It is spelled out rather than `*` so a
// new column is a deliberate addition in one place — and that is also the
// trap: a column added to the table and NOT added here is silently absent
// from every RETURNING and every SELECT, so a caller that wrote it would read
// back a row that appears not to have it. `batch_id` and `template_id`
// (migration 249) are here for exactly that reason.
const COLS = `id, client_id, created_by, title, data, source_assets, transcripts,
              status, batch_id, template_id, created_at, updated_at`;

/**
 * Create a composition.
 *
 * `sourceAssets` and `batchId`/`templateId` are accepted here rather than
 * left to a follow-up update. A batch writing thirty of these would otherwise
 * have to create then update each one, which is two round trips per item and
 * a window in which a composition exists with no assets mapped to it.
 */
async function create({
  clientId, createdBy, title, data, sourceAssets, transcripts, batchId, templateId,
}) {
  const { rows } = await pool.query(
    `INSERT INTO compositions
       (client_id, created_by, title, data, source_assets, transcripts, batch_id, template_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLS}`,
    [
      clientId,
      createdBy || null,
      title || 'Untitled',
      JSON.stringify(data || {}),
      JSON.stringify(sourceAssets || {}),
      JSON.stringify(transcripts || {}),
      batchId == null ? null : batchId,
      templateId == null ? null : templateId,
    ],
  );
  return rows[0];
}

/**
 * A client's compositions, newest first.
 *
 * `batchId` narrows to one batch's items. `excludeBatched` leaves them out
 * entirely, which the editor's picker wants: the list is capped, so a
 * thirty-item batch would otherwise push a third of somebody's hand-built
 * work out of the only list there is.
 */
async function list(clientId, { batchId = null, excludeBatched = false, limit = 100 } = {}) {
  const where = ['client_id = $1'];
  const vals = [clientId];
  if (batchId != null) {
    where.push(`batch_id = $${vals.length + 1}`);
    vals.push(batchId);
  } else if (excludeBatched) {
    where.push('batch_id IS NULL');
  }
  vals.push(Math.max(1, Math.min(500, Number(limit) || 100)));
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM compositions
      WHERE ${where.join(' AND ')}
      ORDER BY updated_at DESC LIMIT $${vals.length}`,
    vals,
  );
  return rows;
}

async function get(id) {
  const { rows } = await pool.query(`SELECT ${COLS} FROM compositions WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function update(id, {
  title, data, sourceAssets, transcripts, status, batchId, templateId,
}) {
  const sets = ['updated_at = now()'];
  const vals = [];
  let n = 1;
  if (title !== undefined) { sets.push(`title = $${n}`); vals.push(title); n++; }
  if (data !== undefined) { sets.push(`data = $${n}`); vals.push(JSON.stringify(data)); n++; }
  if (sourceAssets !== undefined) { sets.push(`source_assets = $${n}`); vals.push(JSON.stringify(sourceAssets)); n++; }
  if (transcripts !== undefined) { sets.push(`transcripts = $${n}`); vals.push(JSON.stringify(transcripts)); n++; }
  if (status !== undefined) { sets.push(`status = $${n}`); vals.push(status); n++; }
  if (batchId !== undefined) { sets.push(`batch_id = $${n}`); vals.push(batchId); n++; }
  if (templateId !== undefined) { sets.push(`template_id = $${n}`); vals.push(templateId); n++; }
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
