// AI Sniper funnel API — /api/funnel. Phase 1 exposes the ICP Intelligence Pack
// (per-client customer-research snapshot). Per-client access-controlled, same
// shape as /api/strategy. Later phases (funnel spine, feedback loop) hang here.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const icp = require('../services/icpIntelligence');

const router = express.Router();
router.use(authenticate);
router.use('/clients/:clientId', loadVisibleClientIds, requireClientAccess({ paramNames: ['clientId'] }));

// Read the current pack (null if never built).
router.get('/clients/:clientId/icp', async (req, res) => {
  try { res.json({ icp: await icp.getPack(req.params.clientId) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Save the AM's raw inputs (transcripts / notes / service description) — no AI
// spend, so it's safe to autosave as they type.
router.put('/clients/:clientId/icp', async (req, res) => {
  try { res.json({ icp: await icp.saveInputs(req.params.clientId, req.body || {}) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Build / rebuild the pack with Claude from the stored inputs + client profile.
router.post('/clients/:clientId/icp/tailor', async (req, res) => {
  try { res.json({ icp: await icp.tailor(req.params.clientId) }); }
  catch (err) { res.status(err.status || 502).json({ error: err.message }); }
});

module.exports = router;
