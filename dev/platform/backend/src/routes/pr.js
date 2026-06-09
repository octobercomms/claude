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
              o.name AS outlet, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS journalist
       FROM pr_editorial_log l
       LEFT JOIN pr_outlets o ON o.id = l.outlet_id
       LEFT JOIN pr_contacts c ON c.id = l.contact_id
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
       JOIN pr_editorial_log l ON l.contact_id = c.id AND l.client_id = $1 AND l.status NOT IN ('new','dismissed')
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
    if (status === 'published' || status === 'download') {
      prReports.sendFeaturedAlert(req.params.clientId, { outlet: b.publication || '', title: b.story_title || '', url: b.story_url || '' }).catch(() => {});
    }
    res.status(201).json({ id: rows[0].id });
  } catch (err) { res.status(400).json({ error: err.message }); }
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
    await db.query('DELETE FROM pr_editorial_log WHERE id = $1', [req.params.id]);
    res.json({ deleted: 1 });
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
    res.json({ items: rows });
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
    res.json({ found });
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

// ── Profiles (global media DB; :outletId/:contactId avoid the editorial-log :id hook) ──
router.get('/outlets/:outletId', async (req, res) => {
  try {
    const o = await db.query('SELECT * FROM pr_outlets WHERE id = $1', [req.params.outletId]);
    if (!o.rows.length) return res.status(404).json({ error: 'Outlet not found' });
    const coverage = await db.query(
      `SELECT l.client_id, cl.name AS client, l.story_title, l.status, l.issue_date, l.story_url,
              TRIM(CONCAT(c.first_name,' ',c.last_name)) AS journalist
       FROM pr_editorial_log l
       LEFT JOIN clients cl ON cl.id = l.client_id
       LEFT JOIN pr_contacts c ON c.id = l.contact_id
       WHERE l.outlet_id = $1 ORDER BY COALESCE(l.issue_date, l.request_date) DESC NULLS LAST LIMIT 200`,
      [req.params.outletId]
    );
    const journos = await db.query(
      "SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name FROM pr_contacts WHERE outlet_id = $1 ORDER BY last_name LIMIT 100",
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
    if (!sets.length) return res.json({ updated: 0 });
    vals.push(req.params.outletId);
    await db.query(`UPDATE pr_outlets SET ${sets.join(', ')} WHERE id = $${n}`, vals);
    res.json({ updated: 1 });
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
    const c = await db.query('SELECT * FROM pr_contacts WHERE id = $1', [req.params.contactId]);
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
    if ('available_from' in b) set('available_from', pr.parseDate(b.available_from));
    if (Array.isArray(b.beats)) set('beats', JSON.stringify(b.beats.map((t) => String(t).trim().toLowerCase()).filter(Boolean)));
    if (!sets.length) return res.json({ updated: 0 });
    vals.push(req.params.contactId);
    await db.query(`UPDATE pr_contacts SET ${sets.join(', ')} WHERE id = $${n}`, vals);
    res.json({ updated: 1 });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/contacts/:contactId/suggest-beats', async (req, res) => {
  try {
    const c = (await db.query('SELECT first_name, last_name FROM pr_contacts WHERE id = $1', [req.params.contactId])).rows[0];
    if (!c) return res.status(404).json({ error: 'Contact not found' });
    const titles = (await db.query("SELECT story_title FROM pr_editorial_log WHERE contact_id = $1 AND story_title <> '' LIMIT 40", [req.params.contactId])).rows.map((r) => r.story_title);
    res.json({ beats: await pr.suggestBeats(`${c.first_name} ${c.last_name}`.trim(), titles) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Thank-yous (assisted) ────────────────────────────────────────────────────
// Published pieces with a known journalist email, not yet thanked or skipped.
router.get('/clients/:clientId/thank-opportunities', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.id, l.story_title, l.story_url, l.issue_date, o.name AS outlet,
              TRIM(CONCAT(c.first_name,' ',c.last_name)) AS journalist
       FROM pr_editorial_log l
       JOIN pr_contacts c ON c.id = l.contact_id
       LEFT JOIN pr_outlets o ON o.id = l.outlet_id
       WHERE l.client_id = $1 AND l.status IN ('published','download')
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
       FROM pr_editorial_log l JOIN pr_contacts c ON c.id = l.contact_id WHERE l.id = $1`, [req.params.id]
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

module.exports = router;
