const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const claudeService = require('../services/claude');
const users = require('../services/users');

const router = express.Router();
router.use(authenticate);

// Load the caller's client visibility once per request. Admins get null
// (sentinel for "all clients"); viewers get the array of UUIDs assigned to
// them via the user_clients join table.
router.use(async (req, res, next) => {
  try {
    req.visibleClientIds = await users.getVisibleClientIds(req.user);
    next();
  } catch (err) {
    next(err);
  }
});

// Block any request that targets a client outside the caller's scope.
router.param('id', (req, res, next, id) => {
  if (!users.canAccessClient(req.visibleClientIds, id)) {
    return res.status(403).json({ error: 'Not authorised for this client' });
  }
  next();
});

// Nested resource — per-client report template (Claude-designed, locked by AM).
router.use('/:id/report-template', require('./reportTemplates'));

// List all clients (filtered by the caller's visibility)
router.get('/', async (req, res) => {
  try {
    let result;
    if (req.visibleClientIds === null) {
      result = await pool.query('SELECT * FROM clients ORDER BY name ASC');
    } else if (req.visibleClientIds.length === 0) {
      result = { rows: [] };
    } else {
      result = await pool.query(
        'SELECT * FROM clients WHERE id = ANY($1) ORDER BY name ASC',
        [req.visibleClientIds]
      );
    }
    res.json(result.rows);
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

// Create client (admins only — viewers can't add clients to the org)
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

router.post('/', adminOnly, async (req, res) => {
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
  const { name, slug, active, briefing_field, monthly_focus, report_recipients, report_schedule, report_sections, section_instructions, domain, strategist_recipients } = req.body;
  try {
    const current = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Client not found' });

    const c = current.rows[0];
    const { rows } = await pool.query(
      `UPDATE clients SET
        name = $1, slug = $2, active = $3,
        briefing_field = $4, monthly_focus = $5,
        report_recipients = $6, report_schedule = $7,
        report_sections = $8, section_instructions = $9, domain = $10,
        strategist_recipients = $11
       WHERE id = $12 RETURNING *`,
      [
        name ?? c.name,
        slug ?? c.slug,
        active ?? c.active,
        briefing_field ?? c.briefing_field,
        monthly_focus ?? c.monthly_focus,
        JSON.stringify(report_recipients ?? c.report_recipients),
        JSON.stringify(report_schedule ?? c.report_schedule),
        JSON.stringify(report_sections ?? c.report_sections ?? null),
        JSON.stringify(section_instructions ?? c.section_instructions ?? {}),
        domain ?? c.domain ?? null,
        strategist_recipients !== undefined ? strategist_recipients : c.strategist_recipients,
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

// Research the client's domain via Claude and draft an "About this client"
// paragraph. The frontend opens this in a draft-and-accept modal.
router.post('/:id/complete-briefing', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const client = rows[0];
    if (!client.domain) return res.status(400).json({ error: 'Set the client domain first — Claude needs something to research.' });

    const draft = await claudeService.researchBriefing({
      clientName: client.name,
      domain: client.domain,
      existingBriefing: client.briefing_field || null,
    });
    res.json({ briefing: draft });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Suggest a draft for this month's report focus. Reads recent context-log
// items (decisions / open investigations from the AI Data Analyst), the
// previous month's focus, and a quick summary of connector status, then asks
// Claude to write a short focus paragraph.
router.post('/:id/suggest-monthly-focus', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const client = rows[0];

    const [historyRes, contextRes, connectorsRes] = await Promise.all([
      pool.query(
        'SELECT month, year, focus_text FROM monthly_focus_history WHERE client_id = $1 ORDER BY year DESC, month DESC LIMIT 3',
        [req.params.id]
      ),
      pool.query(
        "SELECT type, content FROM client_context_log WHERE client_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 20",
        [req.params.id]
      ).catch(() => ({ rows: [] })),
      pool.query(
        "SELECT connector_type, store_label, status, error_message FROM connectors WHERE client_id = $1 ORDER BY connector_type",
        [req.params.id]
      ),
    ]);

    const draft = await claudeService.suggestMonthlyFocus({
      client,
      previousFocuses: historyRes.rows,
      openContextItems: contextRes.rows,
      connectorStatus: connectorsRes.rows,
    });
    res.json({ focus: draft });
  } catch (err) {
    res.status(502).json({ error: err.message });
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

// Delete client (admin only — viewers must never be able to delete)
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
