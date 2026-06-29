// Swipe file — "reel to ideas". Per-tenant auth: the AM pastes a video URL,
// the worker downloads + transcribes it, and Claude turns it into an idea card.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const swipe = require('../services/swipeFile');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

const id = (req) => parseInt(req.params.id, 10);

router.get('/clients/:clientId/swipe', async (req, res) => {
  try { res.json({ items: await swipe.list(req.params.clientId) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post('/clients/:clientId/swipe', async (req, res) => {
  try { res.status(201).json(await swipe.create(req.params.clientId, req.body || {}, req.user?.id)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.get('/clients/:clientId/swipe/:id', async (req, res) => {
  try {
    const item = await swipe.get(req.params.clientId, id(req));
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.patch('/clients/:clientId/swipe/:id', async (req, res) => {
  try { res.json(await swipe.update(req.params.clientId, id(req), req.body || {})); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post('/clients/:clientId/swipe/:id/retry', async (req, res) => {
  try { res.json(await swipe.retry(req.params.clientId, id(req))); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.delete('/clients/:clientId/swipe/:id', async (req, res) => {
  try { await swipe.remove(req.params.clientId, id(req)); res.status(204).end(); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
