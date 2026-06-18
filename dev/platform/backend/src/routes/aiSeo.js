// AI-SEO API — /api/ai-seo. Keyword targets + article fit scans. Standard
// authenticated-per-tenant pattern, mirroring the AI Visibility route.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const aiSeo = require('../services/aiSeo');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// Keyword targets
router.get('/clients/:clientId/keywords', async (req, res) => {
  try { res.json({ keywords: await aiSeo.listKeywordTargets(req.params.clientId) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/clients/:clientId/keywords/generate', async (req, res) => {
  try { res.json({ keywords: await aiSeo.generateKeywordTargets(req.params.clientId, { seed: req.body?.seed || '' }) }); }
  catch (err) { res.status(err.status || 502).json({ error: err.message }); }
});

router.delete('/clients/:clientId/keywords', async (req, res) => {
  try { await aiSeo.clearKeywordTargets(req.params.clientId); res.status(204).end(); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Article fit scans
router.get('/clients/:clientId/scans', async (req, res) => {
  try { res.json({ scans: await aiSeo.listArticleScans(req.params.clientId) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/clients/:clientId/scan', async (req, res) => {
  try { res.status(201).json({ scan: await aiSeo.scanArticle({ clientId: req.params.clientId, url: req.body?.url }) }); }
  catch (err) {
    const status = err.status || (/url|HTML|readable|http/i.test(err.message) ? 400 : 502);
    res.status(status).json({ error: err.message });
  }
});

router.delete('/clients/:clientId/scans/:id', async (req, res) => {
  try { await aiSeo.deleteArticleScan(req.params.clientId, req.params.id); res.status(204).end(); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
