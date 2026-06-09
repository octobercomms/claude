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
const { loadVisibleClientIds, requireClientAccess, requireAdmin, assertClientAccess } = require('../middleware/clientAccess');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

const STATUSES = Object.keys(pr.STATUS_LABELS);

// Resolve an editorial-log entry's client and enforce access for /editorial-log/:id routes.
router.param('id', async (req, res, next, id) => {
  try {
    const { rows } = await db.query('SELECT client_id FROM pr_editorial_log WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Entry not found' });
    try { assertClientAccess(req, rows[0].client_id); } catch (e) { return res.status(e.status || 403).json({ error: e.message }); }
    next();
  } catch (err) { next(err); }
});

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
      `SELECT l.id, l.story_title, l.status, l.country, l.issue_date, l.request_date,
              l.interview_date, l.story_url, l.notes_outcome, l.pitch_request,
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
        country: r.country, issue_date: r.issue_date, request_date: r.request_date,
        interview_date: r.interview_date, story_url: r.story_url,
        notes_outcome: r.notes_outcome, pitch_request: r.pitch_request,
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

// Import an editorial-log CSV for a single client (all rows → this client).
router.post('/clients/:clientId/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file required' });
    const result = await pr.importEditorialCsv(req.params.clientId, req.file.buffer.toString('utf8'));
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Import a COMBINED CSV spanning many clients — routes each row to the matching
// client by its "Client" column. Admin-only (cross-client).
router.post('/import', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file required' });
    const result = await pr.importEditorialCsvAllClients(req.file.buffer.toString('utf8'));
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Create a log entry for a client.
router.post('/clients/:clientId/editorial-log', async (req, res) => {
  try {
    const b = req.body || {};
    const outletId = b.publication ? await pr.resolveOutlet(b.publication) : null;
    const contactId = b.press_contact ? await pr.resolveContact(b.press_contact, outletId) : null;
    const status = STATUSES.includes(b.status) ? b.status : 'pitched';
    const { rows } = await db.query(
      `INSERT INTO pr_editorial_log
         (client_id, story_title, contact_id, outlet_id, country, status, pitch_request,
          request_date, interview_date, issue_date, story_url, notes_outcome, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual') RETURNING id`,
      [
        req.params.clientId, b.story_title || '', contactId, outletId, b.country || '', status,
        b.pitch_request || '', pr.parseDate(b.request_date), pr.parseDate(b.interview_date),
        pr.parseDate(b.issue_date), b.story_url || '', b.notes_outcome || '',
      ]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update a log entry (access enforced by router.param('id')).
router.patch('/editorial-log/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const sets = [];
    const vals = [];
    let n = 1;
    const set = (col, val) => { sets.push(`${col} = $${n++}`); vals.push(val); };

    if (typeof b.story_title === 'string') set('story_title', b.story_title);
    if (typeof b.country === 'string') set('country', b.country);
    if (typeof b.status === 'string' && STATUSES.includes(b.status)) set('status', b.status);
    if (typeof b.story_url === 'string') set('story_url', b.story_url);
    if (typeof b.notes_outcome === 'string') set('notes_outcome', b.notes_outcome);
    if (typeof b.pitch_request === 'string') set('pitch_request', b.pitch_request);
    if ('request_date' in b) set('request_date', pr.parseDate(b.request_date));
    if ('interview_date' in b) set('interview_date', pr.parseDate(b.interview_date));
    if ('issue_date' in b) set('issue_date', pr.parseDate(b.issue_date));
    if (b.publication) set('outlet_id', await pr.resolveOutlet(b.publication));
    if (b.press_contact) {
      const outletId = b.publication ? await pr.resolveOutlet(b.publication) : null;
      set('contact_id', await pr.resolveContact(b.press_contact, outletId));
    }
    if (!sets.length) return res.json({ updated: 0 });
    vals.push(req.params.id);
    await db.query(`UPDATE pr_editorial_log SET ${sets.join(', ')} WHERE id = $${n}`, vals);
    res.json({ updated: 1 });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete a log entry (access enforced by router.param('id')).
router.delete('/editorial-log/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM pr_editorial_log WHERE id = $1', [req.params.id]);
    res.json({ deleted: 1 });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
