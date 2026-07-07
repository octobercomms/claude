// Competitor Google Ads intelligence API — /api/competitor-ads. Pull a
// competitor's live ads (Ads Transparency Center via SerpApi) + Claude analysis,
// per client. See services/competitorAds.js.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const competitorAds = require('../services/competitorAds');
const competitorSuggest = require('../services/competitorSuggest');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// Claude-suggested competitors from the client's domain + brief — seeds the
// panel so the AM isn't typing into a blank box.
router.get('/clients/:clientId/suggestions', async (req, res) => {
  try {
    res.json({ competitors: await competitorSuggest.suggestCompetitors(req.params.clientId) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

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
