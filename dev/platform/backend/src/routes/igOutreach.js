// Instagram discovery → manual-outreach queue. Standard per-tenant auth: the
// AM works a queue of discovered public profiles and DMs them by hand.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const ig = require('../services/igOutreach');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

router.get('/clients/:clientId/prospects', async (req, res) => {
  try { res.json({ prospects: await ig.listProspects(req.params.clientId) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/clients/:clientId/discover', async (req, res) => {
  try { res.json(await ig.discover(req.params.clientId, req.body || {})); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.patch('/clients/:clientId/prospects/:id', async (req, res) => {
  try { res.json(await ig.setStatus(req.params.clientId, parseInt(req.params.id, 10), req.body || {})); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/clients/:clientId/prospects/:id/draft', async (req, res) => {
  try { res.json(await ig.draftMessage(req.params.clientId, parseInt(req.params.id, 10))); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
