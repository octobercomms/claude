// The client's competitors, in one place.
//
// Before this, the same question was answered twice and stored once.
// Quick Start asked Claude for competitors and kept only the hostnames in
// clients.competitor_domains, discarding the brand name and the one-line
// reason it had paid for. The Paid → Competitors panel then asked Claude the
// same question again through its own endpoint, held the answer in component
// state, and lost it the moment you navigated away.
//
// So: one stored list, written by both, read by both, and asked for only
// when it is empty.
//
// On clients.competitor_domains — it stays, and it stays correct. Seven
// services read it (local SEO in four places, ICP intelligence, backlink
// prospecting, the strategist briefing, suite progress), and rewriting all of
// them was far outside what this change was asked to do. Every write here
// rebuilds that column from this table in the same transaction. One writer,
// one direction, so there is no way for the two to disagree.

const pool = require('../db');
const competitorSuggest = require('./competitorSuggest');

const REGIONS = ['GB', 'US', 'IE', 'AU', 'CA', 'NZ', 'FR', 'DE', 'ES', 'IT', 'NL'];

function normalizeHost(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return null;
  return s.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0] || null;
}

function normalizeRegion(value) {
  const s = String(value || '').trim().toUpperCase();
  return REGIONS.includes(s) ? s : 'GB';
}

// Rebuild clients.competitor_domains from this table. Called inside the same
// transaction as every write, never on its own, so the column is a pure
// function of these rows and cannot be left stale by a failed write.
async function syncDomains(client, clientId) {
  await client.query(
    `UPDATE clients SET competitor_domains = COALESCE((
       SELECT array_agg(domain ORDER BY created_at)
         FROM client_competitors
        WHERE client_id = $1 AND domain IS NOT NULL
     ), '{}') WHERE id = $1`,
    [clientId]
  );
}

async function list(clientId) {
  // Each competitor carries its own pull history, joined rather than stored:
  // ad_count and last_pulled_at are facts about competitor_ad_runs, and
  // copying them here would be two places to keep right.
  const { rows } = await pool.query(
    `SELECT cc.*,
            r.ad_count    AS last_ad_count,
            r.created_at  AS last_pulled_at,
            r.id          AS last_run_id
       FROM client_competitors cc
       LEFT JOIN LATERAL (
         SELECT id, ad_count, created_at
           FROM competitor_ad_runs
          WHERE client_id = cc.client_id
            AND lower(query) = lower(COALESCE(cc.domain, cc.name))
          ORDER BY created_at DESC
          LIMIT 1
       ) r ON true
      WHERE cc.client_id = $1
      ORDER BY cc.created_at, cc.id`,
    [clientId]
  );
  return rows;
}

async function add(clientId, { name, domain, reason, region, source = 'manual' }) {
  const host = normalizeHost(domain);
  const label = String(name || '').trim() || host;
  if (!label) throw new Error('A competitor needs a name or a domain.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // ON CONFLICT on the partial index: adding a competitor already on the
    // list fills in anything the existing row is missing rather than
    // erroring or silently doing nothing. Re-running Suggest after someone
    // typed a domain by hand should give that row its reason, not a
    // duplicate and not a dead end.
    // Two unique indexes cover two different shapes of duplicate, and
    // ON CONFLICT can only name one of them, so the no-domain case is
    // handled first and explicitly. Without this, a competitor Claude knows
    // by name but cannot place a domain on gained a fresh row every time
    // anyone pressed "suggest more".
    const conflictTarget = host
      ? 'ON CONFLICT (client_id, lower(domain)) WHERE domain IS NOT NULL'
      : 'ON CONFLICT (client_id, lower(name)) WHERE domain IS NULL';
    const { rows } = await client.query(
      `INSERT INTO client_competitors (client_id, name, domain, reason, region, source)
            VALUES ($1, $2, $3, $4, $5, $6)
       ${conflictTarget}
       DO UPDATE SET name   = COALESCE(NULLIF(EXCLUDED.name, ''), client_competitors.name),
                     reason = COALESCE(client_competitors.reason, EXCLUDED.reason)
       RETURNING *`,
      [clientId, label, host, String(reason || '').trim() || null, normalizeRegion(region), source]
    );
    await syncDomains(client, clientId);
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

async function update(clientId, id, { name, domain, reason, region }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE client_competitors SET
         name   = COALESCE($3, name),
         domain = CASE WHEN $4::boolean THEN $5 ELSE domain END,
         reason = COALESCE($6, reason),
         region = COALESCE($7, region)
       WHERE id = $1 AND client_id = $2 RETURNING *`,
      [id, clientId,
       name === undefined ? null : String(name).trim() || null,
       domain !== undefined, domain === undefined ? null : normalizeHost(domain),
       reason === undefined ? null : String(reason).trim() || null,
       region === undefined ? null : normalizeRegion(region)]
    );
    if (!rows.length) { await client.query('ROLLBACK'); return null; }
    await syncDomains(client, clientId);
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

async function remove(clientId, id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      'DELETE FROM client_competitors WHERE id = $1 AND client_id = $2', [id, clientId]);
    await syncDomains(client, clientId);
    await client.query('COMMIT');
    return rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

// Ask Claude, but only when there is nothing stored.
//
// `force` is the explicit "suggest more" press, which is the one case where
// paying for a second opinion is what the user asked for. Everything else —
// opening the panel, Quick Start running on a client that already has
// competitors — reads the table and spends nothing.
async function suggest(clientId, { force = false } = {}) {
  const existing = await list(clientId);
  if (existing.length && !force) return { competitors: existing, from: 'stored' };

  const proposed = await competitorSuggest.suggestCompetitors(clientId);
  for (const c of proposed) {
    // One at a time, because a single competitor failing to insert should
    // not lose the other seven. The unique index makes a repeat a no-op.
    try {
      await add(clientId, { ...c, source: 'suggest' });
    } catch (err) {
      console.error('[competitors] could not store suggestion:', c.domain || c.name, err.message);
    }
  }
  return { competitors: await list(clientId), from: 'claude' };
}

module.exports = { list, add, update, remove, suggest, normalizeHost, normalizeRegion, REGIONS };
