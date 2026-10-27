/**
 * The client asset library.
 *
 * Every tool in Produce, and every production step in Shared, Earned and Paid,
 * records what it made here. The producing tables stay the record of each
 * production run; this is the index that makes them findable, and the only
 * thing in OMI that can answer "what have we made for this client".
 *
 * Recording is deliberately forgiving. An asset that fails to index is a
 * findability problem, not a production failure, and a render that threw away
 * a finished video because the library was briefly unreachable would be a far
 * worse bug than one missing row. So `record` never throws at its caller.
 */
const pool = require('../db');

const KINDS = ['video', 'image', 'audio', 'document'];
const SOURCES = ['recording', 'video_project', 'social_media', 'ad_creative',
  'design', 'caption_render', 'scene_render', 'upload'];

/** Guess a kind from a mime type or a filename, so callers rarely pass one. */
function kindOf({ kind, mime, url, storage_key: key }) {
  if (KINDS.includes(kind)) return kind;
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  const path = String(url || key || '').toLowerCase().split('?')[0];
  if (/\.(mp4|mov|webm|m4v|avi)$/.test(path)) return 'video';
  if (/\.(png|jpe?g|webp|gif|svg|avif)$/.test(path)) return 'image';
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(path)) return 'audio';
  return 'document';
}

/**
 * Index one asset. Idempotent on (source, source_id), so a producer that runs
 * twice updates the row rather than adding a second one: re-rendering a project
 * should replace what the library knows about it, not leave the old output
 * sitting there looking current.
 */
async function record(asset) {
  try {
    const {
      client_id: clientId, source, source_id: sourceId,
      title = '', url = null, storage_key: storageKey = null,
      mime = null, width = null, height = null,
      duration_s: durationS = null, bytes = null,
      metadata = {}, created_by: createdBy = null,
    } = asset || {};

    if (!clientId) throw new Error('an asset without a client cannot be found again');
    if (!SOURCES.includes(source)) throw new Error(`unknown asset source "${source}"`);
    if (!sourceId) throw new Error('an asset needs its producer\'s own id');
    if (!url && !storageKey) throw new Error('an asset needs a url or a storage key');

    const { rows } = await pool.query(
      `INSERT INTO client_assets
         (client_id, kind, source, source_id, title, url, storage_key, mime,
          width, height, duration_s, bytes, metadata, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (source, source_id) DO UPDATE SET
         title = EXCLUDED.title, url = EXCLUDED.url, storage_key = EXCLUDED.storage_key,
         mime = EXCLUDED.mime, width = EXCLUDED.width, height = EXCLUDED.height,
         duration_s = EXCLUDED.duration_s, bytes = EXCLUDED.bytes,
         metadata = client_assets.metadata || EXCLUDED.metadata,
         archived_at = NULL
       RETURNING *`,
      [clientId, kindOf(asset), source, String(sourceId), title, url, storageKey, mime,
        width, height, durationS, bytes, JSON.stringify(metadata || {}), createdBy],
    );
    return rows[0];
  } catch (err) {
    // Loud in the log, silent to the caller. See the note at the top.
    console.error('[assets] could not index an asset:', err.message, {
      source: asset?.source, source_id: asset?.source_id,
    });
    return null;
  }
}

/** What exists for a client. Archived rows stay out unless asked for. */
async function list(clientId, { kind = null, source = null, limit = 200,
  offset = 0, includeArchived = false, search = null } = {}) {
  const where = ['client_id = $1'];
  const args = [clientId];
  if (!includeArchived) where.push('archived_at IS NULL');
  if (kind) { args.push(kind); where.push(`kind = $${args.length}`); }
  if (source) { args.push(source); where.push(`source = $${args.length}`); }
  if (search) { args.push(`%${search}%`); where.push(`title ILIKE $${args.length}`); }
  args.push(Math.min(500, Math.max(1, Number(limit) || 200)));
  args.push(Math.max(0, Number(offset) || 0));
  const { rows } = await pool.query(
    `SELECT * FROM client_assets WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
  return rows;
}

/** What the library holds, by kind. Cheap enough to put on any screen. */
async function counts(clientId) {
  const { rows } = await pool.query(
    `SELECT kind, COUNT(*)::INT AS n FROM client_assets
      WHERE client_id = $1 AND archived_at IS NULL GROUP BY kind`, [clientId]);
  const out = { video: 0, image: 0, audio: 0, document: 0, total: 0 };
  for (const r of rows) { out[r.kind] = r.n; out.total += r.n; }
  return out;
}

async function get(id) {
  const { rows } = await pool.query('SELECT * FROM client_assets WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * Archive rather than delete. An asset referenced by a scheduled post must not
 * vanish from under it, and "we made this and then dropped it" is itself worth
 * knowing when the same idea comes round again.
 */
async function archive(id, archived = true) {
  const { rows } = await pool.query(
    `UPDATE client_assets SET archived_at = ${archived ? 'NOW()' : 'NULL'}
      WHERE id = $1 RETURNING *`, [id]);
  return rows[0] || null;
}

module.exports = { record, list, counts, get, archive, kindOf, KINDS, SOURCES };
