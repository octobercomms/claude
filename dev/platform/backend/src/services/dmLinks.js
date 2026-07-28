// Tracked links for the DM autoresponder (ported from OpenReply).
//
// When the bot sends a DM, every URL in the reply is swapped for a short
// /api/social/r/<code> redirect that counts clicks — so "comment WORD for the
// link" campaigns show real tap-through, not just sends. Links are keyed by
// (client, destination) so the same URL keeps one code and one running total,
// whether it was auto-created on send or made by hand in the panel.

const crypto = require('crypto');
const pool = require('../db');
const { getSetting } = require('../utils/settings');

// Grab http(s) URLs; the trailing-char class avoids swallowing sentence
// punctuation that follows a link ("see https://x.com/y." → keeps the dot out).
const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"])/gi;

async function publicBase() {
  const s = (await getSetting('PUBLIC_BASE_URL')) || process.env.PUBLIC_BASE_URL || 'https://platform.octobercomms.com';
  return String(s).replace(/\/+$/, '');
}
function shortUrlFor(base, code) { return `${base}/api/social/r/${code}`; }
function genCode() {
  const c = crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 7);
  return c.length >= 5 ? c : crypto.randomBytes(4).toString('hex');
}

// One row per (client, destination). Concurrent auto-tracking of the same URL
// can race on the unique index; the catch re-reads the winning row.
async function findOrCreate(clientId, destination, label = null) {
  const dest = String(destination || '').trim();
  if (!/^https?:\/\//i.test(dest)) { const e = new Error('Link must be a full http(s) URL.'); e.status = 400; throw e; }
  const { rows: ex } = await pool.query('SELECT * FROM social_dm_links WHERE client_id = $1 AND destination = $2', [clientId, dest]);
  if (ex.length) {
    if (label && !ex[0].label) { await pool.query('UPDATE social_dm_links SET label = $2 WHERE id = $1', [ex[0].id, label]); ex[0].label = label; }
    return ex[0];
  }
  for (let i = 0; i < 5; i++) {
    try {
      const { rows } = await pool.query(
        'INSERT INTO social_dm_links (client_id, code, destination, label) VALUES ($1, $2, $3, $4) RETURNING *',
        [clientId, genCode(), dest, label]
      );
      return rows[0];
    } catch (e) {
      // Either a code collision (retry) or a concurrent insert of the same
      // destination (re-read and use the winner).
      const { rows } = await pool.query('SELECT * FROM social_dm_links WHERE client_id = $1 AND destination = $2', [clientId, dest]);
      if (rows.length) return rows[0];
      if (!/unique|duplicate/i.test(e.message)) throw e;
    }
  }
  throw new Error('Could not create a tracked link.');
}

async function shorten(clientId, destination, label = null) {
  const link = await findOrCreate(clientId, destination, label);
  const base = await publicBase();
  return { ...link, short_url: shortUrlFor(base, link.code) };
}

// Rewrite every URL in `text` to its tracked short link. Non-fatal: a URL that
// can't be shortened is left as-is rather than dropping the message.
async function trackify(clientId, text) {
  const s = String(text || '');
  const urls = [...new Set(s.match(URL_RE) || [])];
  if (!urls.length) return s;
  const base = await publicBase();
  let out = s;
  for (const u of urls) {
    try {
      const link = await findOrCreate(clientId, u);
      out = out.split(u).join(shortUrlFor(base, link.code));
    } catch { /* leave the original URL in place */ }
  }
  return out;
}

// Resolve a code to its destination and count the click. NULL if unknown.
async function resolve(code) {
  const { rows } = await pool.query(
    'UPDATE social_dm_links SET clicks = clicks + 1, last_clicked_at = NOW() WHERE code = $1 RETURNING destination',
    [String(code || '')]
  );
  return rows[0]?.destination || null;
}

async function list(clientId) {
  const base = await publicBase();
  const { rows } = await pool.query(
    'SELECT * FROM social_dm_links WHERE client_id = $1 ORDER BY clicks DESC, created_at DESC',
    [clientId]
  );
  return rows.map(r => ({ ...r, short_url: shortUrlFor(base, r.code) }));
}

async function remove(clientId, id) {
  await pool.query('DELETE FROM social_dm_links WHERE id = $1 AND client_id = $2', [id, clientId]);
}

module.exports = { shorten, trackify, resolve, list, remove, findOrCreate, _URL_RE: URL_RE };
