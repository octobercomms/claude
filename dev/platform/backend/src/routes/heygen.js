// HeyGen AI reels — per-tenant auth. Pick an avatar/Digital Twin + voice, type a
// script, and HeyGen renders a captioned vertical reel (async; the scheduler
// polls status). See services/heygen.js.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const heygen = require('../services/heygen');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

const id = (req) => parseInt(req.params.id, 10);

// Avatars (incl. Digital Twins) + voices for the picker.
router.get('/clients/:clientId/heygen/options', async (req, res) => {
  // Cached, resilient avatars + voices (see heygen.getOptions): one slow/failed
  // call won't take the whole picker down, and a fresh cache serves instantly.
  try {
    res.json(await heygen.getOptions());
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || 'Could not reach HeyGen.' });
  }
});

router.get('/clients/:clientId/heygen/reels', async (req, res) => {
  try { res.json({ reels: await heygen.list(req.params.clientId) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post('/clients/:clientId/heygen/reels', async (req, res) => {
  try { res.status(201).json(await heygen.generate(req.params.clientId, req.body || {}, req.user?.id)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post('/clients/:clientId/heygen/reels/:id/refresh', async (req, res) => {
  try { res.json(await heygen.refresh(req.params.clientId, id(req))); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post('/clients/:clientId/heygen/reels/:id/retry', async (req, res) => {
  try { res.json(await heygen.retry(req.params.clientId, id(req), req.user?.id)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.delete('/clients/:clientId/heygen/reels/:id', async (req, res) => {
  try { await heygen.remove(req.params.clientId, id(req)); res.status(204).end(); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
