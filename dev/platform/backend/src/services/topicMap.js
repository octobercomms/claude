// Content topic maps — grow a persisted content plan from a seed.
//
//   seed → expandSeed() (Claude builds the keyword universe, grounded in the
//          client brief + their existing tracked keywords)
//        → keywordClusters.clusterKeywords() (question-led clusters)
//        → saved as a topic map: each cluster = one planned piece with a status.
//
// Clusters then flow through the same brief → draft pipeline as everywhere else,
// but the map remembers them, so it doubles as a content plan / editorial board.

const pool = require('../db');
const claudeService = require('./claude');
const keywordClusters = require('./keywordClusters');

const MODEL = 'claude-sonnet-4-6';
const VALID_STATUS = ['planned', 'briefed', 'drafted', 'published', 'dismissed'];

async function loadClient(clientId) {
  const { rows } = await pool.query(
    'SELECT name, briefing_field, domain FROM clients WHERE id = $1', [clientId]
  );
  if (!rows.length) throw new Error('Client not found');
  return rows[0];
}

// Grow a seed into a keyword universe. Grounds the expansion in the client's
// brief and their existing tracked keywords, so it reflects the real business,
// not just the model's guess.
async function expandSeed({ clientId, seed }) {
  const s = String(seed || '').trim();
  if (!s) throw new Error('seed required');
  const client = await loadClient(clientId);

  const { rows: kwRows } = await pool.query(
    `SELECT keyword FROM seo_keywords WHERE client_id = $1 AND active = true ORDER BY keyword ASC LIMIT 80`,
    [clientId]
  );
  const existing = kwRows.map(r => r.keyword).filter(Boolean);

  const raw = await claudeService.callClaude({
    model: MODEL,
    max_tokens: 2000,
    system: 'You expand a seed topic into a keyword universe for a content strategy. Cover the whole topic the way a searcher explores it — subtopics, the questions people ask, comparisons and alternatives, buying/commercial terms, and long-tail variations. British English. Return one keyword or question per line, plain text, no numbering, no commentary.',
    user: `Client: ${client.name}
About: ${client.briefing_field || '(no briefing — infer from the seed and existing keywords)'}
Domain: ${client.domain || '(none)'}

Seed topic: "${s}"
${existing.length ? `\nThe client already tracks these keywords — use them as grounding for what the business actually cares about, and expand AROUND them (don't just repeat them):\n${existing.slice(0, 60).map(k => `- ${k}`).join('\n')}` : ''}

Produce 40–60 keywords and questions that map the whole topic around the seed. Include a healthy mix of: head terms, long-tail, question phrases (what/how/why/which/best), comparison/alternative terms, and commercial/buying terms. One per line.`,
  });
  const universe = raw.split(/\n+/)
    .map(x => x.trim().replace(/^[-*\d.\s]+/, '').replace(/^["']|["']$/g, '').trim())
    .filter(x => x.length > 2 && x.length < 120)
    .filter(x => !x.startsWith('#'));
  // De-dupe (case-insensitive) and cap at the clusterer's limit.
  const seen = new Set(); const out = [];
  for (const k of universe) { const key = k.toLowerCase(); if (!seen.has(key)) { seen.add(key); out.push(k); } }
  return out.slice(0, 180);
}

// Full flow: expand → cluster → persist. Returns the saved map with clusters.
async function generateMap({ clientId, seed, name, createdBy = null }) {
  const universe = await expandSeed({ clientId, seed });
  if (universe.length < 2) throw new Error('Could not expand that seed into enough keywords — try a broader theme.');
  const { clusters } = await keywordClusters.clusterKeywords({ clientId, keywords: universe });
  if (!clusters.length) throw new Error('No clusters came back — try a different seed.');

  const mapName = String(name || '').trim() || `${seed} — topic map`;
  const { rows: mapRows } = await pool.query(
    `INSERT INTO content_topic_maps (client_id, name, seed, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
    [clientId, mapName.slice(0, 160), String(seed).slice(0, 240), createdBy]
  );
  const map = mapRows[0];

  let position = 0;
  for (const c of clusters) {
    await pool.query(
      `INSERT INTO content_topic_clusters
         (map_id, client_id, label, core_question, primary_keyword, secondary, intent, rationale, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [map.id, clientId, c.label, c.core_question || null, c.primary,
       JSON.stringify(c.secondary || []), c.intent || 'informational', c.rationale || null, position++]
    );
  }
  return getMap(map.id);
}

async function listMaps(clientId) {
  const { rows } = await pool.query(
    `SELECT m.*,
            COUNT(c.id)::int AS cluster_count,
            COUNT(c.id) FILTER (WHERE c.status = 'published')::int AS published_count,
            COUNT(c.id) FILTER (WHERE c.status IN ('drafted','published'))::int AS in_progress_count
       FROM content_topic_maps m
       LEFT JOIN content_topic_clusters c ON c.map_id = m.id
      WHERE m.client_id = $1
      GROUP BY m.id
      ORDER BY m.created_at DESC`,
    [clientId]
  );
  return rows;
}

async function getMap(mapId) {
  const { rows: mapRows } = await pool.query('SELECT * FROM content_topic_maps WHERE id = $1', [mapId]);
  if (!mapRows.length) return null;
  const { rows: clusters } = await pool.query(
    `SELECT id, label, core_question, primary_keyword, secondary, intent, rationale, status, content_draft_id,
            (brief_json IS NOT NULL) AS has_brief, position
       FROM content_topic_clusters WHERE map_id = $1 ORDER BY position ASC`,
    [mapId]
  );
  return { ...mapRows[0], clusters };
}

async function deleteMap(mapId) {
  await pool.query('DELETE FROM content_topic_maps WHERE id = $1', [mapId]);
}

async function loadCluster(clusterId) {
  const { rows } = await pool.query('SELECT * FROM content_topic_clusters WHERE id = $1', [clusterId]);
  return rows[0] || null;
}

async function updateClusterStatus(clusterId, status) {
  if (!VALID_STATUS.includes(status)) throw new Error('invalid status');
  const { rows } = await pool.query(
    `UPDATE content_topic_clusters SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, clusterId]
  );
  return rows[0] || null;
}

// Generate (and persist) a GEO brief for one cluster in the map — reuses the
// same briefForCluster used by the ad-hoc cluster flow, so the brief is
// identical in quality; the map just remembers it and advances the status.
async function briefCluster(clusterId) {
  const c = await loadCluster(clusterId);
  if (!c) throw new Error('Cluster not found');
  const brief = await keywordClusters.briefForCluster({
    clientId: c.client_id,
    cluster: {
      label: c.label, core_question: c.core_question, primary: c.primary_keyword,
      secondary: Array.isArray(c.secondary) ? c.secondary : [], intent: c.intent, rationale: c.rationale,
    },
  });
  await pool.query(
    `UPDATE content_topic_clusters SET brief_json = $1,
        status = CASE WHEN status = 'planned' THEN 'briefed' ELSE status END, updated_at = NOW()
      WHERE id = $2`,
    [brief, clusterId]
  );
  return brief;
}

module.exports = {
  expandSeed, generateMap, listMaps, getMap, deleteMap,
  updateClusterStatus, briefCluster, loadCluster, VALID_STATUS,
};
