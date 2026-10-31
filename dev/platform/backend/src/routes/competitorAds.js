// Competitor Google Ads intelligence API — /api/competitor-ads. Pull a
// competitor's live ads (Ads Transparency Center via SerpApi) + Claude analysis,
// per client. See services/competitorAds.js.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const competitorAds = require('../services/competitorAds');
const clientCompetitors = require('../services/clientCompetitors');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// The client's stored competitor list. Reading it costs nothing; it is only
// a Claude call when the list is empty, or when ?force=1 says the AM wants
// more names on top of what is already there.
//
// This replaces a GET that called Claude every single time it was opened,
// which is why Quick Start's suggestions and this panel's could disagree:
// they were two answers to one question, bought separately.
router.get('/clients/:clientId/suggestions', async (req, res) => {
  try {
    res.json(await clientCompetitors.suggest(req.params.clientId, { force: req.query.force === '1' }));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/clients/:clientId/competitors', async (req, res) => {
  try { res.json({ competitors: await clientCompetitors.list(req.params.clientId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/competitors', async (req, res) => {
  try { res.status(201).json(await clientCompetitors.add(req.params.clientId, req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.patch('/clients/:clientId/competitors/:id', async (req, res) => {
  try {
    const row = await clientCompetitors.update(req.params.clientId, req.params.id, req.body || {});
    if (!row) return res.status(404).json({ error: 'Competitor not found' });
    res.json(row);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/clients/:clientId/competitors/:id', async (req, res) => {
  try {
    const gone = await clientCompetitors.remove(req.params.clientId, req.params.id);
    if (!gone) return res.status(404).json({ error: 'Competitor not found' });
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
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
