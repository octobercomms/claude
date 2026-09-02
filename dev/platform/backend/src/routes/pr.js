/**
 * PR module — native to the platform (Postgres). Per-client editorial log,
 * journalist analytics and CSV import. Runs without the WordPress plugin.
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../db');
const pr = require('../services/pr');
const prReports = require('../services/prReports');
const prMonitor = require('../services/prMonitor');
const prThanks = require('../services/prThanks');
const prPress = require('../services/prPress');
const pressRelease = require('../services/pressRelease');
const prEnrich = require('../services/prEnrich');
const prTarget = require('../services/prTarget');
const prArchive = require('../services/prArchive');
const { getSetting } = require('../utils/settings');
const prEngage = require('../services/prEngage');
const prLinkCheck = require('../services/prLinkCheck');
const overviewReport = require('../services/overviewReport');
const earnedOverviewReport = require('../services/earnedOverviewReport');
const prCoverageExtract = require('../services/prCoverageExtract');
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

// Resolve a press release's client and enforce access for /press-releases/:prId routes.
router.param('prId', async (req, res, next, id) => {
  try {
    const { rows } = await db.query('SELECT client_id FROM pr_press_releases WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Press release not found' });
    try { assertClientAccess(req, rows[0].client_id); } catch (e) { return res.status(e.status || 403).json({ error: e.message }); }
    next();
  } catch (err) { next(err); }
});

// Trigger an on-demand link-liveness check for all story URLs of a client.
// Synchronous because clients usually have ~50 entries; for huge logs we'd
// want to background it but that hasn't been the problem yet.
router.post('/clients/:clientId/check-links', async (req, res) => {
  try {
    const summary = await prLinkCheck.checkAllForClient(req.params.clientId);
    res.json(summary);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stats for a client's PR coverage.
router.get('/clients/:clientId/stats', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('published','download')) AS published,
         COUNT(*) AS tracked,
         COUNT(DISTINCT contact_id) FILTER (WHERE contact_id IS NOT NULL) AS journalists
       FROM pr_editorial_log WHERE client_id = $1 AND status NOT IN ('new','dismissed')`,
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
              l.attachment_url, l.attachment_filename,
              l.link_status, l.link_status_code, l.link_checked_at, l.link_final_url,
              o.name AS outlet, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS journalist
       FROM pr_editorial_log l
       LEFT JOIN pr_outlets o ON o.id = l.outlet_id
       LEFT JOIN outreach_contacts c ON c.id = l.contact_id
       WHERE l.client_id = $1 AND l.status NOT IN ('new','dismissed')
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
        attachment_url: r.attachment_url, attachment_filename: r.attachment_filename,
        link_status: r.link_status, link_status_code: r.link_status_code,
        link_checked_at: r.link_checked_at, link_final_url: r.link_final_url,
        outlet: r.outlet, journalist: (r.journalist || '').trim(),
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Journalists who have covered this client, with relationship analytics.
router.get('/clients/:clientId/journalists', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, o.name AS outlet, o.tier,
              COUNT(l.id) AS total,
              COUNT(*) FILTER (WHERE l.status IN ('published','download')) AS published,
              COUNT(*) FILTER (WHERE l.status = 'pitched') AS pitched,
              COUNT(*) FILTER (WHERE l.status = 'declined') AS declined,
              MAX(CASE WHEN l.status IN ('published','download') THEN COALESCE(l.issue_date, l.request_date) END) AS last_featured,
              occ.warm_at, occ.warm_reason, occ.interest_score
       FROM outreach_contacts c
       JOIN pr_editorial_log l ON l.contact_id = c.id AND l.client_id = $1 AND l.status NOT IN ('new','dismissed')
       LEFT JOIN pr_outlets o ON o.id = c.outlet_id
       LEFT JOIN outreach_contact_clients occ ON occ.contact_id = c.id AND occ.client_id = $1
       GROUP BY c.id, o.name, o.tier, occ.warm_at, occ.warm_reason, occ.interest_score
       ORDER BY published DESC, total DESC
       LIMIT 200`,
      [req.params.clientId]
    );
    res.json({
      items: rows.map((r) => {
        const ts = r.last_featured ? new Date(r.last_featured).getTime() : null;
        const str = pr.relationshipStrength(r.published, ts);
        return {
          id: r.id, name: r.name, outlet: r.outlet, tier: r.tier || '',
          published: +r.published, pitched: +r.pitched,
          hit_rate: pr.hitRate(r.published, r.pitched, r.declined),
          last_featured: r.last_featured,
          strength: str.score, strength_label: str.label,
          gone_quiet: pr.isGoneQuiet(+r.published, ts),
          warm: !!r.warm_at, warm_reason: r.warm_reason, interest_score: r.interest_score || 0,
        };
      }),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Warm journalists for a client — those the press interest watcher has flagged
// as showing real interest (repeat opens / a click), regardless of whether they
// already appear in the coverage log. Powers the client dashboard "showing
// interest" strip so the client sees live buzz immediately.
router.get('/clients/:clientId/warm-journalists', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, TRIM(CONCAT(COALESCE(c.first_name,''),' ',COALESCE(c.last_name,''))) AS name,
              c.name AS full_name, o.name AS outlet, occ.warm_at, occ.warm_reason, occ.interest_score
         FROM outreach_contact_clients occ
         JOIN outreach_contacts c ON c.id = occ.contact_id
         LEFT JOIN pr_outlets o ON o.id = c.outlet_id
        WHERE occ.client_id = $1 AND occ.warm_at IS NOT NULL
        ORDER BY occ.interest_score DESC, occ.warm_at DESC
        LIMIT 100`,
      [req.params.clientId]
    );
    res.json({
      items: rows.map(r => ({
        id: r.id,
        name: (r.name || '').trim() || r.full_name || 'A journalist',
        outlet: r.outlet || null,
        warm_at: r.warm_at, warm_reason: r.warm_reason, interest_score: r.interest_score || 0,
      })),
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

// One-shot cleanup for journalists + outlets whose names still contain the
// raw "(notion-url)…" trail from older imports done before the stripNotionRef
// fix. Idempotent. Admin-only because it touches every row in two tables.
router.post('/repair-imported-names', requireAdmin, async (req, res) => {
  try { res.json(await pr.repairImportedNames()); }
  catch (err) { res.status(500).json({ error: err.message }); }
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
    if (status === 'published' || status === 'download') {
      prReports.sendFeaturedAlert(req.params.clientId, { outlet: b.publication || '', title: b.story_title || '', url: b.story_url || '' }).catch(() => {});
    }
    res.status(201).json({ id: rows[0].id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Coverage from a link — step 1: fetch + AI-extract publication / journalist /
// title / date, and surface this client's still-open entries on the same outlet
// as merge candidates. Doesn't write anything.
router.post('/clients/:clientId/coverage/extract', async (req, res) => {
  try {
    const fields = await prCoverageExtract.extractFromUrl((req.body || {}).url);
    const matches = await prCoverageExtract.findOpenMatches(req.params.clientId, fields.publication);
    res.json({ fields, matches });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Coverage from a link — step 2: log it. With merge_id, flip that open entry to
// published and fill in the URL/headline/date; otherwise create a new published
// entry. Either way fire the featured alert.
router.post('/clients/:clientId/coverage/log', async (req, res) => {
  try {
    const b = req.body || {};
    const f = b.fields || {};
    const clientId = req.params.clientId;
    const outletId = f.publication ? await pr.resolveOutlet(f.publication) : null;
    const contactId = f.journalist ? await pr.resolveContact(f.journalist, outletId) : null;

    if (b.merge_id) {
      // Merge into an existing open entry (verify it belongs to this client).
      const { rows: ex } = await db.query('SELECT id FROM pr_editorial_log WHERE id = $1 AND client_id = $2', [b.merge_id, clientId]);
      if (!ex.length) return res.status(404).json({ error: 'Entry to merge into not found' });
      await db.query(
        `UPDATE pr_editorial_log SET status = 'published',
           story_url = $2,
           story_title = COALESCE(NULLIF($3, ''), story_title),
           issue_date = COALESCE($4, issue_date),
           outlet_id = COALESCE($5, outlet_id),
           contact_id = COALESCE($6, contact_id)
         WHERE id = $1`,
        [b.merge_id, f.url || '', f.title || '', pr.parseDate(f.date), outletId, contactId]
      );
      prReports.sendFeaturedAlert(clientId, { outlet: f.publication || '', title: f.title || '', url: f.url || '' }).catch(() => {});
      return res.json({ id: b.merge_id, merged: true });
    }

    const { rows } = await db.query(
      `INSERT INTO pr_editorial_log
         (client_id, story_title, contact_id, outlet_id, status, issue_date, story_url, source)
       VALUES ($1,$2,$3,$4,'published',$5,$6,'url-import') RETURNING id`,
      [clientId, f.title || '', contactId, outletId, pr.parseDate(f.date), f.url || '']
    );
    prReports.sendFeaturedAlert(clientId, { outlet: f.publication || '', title: f.title || '', url: f.url || '' }).catch(() => {});
    res.status(201).json({ id: rows[0].id, merged: false });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Update a log entry (access enforced by router.param('id')).
router.patch('/editorial-log/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const prev = (await db.query('SELECT status, client_id FROM pr_editorial_log WHERE id = $1', [req.params.id])).rows[0] || {};
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

    const nowPub = ['published', 'download'].includes(b.status);
    const wasPub = ['published', 'download'].includes(prev.status);
    if (nowPub && !wasPub && prev.client_id) {
      const r = (await db.query(
        `SELECT l.story_title, l.story_url, o.name AS outlet FROM pr_editorial_log l
         LEFT JOIN pr_outlets o ON o.id = l.outlet_id WHERE l.id = $1`, [req.params.id]
      )).rows[0] || {};
      prReports.sendFeaturedAlert(prev.client_id, { outlet: r.outlet || '', title: r.story_title || '', url: r.story_url || '' }).catch(() => {});
    }
    res.json({ updated: 1 });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete a log entry (access enforced by router.param('id')).
router.delete('/editorial-log/:id', async (req, res) => {
  try {
    // Best-effort sweep of any attached PDF before the row goes away.
    try {
      const cur = (await db.query('SELECT attachment_url FROM pr_editorial_log WHERE id = $1', [req.params.id])).rows[0];
      if (cur && cur.attachment_url) {
        const fs = require('fs'); const path = require('path');
        const fname = String(cur.attachment_url).replace(/^.*\/coverage-attachments\//, '');
        if (fname && !fname.includes('..') && !fname.includes('/')) {
          fs.unlink(path.join(__dirname, '../../coverage-attachments', fname), () => {});
        }
      }
    } catch { /* ignore */ }
    await db.query('DELETE FROM pr_editorial_log WHERE id = $1', [req.params.id]);
    res.json({ deleted: 1 });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Attach a PDF (or any small file) to a coverage entry. Stored unguessable
// under /coverage-attachments and served publicly — the URL itself is the
// access control, matching the public-coverage portal pattern. 25MB cap.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const attachmentsDir = path.join(__dirname, '../../coverage-attachments');
try { fs.mkdirSync(attachmentsDir, { recursive: true }); } catch { /* ignore */ }

router.post('/editorial-log/:id/attachment', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File required' });
    // Replace any existing attachment — cap at one PDF per entry to keep the
    // UI simple. Most AMs want "the cutout" or "the PDF copy", not a gallery.
    const cur = (await db.query('SELECT attachment_url FROM pr_editorial_log WHERE id = $1', [req.params.id])).rows[0];
    if (cur && cur.attachment_url) {
      const oldName = String(cur.attachment_url).replace(/^.*\/coverage-attachments\//, '');
      if (oldName && !oldName.includes('..') && !oldName.includes('/')) {
        fs.unlink(path.join(attachmentsDir, oldName), () => {});
      }
    }
    const safeName = (req.file.originalname || 'attachment.pdf')
      .replace(/[^\w.\-]+/g, '-').replace(/^-+|-+$/g, '').slice(-60) || 'attachment.pdf';
    const stored = `${crypto.randomBytes(12).toString('hex')}-${safeName}`;
    fs.writeFileSync(path.join(attachmentsDir, stored), req.file.buffer);
    // Served under /api so it rides the reliable API proxy (see index.js). The
    // filename-extraction regexes below match `/coverage-attachments/` as a
    // substring, so they keep working for this longer prefix too.
    const url = `/api/coverage-attachments/${stored}`;
    await db.query(
      'UPDATE pr_editorial_log SET attachment_url = $1, attachment_filename = $2 WHERE id = $3',
      [url, req.file.originalname || safeName, req.params.id]
    );
    res.json({ attachment_url: url, attachment_filename: req.file.originalname || safeName });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/editorial-log/:id/attachment', async (req, res) => {
  try {
    const cur = (await db.query('SELECT attachment_url FROM pr_editorial_log WHERE id = $1', [req.params.id])).rows[0];
    if (cur && cur.attachment_url) {
      const oldName = String(cur.attachment_url).replace(/^.*\/coverage-attachments\//, '');
      if (oldName && !oldName.includes('..') && !oldName.includes('/')) {
        fs.unlink(path.join(attachmentsDir, oldName), () => {});
      }
    }
    await db.query('UPDATE pr_editorial_log SET attachment_url = NULL, attachment_filename = NULL WHERE id = $1', [req.params.id]);
    res.json({ removed: 1 });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Coverage monitor ─────────────────────────────────────────────────────────
router.param('searchId', async (req, res, next, id) => {
  try {
    const { rows } = await db.query('SELECT client_id FROM pr_coverage_searches WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Search not found' });
    try { assertClientAccess(req, rows[0].client_id); } catch (e) { return res.status(e.status || 403).json({ error: e.message }); }
    next();
  } catch (err) { next(err); }
});

router.get('/clients/:clientId/searches', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM pr_coverage_searches WHERE client_id = $1 ORDER BY created_at DESC', [req.params.clientId]);
    // Surface whether the Google News path can actually run — a missing Serper
    // key is the usual reason the review queue stays empty, and the UI gives
    // no other hint. Google Alerts RSS works without a key.
    res.json({ items: rows, serper_configured: !!(await getSetting('SERPER_API_KEY')) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/searches', async (req, res) => {
  try {
    const b = req.body || {};
    const sources = Array.isArray(b.sources) ? b.sources.filter((s) => ['serper', 'alerts'].includes(s)).join(',') : 'serper';
    const cadence = ['daily', 'weekly'].includes(b.cadence) ? b.cadence : 'daily';
    const { rows } = await db.query(
      `INSERT INTO pr_coverage_searches (client_id, query, sources, alerts_rss, cadence) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.params.clientId, String(b.query || '').trim(), sources || 'serper', String(b.alerts_rss || '').trim(), cadence]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/searches/:searchId', async (req, res) => {
  try { await db.query('DELETE FROM pr_coverage_searches WHERE id = $1', [req.params.searchId]); res.json({ deleted: 1 }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/searches/:searchId/run', async (req, res) => {
  try {
    const s = (await db.query('SELECT * FROM pr_coverage_searches WHERE id = $1', [req.params.searchId])).rows[0];
    const found = s ? await prMonitor.runSearch(s) : 0;
    const usesSerper = !!(s && String(s.sources || '').includes('serper'));
    res.json({ found, serper_configured: !!(await getSetting('SERPER_API_KEY')), uses_serper: usesSerper });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Auto-found coverage awaiting review (status='new').
router.get('/clients/:clientId/review-queue', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.id, l.story_title, l.issue_date, l.story_url, l.source, o.name AS outlet
       FROM pr_editorial_log l LEFT JOIN pr_outlets o ON o.id = l.outlet_id
       WHERE l.client_id = $1 AND l.status = 'new'
       ORDER BY l.created_at DESC LIMIT 200`,
      [req.params.clientId]
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk-triage the review queue: confirm (status='published') or dismiss a set of
// found items in one go. Unlike the single-item PATCH this does NOT fire a
// per-item "you've been featured" client alert — bulk triage would otherwise
// blast the client one email per row; confirm items individually to notify.
router.patch('/clients/:clientId/review-queue/bulk', async (req, res) => {
  try {
    const b = req.body || {};
    const status = String(b.status || '');
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const ids = Array.isArray(b.ids) ? b.ids.filter(Boolean) : [];
    if (!ids.length) return res.json({ updated: 0 });
    const { rowCount } = await db.query(
      `UPDATE pr_editorial_log SET status = $1 WHERE client_id = $2 AND status = 'new' AND id = ANY($3::uuid[])`,
      [status, req.params.clientId, ids.map(String)]
    );
    res.json({ updated: rowCount });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Get (or create) the client's public coverage-portal token.
router.get('/clients/:clientId/portal', async (req, res) => {
  try {
    const token = await pr.ensureClientToken(req.params.clientId);
    res.json({ token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Report/alert settings for a client.
router.get('/clients/:clientId/report-settings', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT alert_email, report_cadence FROM pr_client_settings WHERE client_id = $1', [req.params.clientId]);
    res.json(rows[0] || { alert_email: '', report_cadence: 'off' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/clients/:clientId/report-settings', async (req, res) => {
  try {
    await pr.ensureClientToken(req.params.clientId); // guarantees a settings row
    const cadence = ['off', 'weekly', 'monthly'].includes(req.body.report_cadence) ? req.body.report_cadence : 'off';
    await db.query('UPDATE pr_client_settings SET alert_email = $1, report_cadence = $2 WHERE client_id = $3',
      [String(req.body.alert_email || '').trim(), cadence, req.params.clientId]);
    res.json({ updated: 1 });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/clients/:clientId/send-report', async (req, res) => {
  try {
    const result = await prReports.sendClientReport(req.params.clientId, true);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Outlet deduplication (cross-client, admin) ───────────────────────────────
function cleanestName(members) {
  return [...members].sort((a, b) => {
    const score = (n) => (pr.isDoNotUse(n) ? 100 : 0) + (/https?:\/\/|www\.|\.[a-z]{2,4}($|\/)/i.test(n) ? 50 : 0) + n.length / 100;
    return score(a.name) - score(b.name);
  })[0]?.name || '';
}

router.get('/dedup/outlets/scan', requireAdmin, async (req, res) => {
  try {
    const clusters = await pr.scanOutletDuplicates();
    const exact = clusters.filter((c) => c.method === 'exact');
    const fuzzy = clusters.filter((c) => c.method === 'fuzzy');
    const out = exact.map((c) => ({ method: 'exact', confidence: c.confidence, suggested: cleanestName(c.members), members: c.members }));

    let aiUsed = false;
    if (fuzzy.length) {
      const nameId = new Map();
      fuzzy.forEach((c) => c.members.forEach((m) => nameId.set(m.name, m.id)));
      const groups = await pr.adjudicateOutletClusters(fuzzy.map((c) => c.members));
      if (groups && Array.isArray(groups)) {
        aiUsed = true;
        for (const g of groups) {
          const names = (g.members || []).filter((nm) => nameId.has(nm));
          if (names.length < 2) continue;
          const members = names.map((nm) => ({ id: nameId.get(nm), name: nm }));
          out.push({ method: 'ai', confidence: g.confidence || 0.8, suggested: g.canonical || cleanestName(members), members });
        }
      } else {
        fuzzy.forEach((c) => out.push({ method: 'fuzzy', confidence: c.confidence, suggested: cleanestName(c.members), members: c.members }));
      }
    }
    res.json({ clusters: out, ai: aiUsed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/dedup/outlets/merge', requireAdmin, async (req, res) => {
  try {
    const { canonical_id, member_ids } = req.body || {};
    if (!canonical_id || !Array.isArray(member_ids) || !member_ids.length) {
      return res.status(400).json({ error: 'canonical_id and member_ids required' });
    }
    const merged = await pr.mergeOutlets(canonical_id, member_ids);
    res.json({ merged });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// "Not duplicates" — the AM saw the suggested cluster and confirmed these are
// different publications. Persist the dismissal so the next scan skips them.
router.post('/dedup/outlets/dismiss', requireAdmin, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.outlet_ids) ? req.body.outlet_ids : [];
    if (ids.length < 2) return res.status(400).json({ error: 'outlet_ids must contain at least 2 ids' });
    const added = await pr.dismissOutletCluster(ids, req.user?.id || null);
    res.json({ dismissed: added });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Profiles (global media DB; :outletId/:contactId avoid the editorial-log :id hook) ──
// Publications list (admin) — for the Settings → Publications tab. Tier + how
// much coverage each has, most-covered first.
router.get('/outlets', requireAdmin, async (req, res) => {
  try {
    // Optional ?q= server-side search. Without it, the LIMIT 2000 window
    // ordered by coverage DESC hides every outlet with zero coverage — so
    // recently-imported names that haven't been featured yet (Vogue.nl,
    // Metro.us, etc.) silently fall out of the Publications panel even when
    // you type their exact name in the client-side filter. With ?q=, ILIKE
    // runs in SQL across name / canonical_name / domain.
    const q = (req.query.q || '').toString().trim();
    const params = [];
    let where = 'o.merged_into IS NULL';
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (o.name ILIKE $${params.length} OR o.canonical_name ILIKE $${params.length} OR o.domain ILIKE $${params.length})`;
    }
    // Contact count per publication — uses outreach_contacts.outlet_id, the
    // same FK the contacts library reads from. Cheap correlated subquery
    // rather than a second LEFT JOIN because it doesn't multiply the row
    // count against the coverage join.
    const { rows } = await db.query(
      `SELECT o.id, o.name, o.tier, o.domain, o.region,
              COUNT(l.id)::int AS coverage,
              (SELECT COUNT(*)::int FROM outreach_contacts c
                WHERE c.outlet_id = o.id AND c.merged_into IS NULL) AS contacts
       FROM pr_outlets o
       LEFT JOIN pr_editorial_log l ON l.outlet_id = o.id
       WHERE ${where}
       GROUP BY o.id
       ORDER BY coverage DESC, lower(o.name) ASC
       LIMIT 2000`,
      params
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/outlets/:outletId', async (req, res) => {
  try {
    const o = await db.query('SELECT * FROM pr_outlets WHERE id = $1', [req.params.outletId]);
    if (!o.rows.length) return res.status(404).json({ error: 'Outlet not found' });
    const coverage = await db.query(
      `SELECT l.client_id, cl.name AS client, l.story_title, l.status, l.issue_date, l.story_url,
              TRIM(CONCAT(c.first_name,' ',c.last_name)) AS journalist
       FROM pr_editorial_log l
       LEFT JOIN clients cl ON cl.id = l.client_id
       LEFT JOIN outreach_contacts c ON c.id = l.contact_id
       WHERE l.outlet_id = $1 ORDER BY COALESCE(l.issue_date, l.request_date) DESC NULLS LAST LIMIT 200`,
      [req.params.outletId]
    );
    const journos = await db.query(
      "SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name FROM outreach_contacts WHERE outlet_id = $1 AND kind IN ('media','industry') ORDER BY last_name LIMIT 100",
      [req.params.outletId]
    );
    res.json({ ...o.rows[0], coverage: coverage.rows, journalists: journos.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/outlets/:outletId', async (req, res) => {
  try {
    const b = req.body || {};
    const sets = []; const vals = []; let n = 1;
    const set = (c, v) => { sets.push(`${c} = $${n++}`); vals.push(v); };
    ['summary', 'tier', 'region', 'notes', 'domain'].forEach((k) => { if (typeof b[k] === 'string') set(k, b[k]); });
    if (typeof b.name === 'string' && b.name.trim()) {
      // Keep canonical_name in lockstep with name — they were diverging when
      // the dedup workflow merged outlets, and the AM kept seeing the old
      // canonical_name in the chip while the live name was the new one.
      set('name', b.name.trim());
      set('canonical_name', b.name.trim());
    }
    if (!sets.length) return res.json({ updated: 0 });
    vals.push(req.params.outletId);
    await db.query(`UPDATE pr_outlets SET ${sets.join(', ')} WHERE id = $${n}`, vals);
    res.json({ updated: 1 });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete a publication. Cascade rules on referencing tables
// (pr_editorial_log.outlet_id, outreach_contacts.outlet_id) are ON DELETE
// SET NULL, so coverage entries and journalists pointing at the publication
// keep existing — they just become outlet-less. The AM is warned about
// stranded counts in the UI before they click.
router.delete('/outlets/:outletId', requireAdmin, async (req, res) => {
  try {
    const r = await db.query('DELETE FROM pr_outlets WHERE id = $1', [req.params.outletId]);
    res.json({ deleted: r.rowCount || 0 });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Bulk delete — used by the Publications panel "Delete selected / Delete all
// matching" affordances. Cascade is ON DELETE SET NULL for both
// pr_editorial_log.outlet_id and outreach_contacts.outlet_id, so coverage
// entries and contacts pointing at the deleted outlets keep existing — they
// just become outlet-less. The UI confirmation tells the AM that.
router.post('/outlets/bulk-delete', requireAdmin, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    const r = await db.query('DELETE FROM pr_outlets WHERE id = ANY($1::uuid[])', [ids]);
    res.json({ deleted: r.rowCount || 0 });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/outlets/:outletId/summary', async (req, res) => {
  try {
    const name = (await db.query('SELECT name FROM pr_outlets WHERE id = $1', [req.params.outletId])).rows[0]?.name;
    if (!name) return res.status(404).json({ error: 'Outlet not found' });
    const titles = (await db.query("SELECT story_title FROM pr_editorial_log WHERE outlet_id = $1 AND story_title <> '' LIMIT 40", [req.params.outletId])).rows.map((r) => r.story_title);
    res.json({ summary: await pr.writeOutletSummary(name, titles) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/contacts/:contactId', async (req, res) => {
  try {
    const c = await db.query('SELECT * FROM outreach_contacts WHERE id = $1', [req.params.contactId]);
    if (!c.rows.length) return res.status(404).json({ error: 'Contact not found' });
    const outlet = c.rows[0].outlet_id ? (await db.query('SELECT name FROM pr_outlets WHERE id = $1', [c.rows[0].outlet_id])).rows[0]?.name : '';
    const coverage = await db.query(
      `SELECT cl.name AS client, l.story_title, l.status, l.issue_date, l.story_url, o.name AS outlet
       FROM pr_editorial_log l
       LEFT JOIN clients cl ON cl.id = l.client_id
       LEFT JOIN pr_outlets o ON o.id = l.outlet_id
       WHERE l.contact_id = $1 ORDER BY COALESCE(l.issue_date, l.request_date) DESC NULLS LAST LIMIT 200`,
      [req.params.contactId]
    );
    res.json({ ...c.rows[0], outlet, coverage: coverage.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/contacts/:contactId', async (req, res) => {
  try {
    const b = req.body || {};
    const sets = []; const vals = []; let n = 1;
    const set = (c, v) => { sets.push(`${c} = $${n++}`); vals.push(v); };
    ['notes', 'availability_status', 'photo_url', 'location', 'bio_link', 'email'].forEach((k) => { if (typeof b[k] === 'string') set(k, b[k]); });
    // First/last name editing — strip stray Notion refs that broke earlier
    // imports, and keep the `name` column in sync so the contacts library
    // sees the corrected display string immediately.
    let firstName = null, lastName = null;
    if (typeof b.first_name === 'string') firstName = pr.stripNotionRef(b.first_name).trim();
    if (typeof b.last_name === 'string') lastName = pr.stripNotionRef(b.last_name).trim();
    if (firstName !== null) set('first_name', firstName);
    if (lastName !== null) set('last_name', lastName);
    if (firstName !== null || lastName !== null) {
      const { rows: cur } = await db.query('SELECT first_name, last_name FROM outreach_contacts WHERE id = $1', [req.params.contactId]);
      const f = firstName !== null ? firstName : (cur[0]?.first_name || '');
      const l = lastName !== null ? lastName : (cur[0]?.last_name || '');
      set('name', `${f} ${l}`.trim());
    }
    if ('available_from' in b) set('available_from', pr.parseDate(b.available_from));
    if (Array.isArray(b.beats)) set('beats', JSON.stringify(b.beats.map((t) => String(t).trim().toLowerCase()).filter(Boolean)));
    // Allow re-pointing a journalist to a different publication right from the
    // profile — passing outlet_id (or null to clear) updates the FK. The
    // library list reads outlet via the outlet_id join, so the change shows up
    // everywhere immediately.
    if ('outlet_id' in b) set('outlet_id', b.outlet_id || null);
    if (!sets.length) return res.json({ updated: 0 });
    vals.push(req.params.contactId);
    await db.query(`UPDATE outreach_contacts SET ${sets.join(', ')} WHERE id = $${n}`, vals);
    res.json({ updated: 1 });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Hard-delete a journalist. Coverage entries pointing at them are detached
// (FK ON DELETE SET NULL) — the stories stay, the byline becomes blank.
router.delete('/contacts/:contactId', requireAdmin, async (req, res) => {
  try {
    const r = await db.query('DELETE FROM outreach_contacts WHERE id = $1', [req.params.contactId]);
    res.json({ deleted: r.rowCount || 0 });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/contacts/:contactId/suggest-beats', async (req, res) => {
  try {
    const c = (await db.query('SELECT first_name, last_name FROM outreach_contacts WHERE id = $1', [req.params.contactId])).rows[0];
    if (!c) return res.status(404).json({ error: 'Contact not found' });
    const titles = (await db.query("SELECT story_title FROM pr_editorial_log WHERE contact_id = $1 AND story_title <> '' LIMIT 40", [req.params.contactId])).rows.map((r) => r.story_title);
    res.json({ beats: await pr.suggestBeats(`${c.first_name} ${c.last_name}`.trim(), titles) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// On-demand enrichment (the long-tail / "enrich now" path) — grounds on logged
// coverage plus any extra context (e.g. pasted bylines) the caller supplies.
router.post('/contacts/:contactId/enrich', async (req, res) => {
  try { res.json(await prEnrich.enrichContact(req.params.contactId, { extraContext: String((req.body || {}).context || '') })); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// Stale-contact archive review (admin) — contacts the overnight sweep flagged.
router.get('/archive-review', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, c.email, o.name AS outlet,
              c.last_byline_check,
              (SELECT MAX(COALESCE(l.issue_date, l.request_date)) FROM pr_editorial_log l WHERE l.contact_id = c.id) AS last_coverage
         FROM outreach_contacts c LEFT JOIN pr_outlets o ON o.id = c.outlet_id
        WHERE c.archive_suggested = TRUE AND c.availability_status = 'active'
        ORDER BY c.last_byline_check DESC NULLS LAST LIMIT 200`
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/contacts/:contactId/archive', async (req, res) => {
  try { await db.query("UPDATE outreach_contacts SET availability_status = 'archived', archive_suggested = FALSE WHERE id = $1", [req.params.contactId]); res.json({ archived: 1 }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post('/contacts/:contactId/unarchive', async (req, res) => {
  try { await db.query("UPDATE outreach_contacts SET availability_status = 'active', archive_suggested = FALSE, last_byline_check = NOW() WHERE id = $1", [req.params.contactId]); res.json({ active: 1 }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// Engagement nudges — fresh bylines from priority journalists to warm up.
router.get('/engagement', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT e.id, e.article_url, e.article_title, e.article_date, e.created_at,
              TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, o.name AS outlet
         FROM pr_engagement e JOIN outreach_contacts c ON c.id = e.contact_id
         LEFT JOIN pr_outlets o ON o.id = c.outlet_id
        WHERE e.status = 'new' ORDER BY e.created_at DESC LIMIT 100`
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/engagement/:nudgeId/draft', async (req, res) => {
  try { res.json(await prEngage.draftNote(req.params.nudgeId)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post('/engagement/:nudgeId/send', async (req, res) => {
  try {
    const b = req.body || {};
    const out = await prEngage.send(req.params.nudgeId, { subject: b.subject, body: b.body });
    if (out.error) return res.status(400).json(out);
    res.json(out);
  } catch (err) { res.status(400).json({ error: err.message }); }
});
router.post('/engagement/:nudgeId/dismiss', async (req, res) => {
  try { res.json(await prEngage.dismiss(req.params.nudgeId)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// Targeting: "who should I pitch this story to?" — paste a release URL or brief.
router.post('/clients/:clientId/pitch-targets', async (req, res) => {
  try {
    const b = req.body || {};
    const out = await prTarget.findTargets({ clientId: req.params.clientId, url: b.url, brief: b.brief });
    if (out.error) return res.status(400).json(out);
    res.json(out);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Thank-yous (assisted) ────────────────────────────────────────────────────
// Published pieces with a known journalist email, not yet thanked or skipped.
// Only genuinely-published coverage is thank-worthy — a Download (asset sent)
// or any earlier stage isn't a placement, so it must not trigger a thank-you.
router.get('/clients/:clientId/thank-opportunities', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.id, l.story_title, l.story_url, l.issue_date, o.name AS outlet,
              TRIM(CONCAT(c.first_name,' ',c.last_name)) AS journalist
       FROM pr_editorial_log l
       JOIN outreach_contacts c ON c.id = l.contact_id
       LEFT JOIN pr_outlets o ON o.id = l.outlet_id
       WHERE l.client_id = $1 AND l.status = 'published'
         AND c.email <> '' AND c.email NOT LIKE '%@import.local'
         AND NOT EXISTS (SELECT 1 FROM pr_sent_thanks s WHERE s.editorial_log_id = l.id)
         AND NOT EXISTS (SELECT 1 FROM pr_thank_feedback f WHERE f.editorial_log_id = l.id AND f.decision = 'rejected')
       ORDER BY COALESCE(l.issue_date, l.created_at) DESC LIMIT 100`,
      [req.params.clientId]
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/editorial-log/:id/thank-draft', async (req, res) => {
  try { res.json(await prThanks.draftForEntry(req.params.id)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/editorial-log/:id/thank-send', async (req, res) => {
  try {
    const row = (await db.query(
      `SELECT l.contact_id, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, c.email
       FROM pr_editorial_log l JOIN outreach_contacts c ON c.id = l.contact_id WHERE l.id = $1`, [req.params.id]
    )).rows[0];
    if (!row) return res.status(400).json({ error: 'No journalist linked.' });
    const to = row.email && !/@import\.local$/.test(row.email) ? row.email : '';
    const b = req.body || {};
    const result = await prThanks.deliver({
      entryId: req.params.id, contactId: row.contact_id, to, name: row.name,
      subject: b.subject, body: b.body, tone: b.tone, confidence: b.confidence,
      decision: b.edited ? 'edited' : 'approved', userId: req.user && req.user.id,
    });
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/editorial-log/:id/thank-skip', async (req, res) => {
  try {
    const row = (await db.query('SELECT contact_id FROM pr_editorial_log WHERE id = $1', [req.params.id])).rows[0];
    res.json(await prThanks.skip({ entryId: req.params.id, contactId: row && row.contact_id, userId: req.user && req.user.id }));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Auto-send trust ramp: per-client stage + the approve/edit/reject track record.
router.get('/clients/:clientId/thank-settings', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT thank_stage FROM pr_client_settings WHERE client_id = $1', [req.params.clientId]);
    res.json({ thank_stage: (rows[0] && rows[0].thank_stage) || 'assist', stages: prThanks.STAGES, record: await prThanks.trackRecord(req.params.clientId) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/clients/:clientId/thank-settings', async (req, res) => {
  try {
    const stage = ['assist', 'supervised', 'auto'].includes(req.body.thank_stage) ? req.body.thank_stage : 'assist';
    await pr.ensureClientToken(req.params.clientId); // guarantees a settings row
    await db.query('UPDATE pr_client_settings SET thank_stage = $1 WHERE client_id = $2', [stage, req.params.clientId]);
    res.json({ updated: 1, thank_stage: stage });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Press-release authoring + sign-off ───────────────────────────────────────
const PR_STATUSES = ['draft', 'in_review', 'approved', 'sent'];

router.get('/clients/:clientId/press-releases', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, title, brand, status, review_token, approved_at, created_at FROM pr_press_releases WHERE client_id = $1 ORDER BY created_at DESC',
      [req.params.clientId]
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/press-releases', async (req, res) => {
  try {
    const b = req.body || {};
    const { rows } = await db.query(
      `INSERT INTO pr_press_releases (client_id, title, brand, angle, key_facts)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.clientId, String(b.title || '').slice(0, 500), String(b.brand || '').slice(0, 120), b.angle || '', b.key_facts || '']
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/press-releases/:prId', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM pr_press_releases WHERE id = $1', [req.params.prId]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/press-releases/:prId', async (req, res) => {
  try {
    const b = req.body || {};
    const sets = []; const vals = []; let n = 1;
    const set = (col, v) => { sets.push(`${col} = $${n++}`); vals.push(v); };
    if (typeof b.title === 'string') set('title', b.title.slice(0, 500));
    if (typeof b.brand === 'string') set('brand', b.brand.slice(0, 120));
    if (typeof b.angle === 'string') set('angle', b.angle);
    if (typeof b.key_facts === 'string') set('key_facts', b.key_facts);
    if (typeof b.body_html === 'string') set('body_html', b.body_html);
    if (typeof b.url === 'string') set('url', b.url.slice(0, 1000));
    if ('embargo_at' in b) set('embargo_at', b.embargo_at || null);
    if (PR_STATUSES.includes(b.status)) set('status', b.status);
    if (!sets.length) return res.json({ updated: 0 });
    vals.push(req.params.prId);
    await db.query(`UPDATE pr_press_releases SET ${sets.join(', ')} WHERE id = $${n}`, vals);
    // Going to review (or beyond) needs a token for the client approval link.
    if (['in_review', 'approved', 'sent'].includes(b.status)) await prPress.ensureReviewToken(req.params.prId);
    const { rows } = await db.query('SELECT * FROM pr_press_releases WHERE id = $1', [req.params.prId]);
    res.json(rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/press-releases/:prId', async (req, res) => {
  try { await db.query('DELETE FROM pr_press_releases WHERE id = $1', [req.params.prId]); res.json({ deleted: 1 }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/press-releases/:prId/draft', async (req, res) => {
  try {
    const p = (await db.query('SELECT p.title, p.angle, p.key_facts, cl.name AS client FROM pr_press_releases p JOIN clients cl ON cl.id = p.client_id WHERE p.id = $1', [req.params.prId])).rows[0];
    const d = await prPress.draftBody({ title: p.title, client: p.client, angle: p.angle, key_facts: p.key_facts });
    if (d.error) return res.status(400).json(d);
    await db.query('UPDATE pr_press_releases SET body_html = $1 WHERE id = $2', [d.body_html, req.params.prId]);
    res.json({ body_html: d.body_html });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Hand off an approved release to distribution: spin up the outreach
// press_release campaign (seeded from the authored body) and link it back.
// Idempotent — returns the existing campaign if one already exists.
router.post('/press-releases/:prId/create-campaign', async (req, res) => {
  try {
    const p = (await db.query('SELECT * FROM pr_press_releases WHERE id = $1', [req.params.prId])).rows[0];
    if (!p) return res.status(404).json({ error: 'Press release not found' });
    if (p.campaign_id) return res.json({ campaign_id: p.campaign_id, existing: true });
    if (!['approved', 'sent'].includes(p.status)) return res.status(400).json({ error: 'Approve the release before creating a pitch campaign.' });
    if (!p.body_html) return res.status(400).json({ error: 'Draft the release body first.' });
    const created = await pressRelease.createReleaseWithCampaign(p.client_id, { title: p.title || 'Press release', body_html: p.body_html, boilerplate: p.brand || null });
    await db.query('UPDATE pr_press_releases SET campaign_id = $1 WHERE id = $2', [created.campaign_id, p.id]);
    res.status(201).json({ campaign_id: created.campaign_id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Branded, client-facing PDF of the whole Earned (PR) Overview.
router.get('/clients/:clientId/overview-report.pdf', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 90, 365);
    await overviewReport.sendReport(res, {
      clientId: req.params.clientId, report: earnedOverviewReport, days,
      slugPrefix: 'earned-overview', feature: 'earned_overview_report',
      emptyMsg: 'No coverage tracked yet — log some editorial coverage first, then export.',
    });
  } catch (err) {
    console.error('[earned-overview] report failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
