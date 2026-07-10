// Visualise studio routes. Phase 1 (foundations): presets + projects, scoped by
// clientAccess, gated by the module capability. Generation / correction / lock /
// export endpoints arrive in later phases (docs/omi/visualise-studio.md §15).
//
// Access chain (per §6/§15): authenticate → requireVisualise (module gate) →
// loadVisibleClientIds → requireClientAccess. Client-role write access is the
// scoped can_use_visualise carve-out enforced in middleware/auth.js.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, assertClientAccess } = require('../middleware/clientAccess');
const visualise = require('../services/visualise');

const router = express.Router();

// Module gate: agency/admin users always; a read-only 'client' only when granted
// can_use_visualise (§6). Anyone else can't see the module at all.
function requireVisualise(req, res, next) {
  if (req.user?.role !== 'client' || req.user?.can_use_visualise) return next();
  return res.status(403).json({ error: 'Visualise is not enabled for your account.' });
}

router.use(authenticate, requireVisualise, loadVisibleClientIds);

// ── Presets ──────────────────────────────────────────────────────────────────
router.get('/clients/:clientId/presets', requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
  try { res.json(await visualise.listPresets(req.params.clientId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Projects (library) ───────────────────────────────────────────────────────
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

// ── A single project (full editable state) ───────────────────────────────────
// Project id carries no client in the URL, so load it, then assert the caller
// can see its client before returning anything.
router.get('/projects/:projectId', async (req, res) => {
  try {
    const project = await visualise.getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Not found' });
    assertClientAccess(req, project.client_id);
    res.json(project);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/projects/:projectId', async (req, res) => {
  try {
    const project = await visualise.getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Not found' });
    assertClientAccess(req, project.client_id);
    await visualise.deleteProject(req.params.projectId);
    res.status(204).end();
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
