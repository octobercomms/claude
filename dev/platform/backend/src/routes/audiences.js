// Audience Insights API. Lives at /api/audiences. Standard auth +
// per-client visibility gates. All endpoints scoped to :clientId or to
// a :segmentId that we resolve back to a client for the check.

const express = require('express');
const multer = require('multer');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const users = require('../services/users');
const audienceInsights = require('../services/audienceInsights');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// CSV customer-list uploads are parsed + hashed in memory — we never
// write the raw file to disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Segment UUID → client_id, refuse cross-tenant access.
router.param('segmentId', async (req, res, next, id) => {
  try {
    const { rows } = await pool.query('SELECT client_id FROM audience_segments WHERE id = $1', [id]);
    if (rows.length && !users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised for this segment' });
    }
    next();
  } catch (err) { next(err); }
});

// First-party postcode distribution — cached for 24h, recomputed on
// demand when ?refresh=1.
router.get('/clients/:clientId/postcode-distribution', async (req, res) => {
  try {
    const data = await audienceInsights.getPostcodeDistribution(
      req.params.clientId,
      { force: req.query.refresh === '1' }
    );
    res.json(data);
  } catch (err) {
    console.error('[audiences] distribution failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

router.get('/clients/:clientId/segments', async (req, res) => {
  try {
    const segments = await audienceInsights.listSegments(req.params.clientId);
    res.json(segments);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/segments', async (req, res) => {
  const { name, description, filters, source } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const segment = await audienceInsights.saveSegment(req.params.clientId, {
      name, description, filters: filters || {}, source,
    });
    res.json(segment);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload a first-party customer list (CSV) → becomes a customer_list
// segment with hashed contacts, exportable as a Meta Custom Audience.
router.post('/clients/:clientId/customer-lists', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file required' });
    const name = String(req.body.name || req.file.originalname || 'Customer list').trim().slice(0, 120) || 'Customer list';
    const csvText = req.file.buffer.toString('utf8');
    const segment = await audienceInsights.createCustomerListSegment(req.params.clientId, {
      name, filename: req.file.originalname, csvText,
    });
    res.json(segment);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/segments/:segmentId', async (req, res) => {
  const { name, description, filters, source } = req.body || {};
  try {
    // Resolve client_id from the segment so saveSegment can do its work.
    const { rows } = await pool.query('SELECT client_id FROM audience_segments WHERE id = $1', [req.params.segmentId]);
    if (!rows.length) return res.status(404).json({ error: 'Segment not found' });
    const segment = await audienceInsights.saveSegment(rows[0].client_id, {
      id: req.params.segmentId, name, description, filters: filters || {}, source,
    });
    res.json(segment);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/segments/:segmentId', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT client_id FROM audience_segments WHERE id = $1', [req.params.segmentId]);
    if (!rows.length) return res.status(404).end();
    await audienceInsights.deleteSegment(rows[0].client_id, req.params.segmentId);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// CSV export for Meta Custom Audience upload.
router.get('/segments/:segmentId/export.csv', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT client_id, name FROM audience_segments WHERE id = $1', [req.params.segmentId]);
    if (!rows.length) return res.status(404).send('Segment not found');
    const country = (req.query.country || 'GB').toUpperCase();
    const csv = await audienceInsights.exportSegmentForMeta(rows[0].client_id, req.params.segmentId, country);
    const slug = String(rows[0].name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-meta-audience.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
