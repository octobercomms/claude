// Instagram discovery → manual-outreach queue. Per-tenant auth: the AM keeps
// several named searches and works each one's queue by hand.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const ig = require('../services/igOutreach');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

const pid = (req) => parseInt(req.params.id, 10);
const sid = (req) => parseInt(req.params.searchId, 10);

// ── Searches ──
router.get('/clients/:clientId/searches', async (req, res) => {
  try { res.json({ searches: await ig.listSearches(req.params.clientId) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post('/clients/:clientId/searches', async (req, res) => {
  try { res.status(201).json(await ig.createSearch(req.params.clientId, req.body || {})); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.patch('/clients/:clientId/searches/:searchId', async (req, res) => {
  try { res.json(await ig.updateSearch(req.params.clientId, sid(req), req.body || {})); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.delete('/clients/:clientId/searches/:searchId', async (req, res) => {
  try { await ig.deleteSearch(req.params.clientId, sid(req)); res.status(204).end(); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post('/clients/:clientId/searches/:searchId/run', async (req, res) => {
  try { res.json(await ig.runSearch(req.params.clientId, sid(req))); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post('/clients/:clientId/searches/:searchId/draft-all', async (req, res) => {
  try { res.json(await ig.draftAll(req.params.clientId, sid(req))); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ── Prospects ──
router.get('/clients/:clientId/prospects', async (req, res) => {
  try { res.json({ prospects: await ig.listProspects(req.params.clientId, req.query.searchId ? parseInt(req.query.searchId, 10) : null) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.patch('/clients/:clientId/prospects/:id', async (req, res) => {
  try { res.json(await ig.setStatus(req.params.clientId, pid(req), req.body || {})); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post('/clients/:clientId/prospects/:id/draft', async (req, res) => {
  try { res.json(await ig.draftMessage(req.params.clientId, pid(req))); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post('/clients/:clientId/prospects/:id/enrich', async (req, res) => {
  try { res.json(await ig.enrichEmail(req.params.clientId, pid(req))); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
