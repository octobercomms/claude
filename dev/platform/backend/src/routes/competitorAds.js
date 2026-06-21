// Competitor Google Ads intelligence API — /api/competitor-ads. Pull a
// competitor's live ads (Ads Transparency Center via SerpApi) + Claude analysis,
// per client. See services/competitorAds.js.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const competitorAds = require('../services/competitorAds');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

router.get('/clients/:clientId', async (req, res) => {
  try {
    const [configured, runs] = await Promise.all([
      competitorAds.isConfigured(),
      competitorAds.listRuns(req.params.clientId),
    ]);
    res.json({ configured, runs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId', async (req, res) => {
  try {
    res.status(201).json({ run: await competitorAds.run(req.params.clientId, req.body || {}) });
  } catch (err) { res.status(err.status || 502).json({ error: err.message }); }
});

router.delete('/clients/:clientId/:id', async (req, res) => {
  try { await competitorAds.deleteRun(req.params.clientId, req.params.id); res.status(204).end(); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
