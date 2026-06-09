/**
 * PR module — native to the platform (Postgres). Per-client editorial log,
 * journalist analytics and CSV import. Runs without the WordPress plugin.
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../db');
const pr = require('../services/pr');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// Stats for a client's PR coverage.
router.get('/clients/:clientId/stats', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('published','download')) AS published,
         COUNT(*) AS tracked,
         COUNT(DISTINCT contact_id) FILTER (WHERE contact_id IS NOT NULL) AS journalists
       FROM pr_editorial_log WHERE client_id = $1`,
      [req.params.clientId]
    );
    const r = rows[0] || {};
    res.json({ published: +r.published || 0, tracked: +r.tracked || 0, journalists: +r.journalists || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Editorial log entries for a client.
router.get('/clients/:clientId/editorial-log', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.id, l.story_title, l.status, l.country, l.issue_date, l.story_url,
              o.name AS outlet, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS journalist
       FROM pr_editorial_log l
       LEFT JOIN pr_outlets o ON o.id = l.outlet_id
       LEFT JOIN pr_contacts c ON c.id = l.contact_id
       WHERE l.client_id = $1
       ORDER BY COALESCE(l.issue_date, l.request_date) DESC NULLS LAST, l.created_at DESC
       LIMIT 500`,
      [req.params.clientId]
    );
    res.json({
      items: rows.map((r) => ({
        id: r.id, story_title: r.story_title, status: r.status, status_label: pr.statusLabel(r.status),
        country: r.country, issue_date: r.issue_date, story_url: r.story_url,
        outlet: r.outlet, journalist: (r.journalist || '').trim(),
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Journalists who have covered this client, with relationship analytics.
router.get('/clients/:clientId/journalists', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, o.name AS outlet,
              COUNT(l.id) AS total,
              COUNT(*) FILTER (WHERE l.status IN ('published','download')) AS published,
              COUNT(*) FILTER (WHERE l.status = 'pitched') AS pitched,
              COUNT(*) FILTER (WHERE l.status = 'declined') AS declined,
              MAX(CASE WHEN l.status IN ('published','download') THEN COALESCE(l.issue_date, l.request_date) END) AS last_featured
       FROM pr_contacts c
       JOIN pr_editorial_log l ON l.contact_id = c.id AND l.client_id = $1
       LEFT JOIN pr_outlets o ON o.id = c.outlet_id
       GROUP BY c.id, o.name
       ORDER BY published DESC, total DESC
       LIMIT 200`,
      [req.params.clientId]
    );
    res.json({
      items: rows.map((r) => {
        const ts = r.last_featured ? new Date(r.last_featured).getTime() : null;
        const str = pr.relationshipStrength(r.published, ts);
        return {
          id: r.id, name: r.name, outlet: r.outlet,
          published: +r.published, pitched: +r.pitched,
          hit_rate: pr.hitRate(r.published, r.pitched, r.declined),
          last_featured: r.last_featured,
          strength: str.score, strength_label: str.label,
          gone_quiet: pr.isGoneQuiet(+r.published, ts),
        };
      }),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Import an editorial-log CSV for a client.
router.post('/clients/:clientId/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file required' });
    const result = await pr.importEditorialCsv(req.params.clientId, req.file.buffer.toString('utf8'));
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
