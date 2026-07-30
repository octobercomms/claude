// Visualise studio — orchestration/data layer.
//   Phase 1: presets + projects.
//   Phase 2 (this): inputs, prompt assembly, generation (fal), pick-active.
// The correction loop, lock and 4K export land in later phases.
//
// Storage mirrors brandAssets: image/mask files on local disk per client
// (uploads/<client_id>/visualise/), served through an authed route; rows hold
// the served URL. Generated images are downloaded from fal and stored locally
// (fal URLs are ephemeral). See docs/omi/visualise-studio.md.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pool = require('../db');
const fal = require('../connectors/fal');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');

// ── fal model pricing (USD per image) ─────────────────────────────────────────
// Used for the pre-action estimate (D6) and to log spend after. These are
// working estimates — confirm real per-call prices in the §11 bake-off and
// update here; the figure is shown to users as an estimate.
const FAL_PRICES = {
  'fal-ai/nano-banana-pro': 0.15,
  'fal-ai/nano-banana-2/edit': 0.05,
  'fal-ai/flux-pro/v1/fill': 0.05,
  'fal-ai/clarity-upscaler': 0.03,
};
function priceFor(slug) { return FAL_PRICES[slug] != null ? FAL_PRICES[slug] : 0.10; }

// Orientation → aspect ratio passed to the generate model.
const ORIENTATION_AR = { portrait: '3:4', landscape: '4:3', square: '1:1' };

// ── Storage helpers ───────────────────────────────────────────────────────────
function clientDir(clientId) {
  const dir = path.join(UPLOAD_ROOT, clientId, 'visualise');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function servedUrl(clientId, filename) {
  return `/api/visualise/file/${clientId}/${filename}`;
}
function randName(ext = '.png') {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}
// Resolve a served visualise URL back to its on-disk path (for reading a file to
// pass to fal as a data URI). Returns null if the URL isn't one of ours.
function diskPathForUrl(url) {
  const m = String(url || '').match(/^\/api\/visualise\/file\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  const p = path.join(UPLOAD_ROOT, m[1], 'visualise', m[2]);
  if (!p.startsWith(path.join(UPLOAD_ROOT, m[1], 'visualise') + path.sep)) return null;
  return p;
}
function fileToDataUri(diskPath) {
  const ext = (path.extname(diskPath).slice(1) || 'png').toLowerCase();
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mime};base64,${fs.readFileSync(diskPath).toString('base64')}`;
}
// Save an uploaded input buffer to the client's visualise dir; return its URL.
function saveInputBuffer(clientId, buffer, originalname) {
  let ext = (path.extname(originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '')) || '.png';
  if (!ext.startsWith('.')) ext = '.' + ext;
  const filename = randName(ext);
  fs.writeFileSync(path.join(clientDir(clientId), filename), buffer);
  return servedUrl(clientId, filename);
}
// Resolve a served-file request to an on-disk path, with a traversal guard.
function serveFilePath(clientId, filename) {
  if (!filename || filename.includes('..') || filename.includes('/')) return null;
  const dir = clientDir(clientId);
  const p = path.join(dir, filename);
  return p.startsWith(dir + path.sep) ? p : null;
}
// Download a remote (fal) image to local disk; return its served URL.
async function saveRemoteImage(clientId, url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000, maxContentLength: 40 * 1024 * 1024 });
  const ct = res.headers['content-type'] || '';
  const ext = ct.includes('jpeg') ? '.jpg' : ct.includes('webp') ? '.webp' : '.png';
  const filename = randName(ext);
  fs.writeFileSync(path.join(clientDir(clientId), filename), Buffer.from(res.data));
  return servedUrl(clientId, filename);
}

// ── Prompt assembly (§10.1) ───────────────────────────────────────────────────
// locked core + the user's guided-field answers + the preset's always-on floor,
// deduped so a toggle that repeats an always-on line doesn't double it. No raw
// prompt is ever accepted from the user (D8).
function buildPrompt(preset, guided = {}) {
  const base = String(preset.locked_core_prompt || '').trim();
  const fields = Array.isArray(preset.guided_fields) ? preset.guided_fields : [];
  const additions = [];
  for (const f of fields) {
    const v = guided[f.key];
    if (f.type === 'text') {
      if (v && String(v).trim()) additions.push(String(v).trim());   // inject verbatim as a line
    } else if (f.type === 'toggle') {
      const on = v == null ? !!f.default : !!v;
      if (on && f.emits) additions.push(String(f.emits).trim());
    }
  }
  // Always-on floor — appended to every generation for this preset.
  for (const line of String(preset.always_on_prompt || '').split('\n').map(s => s.trim()).filter(Boolean)) {
    additions.push(line);
  }
  // Dedupe additions case-insensitively and ignoring trailing punctuation, so
  // a toggle emit ("…branding") and its always-on twin ("…branding.") collapse.
  const seen = new Set();
  const deduped = additions.filter(l => {
    const k = l.toLowerCase().replace(/[.\s]+$/, '');
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  return deduped.length ? `${base}\n\n${deduped.join('\n')}` : base;
}

// ── Presets ───────────────────────────────────────────────────────────────────
async function listPresets(clientId) {
  const { rows } = await pool.query(
    `SELECT id, scope, client_id, name, guided_fields, input_slots, model_routing, created_at
       FROM visualise_presets
      WHERE scope = 'shared' OR client_id = $1
      ORDER BY (scope = 'shared') DESC, name ASC`,
    [clientId]
  );
  // Attach per-image prices so the UI can show cost before each action.
  return rows.map(p => ({
    ...p,
    price_per_image: priceFor(p.model_routing?.generate),
    price_inpaint: priceFor(p.model_routing?.inpaint),
  }));
}

async function getPreset(id) {
  const { rows } = await pool.query('SELECT * FROM visualise_presets WHERE id = $1', [id]);
  return rows[0] || null;
}

// ── Projects ──────────────────────────────────────────────────────────────────
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

async function updateProject(projectId, fields = {}) {
  const sets = [], vals = [];
  if ('name' in fields && String(fields.name).trim()) { vals.push(String(fields.name).trim()); sets.push(`name = $${vals.length}`); }
  if ('guided_values' in fields) { vals.push(JSON.stringify(fields.guided_values || {})); sets.push(`guided_values = $${vals.length}`); }
  if ('status' in fields) { vals.push(fields.status); sets.push(`status = $${vals.length}`); }
  if (!sets.length) return getProject(projectId);
  vals.push(projectId);
  await pool.query(`UPDATE visualise_projects SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`, vals);
  return getProject(projectId);
}

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
  let exports = { rows: [] };
  if (variantIds.length) {
    exports = await pool.query('SELECT * FROM visualise_exports WHERE variant_id = ANY($1) ORDER BY created_at DESC', [variantIds]);
  }
  const byVariant = {}, exByVariant = {};
  for (const s of steps.rows) (byVariant[s.variant_id] ||= []).push(s);
  for (const e of exports.rows) (exByVariant[e.variant_id] ||= []).push(e);
  const spend = [...steps.rows, ...exports.rows].reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0);
  return {
    ...project,
    inputs: inputs.rows,
    variants: variants.rows.map(v => ({ ...v, steps: byVariant[v.id] || [], exports: exByVariant[v.id] || [] })),
    spend_usd: +spend.toFixed(4),
  };
}

async function deleteProject(projectId) {
  await pool.query('DELETE FROM visualise_projects WHERE id = $1', [projectId]);
}

// ── Inputs ────────────────────────────────────────────────────────────────────
async function addInput(projectId, { kind, url = null, text = null, metadata = {} }) {
  const { rows } = await pool.query(
    `INSERT INTO visualise_inputs (project_id, kind, url, text, metadata)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [projectId, kind, url, text, JSON.stringify(metadata || {})]
  );
  return rows[0];
}
async function getInput(inputId) {
  const { rows } = await pool.query('SELECT * FROM visualise_inputs WHERE id = $1', [inputId]);
  return rows[0] || null;
}
async function deleteInput(inputId) {
  const { rows } = await pool.query('DELETE FROM visualise_inputs WHERE id = $1 RETURNING url', [inputId]);
  const url = rows[0]?.url;
  const disk = url && diskPathForUrl(url);
  if (disk) fs.promises.unlink(disk).catch(() => {});
}

// The reference images (as data URIs) a generation should condition on: every
// image input on the project (sketches, reference photos, sketch views, swatches).
function referenceDataUris(inputs) {
  return (inputs || [])
    .filter(i => i.url)
    .map(i => diskPathForUrl(i.url))
    .filter(p => p && fs.existsSync(p))
    .map(fileToDataUri);
}

// ── Generation (D9) ───────────────────────────────────────────────────────────
async function ensureBaseVariant(projectId, userId) {
  const { rows } = await pool.query(
    `SELECT * FROM visualise_variants WHERE project_id = $1 AND scene_prompt IS NULL ORDER BY created_at ASC LIMIT 1`,
    [projectId]
  );
  if (rows[0]) return rows[0];
  const ins = await pool.query(
    `INSERT INTO visualise_variants (project_id, name, created_by) VALUES ($1, 'Base', $2) RETURNING *`,
    [projectId, userId]
  );
  return ins.rows[0];
}

function estimate(preset, count) {
  return +(priceFor(preset?.model_routing?.generate) * Math.max(1, count)).toFixed(4);
}

// Generate `count` images for a project's base variant. Returns the new steps.
async function generate(project, { count = 4, orientation = 'portrait', userId = null }) {
  const n = Math.min(8, Math.max(1, parseInt(count, 10) || 1));
  const preset = project.preset_id ? await getPreset(project.preset_id) : null;
  if (!preset) { const e = new Error('This project has no preset — pick one first.'); e.status = 400; throw e; }

  const model = preset.model_routing?.generate;
  if (!model) { const e = new Error('Preset has no generate model configured.'); e.status = 400; throw e; }

  const prompt = buildPrompt(preset, project.guided_values || {});
  const refs = referenceDataUris(project.inputs);
  const aspect = ORIENTATION_AR[orientation] || ORIENTATION_AR.portrait;

  // One call requesting `n` images (fal image models return an array); the
  // input field names are finalised in the §11 bake-off — this is the common
  // reference-edit shape.
  const input = { prompt, num_images: n, aspect_ratio: aspect };
  if (refs.length) input.image_urls = refs;

  const perImage = priceFor(model);
  const result = await fal.generate(model, input, { clientId: project.client_id, costUsd: null });
  let urls = result.urls && result.urls.length ? result.urls : (result.url ? [result.url] : []);
  // If the model returned a single image but we asked for more, top up by
  // calling again (independent variations) until we have n (bounded).
  let guard = 0;
  while (urls.length < n && guard < n) {
    guard++;
    const more = await fal.generate(model, input, { clientId: project.client_id, costUsd: null });
    if (more.url) urls.push(more.url);
    else break;
  }
  if (!urls.length) { const e = new Error('The model returned no image.'); e.status = 502; throw e; }
  urls = urls.slice(0, n);

  const variant = await ensureBaseVariant(project.id, userId);
  const steps = [];
  for (let i = 0; i < urls.length; i++) {
    const stored = await saveRemoteImage(project.client_id, urls[i]);
    const { rows } = await pool.query(
      `INSERT INTO visualise_steps (variant_id, kind, image_url, gen_params, cost_usd, created_by)
         VALUES ($1, 'generation', $2, $3, $4, $5) RETURNING *`,
      [variant.id, stored, JSON.stringify({ index: i, orientation, model, aspect }), perImage, userId]
    );
    steps.push(rows[0]);
  }

  // Log the real spend (per image actually produced) and move the project on.
  require('./costLog').recordApiCost({
    provider: 'fal', feature: 'visualise_generate',
    costUsd: +(perImage * steps.length).toFixed(4), clientId: project.client_id,
    meta: { model, count: steps.length, project_id: project.id },
  });
  await pool.query(`UPDATE visualise_projects SET status = 'in_progress', updated_at = NOW() WHERE id = $1 AND status = 'draft'`, [project.id]);

  return { variant_id: variant.id, steps };
}

// Append a preset's always-on floor to a prompt, deduped (same rule as buildPrompt).
function withAlwaysOn(preset, prompt) {
  const lines = String(preset?.always_on_prompt || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) return prompt;
  const have = new Set(prompt.toLowerCase().split('\n').map(s => s.trim().replace(/[.\s]+$/, '')));
  const extra = lines.filter(l => !have.has(l.toLowerCase().replace(/[.\s]+$/, '')));
  return extra.length ? `${prompt}\n${extra.join('\n')}` : prompt;
}

// ── Scenarios (D10) ───────────────────────────────────────────────────────────
// A new Variant that places the chosen character/base into a free-text scene.
// Seeded from the base variant's active image (so the character carries through)
// + the preset's scenario_template with [SCENE] filled; brand constraints are
// always appended, never shown as editable.
async function createScenario(project, { scene, count = 2, orientation = 'portrait', userId = null }) {
  const s = String(scene || '').trim();
  if (!s) { const e = new Error('Describe the scene.'); e.status = 400; throw e; }
  const preset = project.preset_id ? await getPreset(project.preset_id) : null;
  const model = preset?.model_routing?.scenario || preset?.model_routing?.generate;
  if (!model) { const e = new Error('Preset has no scenario/generate model.'); e.status = 400; throw e; }

  // Reference = the base variant's active (or latest) image — the character.
  const base = (project.variants || []).find(v => !v.scene_prompt) || project.variants?.[0];
  const baseStep = base && ((base.steps || []).find(x => x.id === base.active_step_id) || (base.steps || [])[base.steps.length - 1]);
  const refs = [];
  if (baseStep?.image_url) { const p = diskPathForUrl(baseStep.image_url); if (p && fs.existsSync(p)) refs.push(fileToDataUri(p)); }
  if (!refs.length) { const e = new Error('Generate and pick a base character first — scenarios build on it.'); e.status = 400; throw e; }

  const tmpl = preset.scenario_template || 'Create another image of this character in a different scene. This person works at [SCENE].';
  const prompt = withAlwaysOn(preset, tmpl.replace(/\[SCENE\]/g, s));
  const n = Math.min(8, Math.max(1, parseInt(count, 10) || 2));
  const aspect = ORIENTATION_AR[orientation] || ORIENTATION_AR.portrait;
  const perImage = priceFor(model);

  const vIns = await pool.query(
    `INSERT INTO visualise_variants (project_id, name, scene_prompt, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
    [project.id, s.slice(0, 160), s, userId]
  );
  const variant = vIns.rows[0];

  const input = { prompt, num_images: n, aspect_ratio: aspect, image_urls: refs };
  const result = await fal.generate(model, input, { clientId: project.client_id, costUsd: null });
  let urls = result.urls?.length ? result.urls : (result.url ? [result.url] : []);
  let guard = 0;
  while (urls.length < n && guard < n) { guard++; const more = await fal.generate(model, input, { clientId: project.client_id, costUsd: null }); if (more.url) urls.push(more.url); else break; }
  urls = urls.slice(0, n);
  if (!urls.length) { const e = new Error('The model returned no image for that scene.'); e.status = 502; throw e; }

  const steps = [];
  for (let i = 0; i < urls.length; i++) {
    const stored = await saveRemoteImage(project.client_id, urls[i]);
    const { rows } = await pool.query(
      `INSERT INTO visualise_steps (variant_id, kind, image_url, gen_params, cost_usd, created_by)
         VALUES ($1, 'generation', $2, $3, $4, $5) RETURNING *`,
      [variant.id, stored, JSON.stringify({ index: i, orientation, model, aspect, scene: s }), perImage, userId]
    );
    steps.push(rows[0]);
  }
  await pool.query('UPDATE visualise_variants SET active_step_id = $1 WHERE id = $2', [steps[0].id, variant.id]);
  await pool.query(`UPDATE visualise_projects SET updated_at = NOW() WHERE id = $1`, [project.id]);
  require('./costLog').recordApiCost({ provider: 'fal', feature: 'visualise_scenario', costUsd: +(perImage * steps.length).toFixed(4), clientId: project.client_id, meta: { model, variant_id: variant.id } });
  return { variant_id: variant.id, steps };
}

// ── Correction loop (D11/D12 — the crown jewel) ───────────────────────────────
async function getStep(id) {
  const { rows } = await pool.query('SELECT * FROM visualise_steps WHERE id = $1', [id]);
  return rows[0] || null;
}

async function fetchRemoteBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000, maxContentLength: 40 * 1024 * 1024 });
  return Buffer.from(res.data);
}

// D12: paste the model's edit back over the original ONLY inside the mask, with a
// soft (feathered) edge so there's no seam — guaranteeing every pixel outside the
// circled area is identical to the source, whatever the inpaint model did globally.
async function compositeMaskedEdit(originalPath, editedBuf, maskBuf) {
  const Jimp = (await import('jimp')).Jimp;   // jimp v1 is ESM-only
  const [orig, edited, mask] = await Promise.all([Jimp.read(originalPath), Jimp.read(editedBuf), Jimp.read(maskBuf)]);
  const w = orig.bitmap.width, h = orig.bitmap.height;
  edited.resize({ w, h });
  mask.resize({ w, h }).greyscale().blur(3);   // feather the mask edge
  edited.mask(mask, 0, 0);                      // alpha from mask brightness: white→edited, black→transparent
  const composed = orig.clone().composite(edited, 0, 0);
  return composed.getBuffer('image/png');
}

// Circle-and-fix: regenerate ONLY the masked region of a base step, store the
// composited result as a new child Step (parent = base), and make it active.
// Reverting/branching is just moving the active pointer (setActiveStep) — steps
// are immutable and tree-shaped, so nothing is ever lost (D13/D17).
async function inpaint(project, { variantId, baseStepId, maskBuffer, instruction, referenceBuffer = null, userId = null }) {
  const instr = String(instruction || '').trim();
  if (!instr) { const e = new Error('An instruction is required — say what should change.'); e.status = 400; throw e; }
  if (!maskBuffer || !maskBuffer.length) { const e = new Error('Circle the area to change first.'); e.status = 400; throw e; }

  const preset = project.preset_id ? await getPreset(project.preset_id) : null;
  const model = preset?.model_routing?.inpaint;
  if (!model) { const e = new Error('This preset has no inpaint model configured.'); e.status = 400; throw e; }

  const base = await getStep(baseStepId);
  if (!base || base.variant_id !== variantId) { const e = new Error('Base image not found on this variant.'); e.status = 404; throw e; }
  const origPath = diskPathForUrl(base.image_url);
  if (!origPath || !fs.existsSync(origPath)) { const e = new Error('Base image is missing on disk.'); e.status = 409; throw e; }

  // Persist the mask + optional reference crop for provenance / reopenability.
  const maskUrl = saveInputBuffer(project.client_id, maskBuffer, 'mask.png');
  const refUrl = referenceBuffer ? saveInputBuffer(project.client_id, referenceBuffer, 'ref.png') : null;

  // Masked inpaint via fal (white mask = the region to change). Field names are
  // the common Flux-Fill shape; finalised in the §11 bake-off. NB the reference
  // crop is stored but not yet fed to the model (its input field is confirmed in
  // the bake-off) — the region-locked fix works without it.
  const input = {
    image_url: fileToDataUri(origPath),
    mask_url: `data:image/png;base64,${maskBuffer.toString('base64')}`,
    prompt: instr,
  };
  const perImage = priceFor(model);
  const result = await fal.inpaint(model, input, { clientId: project.client_id, costUsd: null });
  if (!result.url) { const e = new Error('The edit model returned no image.'); e.status = 502; throw e; }

  const editedBuf = await fetchRemoteBuffer(result.url);
  const composed = await compositeMaskedEdit(origPath, editedBuf, maskBuffer);   // D12 region-lock
  const storedUrl = saveInputBuffer(project.client_id, composed, 'edit.png');

  const { rows } = await pool.query(
    `INSERT INTO visualise_steps (variant_id, parent_step_id, kind, image_url, mask_url, instruction, reference_crop_url, cost_usd, created_by)
       VALUES ($1, $2, 'correction', $3, $4, $5, $6, $7, $8) RETURNING *`,
    [variantId, baseStepId, storedUrl, maskUrl, instr, refUrl, perImage, userId]
  );
  await pool.query('UPDATE visualise_variants SET active_step_id = $1 WHERE id = $2', [rows[0].id, variantId]);
  await pool.query(`UPDATE visualise_projects SET updated_at = NOW() WHERE id = $1`, [project.id]);
  require('./costLog').recordApiCost({
    provider: 'fal', feature: 'visualise_inpaint', costUsd: perImage, clientId: project.client_id,
    meta: { model, step_id: rows[0].id },
  });
  return rows[0];
}

// Carry a chosen generation forward (D3: pick one variation as the active step).
async function setActiveStep(variantId, stepId) {
  // Ensure the step belongs to the variant.
  const { rows } = await pool.query('SELECT id FROM visualise_steps WHERE id = $1 AND variant_id = $2', [stepId, variantId]);
  if (!rows[0]) { const e = new Error('Step not found on this variant'); e.status = 404; throw e; }
  await pool.query('UPDATE visualise_variants SET active_step_id = $1 WHERE id = $2', [stepId, variantId]);
}

async function getVariant(variantId) {
  const { rows } = await pool.query('SELECT * FROM visualise_variants WHERE id = $1', [variantId]);
  return rows[0] || null;
}

// ── Lock + faithful 4K export (D14) ───────────────────────────────────────────
async function lockStep(variantId, stepId) {
  const { rows } = await pool.query('SELECT id FROM visualise_steps WHERE id = $1 AND variant_id = $2', [stepId, variantId]);
  if (!rows[0]) { const e = new Error('Step not found on this variant'); e.status = 404; throw e; }
  await pool.query('UPDATE visualise_variants SET locked_step_id = $1 WHERE id = $2', [stepId, variantId]);
}
async function unlockVariant(variantId) {
  await pool.query('UPDATE visualise_variants SET locked_step_id = NULL WHERE id = $1', [variantId]);
}

// Upscale the locked step to 4K with the preset's FAITHFUL upscaler (no
// re-render — D14/§19). Records the export + its cost.
async function exportVariant(project, variantId, userId) {
  const variant = await getVariant(variantId);
  if (!variant || variant.project_id !== project.id) { const e = new Error('Variant not found'); e.status = 404; throw e; }
  if (!variant.locked_step_id) { const e = new Error('Lock an image on this variant before exporting.'); e.status = 400; throw e; }
  const step = await getStep(variant.locked_step_id);
  const src = step && diskPathForUrl(step.image_url);
  if (!src || !fs.existsSync(src)) { const e = new Error('Locked image is missing on disk.'); e.status = 409; throw e; }

  const preset = project.preset_id ? await getPreset(project.preset_id) : null;
  const model = preset?.model_routing?.upscale;
  if (!model) { const e = new Error('This preset has no upscale model configured.'); e.status = 400; throw e; }

  const price = priceFor(model);
  // Faithful upscale: sharpen without inventing detail. Extra faithfulness knobs
  // (e.g. low creativity) are set per-model in the §11 bake-off.
  const result = await fal.upscale(model, { image_url: fileToDataUri(src) }, { clientId: project.client_id, costUsd: null });
  if (!result.url) { const e = new Error('The upscaler returned no image.'); e.status = 502; throw e; }
  const stored = await saveRemoteImage(project.client_id, result.url);

  const { rows } = await pool.query(
    `INSERT INTO visualise_exports (variant_id, step_id, image_url_4k, cost_usd, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [variantId, variant.locked_step_id, stored, price, userId]
  );
  await pool.query(`UPDATE visualise_projects SET status = 'locked', updated_at = NOW() WHERE id = $1`, [project.id]);
  require('./costLog').recordApiCost({ provider: 'fal', feature: 'visualise_upscale', costUsd: price, clientId: project.client_id, meta: { model, variant_id: variantId } });
  return rows[0];
}

// Export every locked variant in one go (D14 batch). Skips failures.
async function exportAll(project, userId) {
  const { rows } = await pool.query('SELECT id FROM visualise_variants WHERE project_id = $1 AND locked_step_id IS NOT NULL', [project.id]);
  const out = [];
  for (const r of rows) {
    try { out.push(await exportVariant(project, r.id, userId)); } catch { /* skip, keep going */ }
  }
  return out;
}

module.exports = {
  listPresets, getPreset,
  listProjects, createProject, updateProject, getProject, deleteProject,
  addInput, getInput, deleteInput,
  generate, createScenario, setActiveStep, getVariant, getStep, inpaint, estimate,
  lockStep, unlockVariant, exportVariant, exportAll,
  saveInputBuffer, serveFilePath,
  buildPrompt, priceFor,      // exported for tests
  UPLOAD_ROOT, diskPathForUrl,
};
