// Microsoft Clarity CRO API — /api/clarity. Per-client token config + on-demand
// AI CRO report from the Clarity behaviour signals. Standard authenticated
// per-tenant pattern. See services/clarity.js.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const clarity = require('../services/clarity');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

router.get('/clients/:clientId/config', async (req, res) => {
  try { res.json(await clarity.getConfig(req.params.clientId)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/clients/:clientId/config', async (req, res) => {
  try { res.json(await clarity.setToken(req.params.clientId, req.body?.token)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/clients/:clientId/config', async (req, res) => {
  try { await clarity.clearToken(req.params.clientId); res.status(204).end(); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.get('/clients/:clientId/report', async (req, res) => {
  try { res.json({ report: await clarity.latestReport(req.params.clientId) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/clients/:clientId/report/run', async (req, res) => {
  try { res.status(201).json({ report: await clarity.runReport(req.params.clientId) }); }
  catch (err) { res.status(err.status || 502).json({ error: err.message }); }
});

// Mark one finding done / not-done. Persists team-wide so the action list is
// a shared checklist, not per-browser state.
router.patch('/clients/:clientId/report/:reportId/findings/:index', async (req, res) => {
  try {
    const report = await clarity.setFindingDone(
      req.params.clientId, req.params.reportId, parseInt(req.params.index, 10), !!req.body.done
    );
    res.json({ report });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
