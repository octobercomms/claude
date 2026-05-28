const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, assertClientAccess } = require('../middleware/clientAccess');
const strategistReport = require('../services/strategistReport');

router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// List of Strategist reports for a client, newest first. Returns a
// lightweight summary (no markdown body) so the sidebar list paints
// fast — fetch the full report via GET /reports/:id.
router.get('/clients/:clientId/reports', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, period_start, period_end, generated_at, status, trigger,
              read_at,
              CASE WHEN markdown IS NULL THEN 0 ELSE LENGTH(markdown) END AS markdown_len,
              error_message
         FROM strategist_reports
        WHERE client_id = $1
        ORDER BY generated_at DESC
        LIMIT 50`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single report including the full markdown body. Verifies the caller can
// see the underlying client.
router.get('/reports/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM strategist_reports WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    assertClientAccess(req, rows[0].client_id);
    res.json(rows[0]);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Mark a report as read — used by the dashboard "unread" badge. POST so
// the GET above stays cacheable.
router.post('/reports/:id/read', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT client_id FROM strategist_reports WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    assertClientAccess(req, rows[0].client_id);
    await pool.query(
      `UPDATE strategist_reports SET read_at = COALESCE(read_at, NOW()) WHERE id = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/reports/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT client_id FROM strategist_reports WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).end();
    assertClientAccess(req, rows[0].client_id);
    await pool.query(`DELETE FROM strategist_reports WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Kick off a new report. Synchronous so the UI can show the markdown
// once it returns — Claude usually takes 30-60s. Reasonable to wait.
router.post('/clients/:clientId/reports/generate', async (req, res) => {
  const periodDays = Math.max(1, Math.min(90, parseInt(req.body?.period_days, 10) || 7));
  try {
    const id = await strategistReport.generate({
      clientId: req.params.clientId,
      periodDays,
      trigger: 'manual',
    });
    const { rows } = await pool.query(`SELECT * FROM strategist_reports WHERE id = $1`, [id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
