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

// --- Sites (a client may connect several Clarity projects, each labelled) ---
router.get('/clients/:clientId/sites', async (req, res) => {
  try { res.json({ sites: await clarity.listSites(req.params.clientId) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/clients/:clientId/sites', async (req, res) => {
  try { res.status(201).json(await clarity.addSite(req.params.clientId, req.body?.label, req.body?.token)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.patch('/clients/:clientId/sites/:siteId', async (req, res) => {
  try { res.json(await clarity.updateLabel(req.params.clientId, parseInt(req.params.siteId, 10), req.body?.label)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/clients/:clientId/sites/:siteId', async (req, res) => {
  try { await clarity.removeSite(req.params.clientId, parseInt(req.params.siteId, 10)); res.status(204).end(); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// --- Reports (latest per site; scan runs against one site) ---
router.get('/clients/:clientId/reports', async (req, res) => {
  try { res.json({ reports: await clarity.latestReports(req.params.clientId) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/clients/:clientId/sites/:siteId/report/run', async (req, res) => {
  try { res.status(201).json({ report: await clarity.runReport(req.params.clientId, parseInt(req.params.siteId, 10)) }); }
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
