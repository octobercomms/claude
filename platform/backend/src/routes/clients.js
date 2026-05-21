const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const claudeService = require('../services/claude');

const router = express.Router();
router.use(authenticate);

// List all clients
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM clients ORDER BY name ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single client
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM clients WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create client
router.post('/', async (req, res) => {
  const { name, slug, briefing_field, monthly_focus, report_recipients, report_schedule } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name and slug required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO clients (name, slug, briefing_field, monthly_focus, report_recipients, report_schedule)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        name, slug, briefing_field || null, monthly_focus || null,
        JSON.stringify(report_recipients || { monthly: [], weekly: [] }),
        JSON.stringify(report_schedule || { weekly_day: 'monday', weekly_time: '10:00', monthly_day: 1 }),
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
    res.status(500).json({ error: err.message });
  }
});

// Update client
router.put('/:id', async (req, res) => {
  const { name, slug, active, briefing_field, monthly_focus, report_recipients, report_schedule, domain } = req.body;
  try {
    const current = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Client not found' });

    const c = current.rows[0];
    const { rows } = await pool.query(
      `UPDATE clients SET
        name = $1, slug = $2, active = $3,
        briefing_field = $4, monthly_focus = $5,
        report_recipients = $6, report_schedule = $7,
        domain = $8
       WHERE id = $9 RETURNING *`,
      [
        name ?? c.name,
        slug ?? c.slug,
        active ?? c.active,
        briefing_field ?? c.briefing_field,
        monthly_focus ?? c.monthly_focus,
        JSON.stringify(report_recipients ?? c.report_recipients),
        JSON.stringify(report_schedule ?? c.report_schedule),
        domain ?? c.domain ?? null,
        req.params.id,
      ]
    );

    // If monthly_focus changed, save to history
    if (monthly_focus && monthly_focus !== c.monthly_focus) {
      const now = new Date();
      await pool.query(
        `INSERT INTO monthly_focus_history (client_id, month, year, focus_text)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (client_id, month, year) DO UPDATE SET focus_text = EXCLUDED.focus_text`,
        [req.params.id, now.getMonth() + 1, now.getFullYear(), monthly_focus]
      );
    }

    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
    res.status(500).json({ error: err.message });
  }
});

// Parse briefing with Claude to suggest connectors
router.post('/:id/parse-briefing', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const client = rows[0];

    if (!client.briefing_field) {
      return res.status(400).json({ error: 'No briefing field set' });
    }

    const suggestion = await claudeService.parseConnectorBriefing(client.briefing_field);
    res.json(suggestion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get monthly focus history
router.get('/:id/focus-history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM monthly_focus_history WHERE client_id = $1 ORDER BY year DESC, month DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update ads margin
router.patch('/:id/ads-margin', async (req, res) => {
  const { ads_margin } = req.body;
  if (ads_margin == null) return res.status(400).json({ error: 'ads_margin is required' });
  const val = parseFloat(ads_margin);
  if (isNaN(val) || val < 0 || val > 1) return res.status(400).json({ error: 'ads_margin must be a number between 0 and 1' });
  try {
    const { rows } = await pool.query(
      'UPDATE clients SET ads_margin = $1 WHERE id = $2 RETURNING *',
      [val, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete client
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
