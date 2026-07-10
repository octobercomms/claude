// Visualise studio — orchestration/data layer. Phase 1 (foundations) covers
// presets + projects; generation, the correction loop, lock and 4K export land
// in later phases and will call connectors/fal.js from here.
//
// See docs/omi/visualise-studio.md. Storage of image/mask files mirrors
// brandAssets (local disk per client, served via an authed route) and is added
// with the Generate phase.

const pool = require('../db');

// Presets a client can pick: the shared library + any client-specific ones.
async function listPresets(clientId) {
  const { rows } = await pool.query(
    `SELECT id, scope, client_id, name, guided_fields, input_slots, model_routing, created_at
       FROM visualise_presets
      WHERE scope = 'shared' OR client_id = $1
      ORDER BY (scope = 'shared') DESC, name ASC`,
    [clientId]
  );
  return rows;
}

async function getPreset(id) {
  const { rows } = await pool.query('SELECT * FROM visualise_presets WHERE id = $1', [id]);
  return rows[0] || null;
}

// Project cards for a client's library (D15): thumbnail comes from the newest
// step image; counts summarise the tree.
async function listProjects(clientId) {
  const { rows } = await pool.query(
    `SELECT p.*, pr.name AS preset_name,
            (SELECT COUNT(*)::int FROM visualise_variants v WHERE v.project_id = p.id) AS variant_count,
            (SELECT s.image_url FROM visualise_variants v
               JOIN visualise_steps s ON s.variant_id = v.id AND s.image_url IS NOT NULL
              WHERE v.project_id = p.id
              ORDER BY s.created_at DESC LIMIT 1) AS thumb_url,
            u.username AS created_by_name
       FROM visualise_projects p
       LEFT JOIN visualise_presets pr ON pr.id = p.preset_id
       LEFT JOIN users u ON u.id = p.created_by
      WHERE p.client_id = $1
      ORDER BY p.updated_at DESC
      LIMIT 300`,
    [clientId]
  );
  return rows;
}

async function createProject(clientId, { name, preset_id = null, guided_values = {}, created_by = null }) {
  const clean = String(name || '').trim();
  if (!clean) { const e = new Error('Project name required'); e.status = 400; throw e; }
  const { rows } = await pool.query(
    `INSERT INTO visualise_projects (client_id, preset_id, name, guided_values, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [clientId, preset_id, clean, JSON.stringify(guided_values || {}), created_by]
  );
  return rows[0];
}

// A project's full editable state (D8/D13): inputs + variants + each variant's
// step tree. Returns null if not found (caller maps to 404 + access check).
async function getProject(projectId) {
  const { rows } = await pool.query('SELECT * FROM visualise_projects WHERE id = $1', [projectId]);
  const project = rows[0];
  if (!project) return null;
  const [inputs, variants] = await Promise.all([
    pool.query('SELECT * FROM visualise_inputs WHERE project_id = $1 ORDER BY created_at ASC', [projectId]),
    pool.query('SELECT * FROM visualise_variants WHERE project_id = $1 ORDER BY created_at ASC', [projectId]),
  ]);
  const variantIds = variants.rows.map(v => v.id);
  let steps = { rows: [] };
  if (variantIds.length) {
    steps = await pool.query('SELECT * FROM visualise_steps WHERE variant_id = ANY($1) ORDER BY created_at ASC', [variantIds]);
  }
  const byVariant = {};
  for (const s of steps.rows) (byVariant[s.variant_id] ||= []).push(s);
  return {
    ...project,
    inputs: inputs.rows,
    variants: variants.rows.map(v => ({ ...v, steps: byVariant[v.id] || [] })),
  };
}

async function deleteProject(projectId) {
  await pool.query('DELETE FROM visualise_projects WHERE id = $1', [projectId]);
}

module.exports = { listPresets, getPreset, listProjects, createProject, getProject, deleteProject };
