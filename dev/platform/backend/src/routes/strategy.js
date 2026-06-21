// Client strategy playbooks API — /api/strategy. The template library + meta
// is readable by any authed user; per-client assignment / checklist / tailoring
// is access-controlled per client. See services/strategyTemplates.js.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, requireAdmin } = require('../middleware/clientAccess');
const strategy = require('../services/strategyTemplates');

const router = express.Router();
router.use(authenticate);

router.get('/meta', (req, res) => {
  res.json({ business_types: strategy.BUSINESS_TYPES, lifecycle_stages: strategy.LIFECYCLE_STAGES });
});

router.get('/templates', async (req, res) => {
  try { res.json({ templates: await strategy.listTemplates() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Template library editor — admin only.
router.post('/templates', requireAdmin, async (req, res) => {
  try { res.status(201).json({ template: await strategy.createTemplate(req.body || {}) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.put('/templates/:id', requireAdmin, async (req, res) => {
  try { res.json({ template: await strategy.updateTemplate(req.params.id, req.body || {}) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.delete('/templates/:id', requireAdmin, async (req, res) => {
  try { await strategy.deleteTemplate(req.params.id); res.status(204).end(); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Per-client — access-controlled.
router.use('/clients/:clientId', loadVisibleClientIds, requireClientAccess({ paramNames: ['clientId'] }));

router.get('/clients/:clientId/strategy', async (req, res) => {
  try { res.json({ strategy: await strategy.getClientStrategy(req.params.clientId) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.put('/clients/:clientId/strategy', async (req, res) => {
  try {
    const { template_id, business_type, lifecycle_stage } = req.body || {};
    res.json({ strategy: await strategy.assignToClient(req.params.clientId, { templateId: template_id, businessType: business_type, lifecycleStage: lifecycle_stage }) });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.patch('/clients/:clientId/strategy/items/:itemId', async (req, res) => {
  try { res.json({ strategy: await strategy.setItem(req.params.clientId, req.params.itemId, req.body || {}) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/clients/:clientId/strategy/tailor', async (req, res) => {
  try { res.json({ strategy: await strategy.tailorWithClaude(req.params.clientId) }); }
  catch (err) { res.status(err.status || 502).json({ error: err.message }); }
});

module.exports = router;
