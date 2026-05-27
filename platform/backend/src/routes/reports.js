const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const reportService = require('../services/reportService');
const users = require('../services/users');

const router = express.Router();

// HTML preview — no auth required (opens directly in browser tab)
router.get('/:id/html', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT html_content FROM reports WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Report not found');
    if (!rows[0].html_content) return res.status(404).send('HTML not available');
    res.type('html').send(rows[0].html_content);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.use(authenticate);

// Load the caller's client visibility (admin → null sentinel = all).
router.use(async (req, res, next) => {
  try {
    req.visibleClientIds = await users.getVisibleClientIds(req.user);
    next();
  } catch (err) {
    next(err);
  }
});

// List reports — scoped to the caller's visible clients
router.get('/', async (req, res) => {
  try {
    const { client_id, status, limit = 50, offset = 0 } = req.query;
    if (client_id && !users.canAccessClient(req.visibleClientIds, client_id)) {
      return res.status(403).json({ error: 'Not authorised for this client' });
    }
    let query = `
      SELECT r.*, c.name as client_name
      FROM reports r
      JOIN clients c ON c.id = r.client_id
      WHERE 1=1
    `;
    const params = [];
    if (client_id) { params.push(client_id); query += ` AND r.client_id = $${params.length}`; }
    if (req.visibleClientIds !== null) {
      if (!req.visibleClientIds.length) return res.json([]);
      params.push(req.visibleClientIds);
      query += ` AND r.client_id = ANY($${params.length})`;
    }
    if (status) { params.push(status); query += ` AND r.status = $${params.length}`; }
    params.push(limit, offset);
    query += ` ORDER BY r.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single report — checked against caller's visibility
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT r.*, c.name as client_name FROM reports r JOIN clients c ON c.id = r.client_id WHERE r.id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    if (!users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised for this report' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Trigger report generation
router.post('/trigger', async (req, res) => {
  const { client_id, report_type, period_start, period_end } = req.body;
  if (!client_id || !report_type) {
    return res.status(400).json({ error: 'client_id and report_type required' });
  }
  try {
    const client = await pool.query('SELECT * FROM clients WHERE id = $1', [client_id]);
    if (!client.rows.length) return res.status(404).json({ error: 'Client not found' });

    // Create report record
    const start = period_start || getDefaultPeriodStart(report_type);
    const end = period_end || getDefaultPeriodEnd(report_type);

    const { rows } = await pool.query(
      `INSERT INTO reports (client_id, report_type, period_start, period_end, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [client_id, report_type, start, end]
    );
    const report = rows[0];

    // Run async
    reportService.generateReport(report.id).catch(err => {
      console.error(`Report ${report.id} failed:`, err.message);
    });

    res.status(202).json({ message: 'Report generation started', report_id: report.id, report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete report
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM reports WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resend report email
router.post('/:id/resend', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM reports WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    if (rows[0].status !== 'generated' && rows[0].status !== 'sent') {
      return res.status(400).json({ error: 'Report must be generated before resending' });
    }

    reportService.sendReport(req.params.id).catch(err => {
      console.error(`Resend ${req.params.id} failed:`, err.message);
    });

    res.json({ message: 'Resend initiated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getDefaultPeriodStart(reportType) {
  const now = new Date();
  if (reportType === 'monthly') {
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return firstOfLastMonth.toISOString().split('T')[0];
  }
  // Weekly: last Monday
  const day = now.getDay();
  const lastMonday = new Date(now);
  lastMonday.setDate(now.getDate() - ((day + 6) % 7) - 7);
  return lastMonday.toISOString().split('T')[0];
}

function getDefaultPeriodEnd(reportType) {
  const now = new Date();
  if (reportType === 'monthly') {
    const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    return lastOfLastMonth.toISOString().split('T')[0];
  }
  // Weekly: last Sunday
  const day = now.getDay();
  const lastSunday = new Date(now);
  lastSunday.setDate(now.getDate() - ((day + 6) % 7) - 1);
  return lastSunday.toISOString().split('T')[0];
}

module.exports = router;
