// Visualise studio routes.
//   Phase 1: presets + projects.
//   Phase 2 (this): inputs (upload + authed serve), guided-value updates,
//                   generation, pick-active, cost estimate.
//
// Access chain (§6/§15): authenticate → requireVisualise (module gate) →
// loadVisibleClientIds → requireClientAccess / assertClientAccess. Client-role
// write access is the scoped can_use_visualise carve-out (middleware/auth.js).

const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, assertClientAccess } = require('../middleware/clientAccess');
const visualise = require('../services/visualise');

const router = express.Router();

const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

// Module gate: agency/admin always; a read-only 'client' only when granted
// can_use_visualise (§6). Anyone else can't see the module at all.
function requireVisualise(req, res, next) {
  if (req.user?.role !== 'client' || req.user?.can_use_visualise) return next();
  return res.status(403).json({ error: 'Visualise is not enabled for your account.' });
}

router.use(authenticate, requireVisualise, loadVisibleClientIds);

// Load a project + assert the caller can see its client. Returns the project or
// sends the response and returns null.
async function loadProjectScoped(req, res) {
  const project = await visualise.getProject(req.params.projectId);
  if (!project) { res.status(404).json({ error: 'Not found' }); return null; }
  try { assertClientAccess(req, project.client_id); } catch (e) { res.status(403).json({ error: e.message }); return null; }
  return project;
}

// ── Presets ──────────────────────────────────────────────────────────────────
router.get('/clients/:clientId/presets', requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
  try { res.json(await visualise.listPresets(req.params.clientId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Projects ─────────────────────────────────────────────────────────────────
router.get('/clients/:clientId/projects', requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
  try { res.json(await visualise.listProjects(req.params.clientId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/projects', requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
  try {
    const project = await visualise.createProject(req.params.clientId, {
      name: req.body?.name,
      preset_id: req.body?.preset_id || null,
      guided_values: req.body?.guided_values || {},
      created_by: req.user.id,
    });
    res.status(201).json(project);
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

router.get('/projects/:projectId', async (req, res) => {
  const project = await loadProjectScoped(req, res); if (!project) return;
  res.json(project);
});

router.patch('/projects/:projectId', async (req, res) => {
  const project = await loadProjectScoped(req, res); if (!project) return;
  try { res.json(await visualise.updateProject(project.id, req.body || {})); }
  catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

router.delete('/projects/:projectId', async (req, res) => {
  const project = await loadProjectScoped(req, res); if (!project) return;
  try { await visualise.deleteProject(project.id); res.status(204).end(); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Inputs ───────────────────────────────────────────────────────────────────
// Image input (sketch / reference_photo / sketch_view / swatch) — multipart.
router.post('/projects/:projectId/inputs', uploadMem.single('file'), async (req, res) => {
  const project = await loadProjectScoped(req, res); if (!project) return;
  try {
    const kind = String(req.body?.kind || '').trim();
    if (req.body?.text != null && !req.file) {
      // Note input (no file).
      const input = await visualise.addInput(project.id, { kind: 'note', text: String(req.body.text) });
      return res.status(201).json(input);
    }
    if (!req.file) return res.status(400).json({ error: 'file required' });
    if (!kind) return res.status(400).json({ error: 'kind required' });
    const url = visualise.saveInputBuffer(project.client_id, req.file.buffer, req.file.originalname);
    const input = await visualise.addInput(project.id, {
      kind, url, metadata: { size: req.file.size, mimetype: req.file.mimetype, originalname: req.file.originalname },
    });
    res.status(201).json(input);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/inputs/:inputId', async (req, res) => {
  try {
    const input = await visualise.getInput(req.params.inputId);
    if (!input) return res.status(404).json({ error: 'Not found' });
    const project = await visualise.getProject(input.project_id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    assertClientAccess(req, project.client_id);
    await visualise.deleteInput(input.id);
    res.status(204).end();
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Serve an uploaded/generated file. Scoped to the caller's client; traversal
// guarded; nosniff like brandAssets.
router.get('/file/:clientId/:filename', requireClientAccess({ paramNames: ['clientId'] }), (req, res) => {
  const p = visualise.serveFilePath(req.params.clientId, req.params.filename);
  if (!p) return res.status(400).end();
  const fs = require('fs');
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(p);
});

// ── Generate + pick ──────────────────────────────────────────────────────────
router.get('/projects/:projectId/estimate', async (req, res) => {
  const project = await loadProjectScoped(req, res); if (!project) return;
  try {
    const preset = project.preset_id ? await visualise.getPreset(project.preset_id) : null;
    res.json({ cost_usd: visualise.estimate(preset, parseInt(req.query.count, 10) || 1) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/projects/:projectId/generate', async (req, res) => {
  const project = await loadProjectScoped(req, res); if (!project) return;
  try {
    const out = await visualise.generate(project, {
      count: req.body?.count, orientation: req.body?.orientation, userId: req.user.id,
    });
    res.json(out);
  } catch (err) { res.status(err.status || 502).json({ error: err.message }); }
});

// Circle-and-fix (D11/D12): multipart — mask (required PNG), instruction, and an
// optional reference crop. Produces a new correction step and makes it active.
router.post('/variants/:variantId/inpaint', uploadMem.fields([{ name: 'mask', maxCount: 1 }, { name: 'reference', maxCount: 1 }]), async (req, res) => {
  try {
    const variant = await visualise.getVariant(req.params.variantId);
    if (!variant) return res.status(404).json({ error: 'Not found' });
    const project = await visualise.getProject(variant.project_id);
    assertClientAccess(req, project.client_id);
    const step = await visualise.inpaint(project, {
      variantId: variant.id,
      baseStepId: req.body?.base_step_id,
      maskBuffer: req.files?.mask?.[0]?.buffer,
      instruction: req.body?.instruction,
      referenceBuffer: req.files?.reference?.[0]?.buffer || null,
      userId: req.user.id,
    });
    res.json(step);
  } catch (err) { res.status(err.status || 502).json({ error: err.message }); }
});

router.post('/variants/:variantId/active', async (req, res) => {
  try {
    const variant = await visualise.getVariant(req.params.variantId);
    if (!variant) return res.status(404).json({ error: 'Not found' });
    const project = await visualise.getProject(variant.project_id);
    assertClientAccess(req, project.client_id);
    await visualise.setActiveStep(variant.id, req.body?.step_id);
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

module.exports = router;
