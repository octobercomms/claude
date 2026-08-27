// Tender Agent — admin API (Phase 1: ingest). Org-level, so it is agency-staff
// only (the read-only `client` role is blocked). Lists sources and ingested
// notices and runs the ingest on demand. Scoring, briefs and the digest arrive
// in later phases — see docs/platform/tender-agent/STACK.md.

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../db');
const { authenticate, agencyOnly } = require('../middleware/auth');
const ingest = require('../services/tender/ingest');
const { prefilter } = require('../services/tender/classify');
const tenderChat = require('../services/tender/chat');
const digest = require('../services/tender/digest');
const addByUrl = require('../services/tender/addByUrl');
const tenderProfile = require('../services/tender/profile');
const bidFiles = require('../services/tender/bidFiles');
const chatExport = require('../services/chatExport');

// Uploads for a tender's bid workspace — disk storage, one folder per notice,
// uuid filenames (originals kept in the DB row).
const bidUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => { try { cb(null, bidFiles.dirFor(req.params.id)); } catch (e) { cb(e); } },
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || '').slice(0, 12)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
});

const router = express.Router();
router.use(authenticate);
router.use(agencyOnly);

// List sources with their last poll status.
router.get('/sources', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, kind, market, enabled, last_polled_at, last_status
       FROM tender_sources ORDER BY market, name`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List notices. Filters: market, upcoming (closing in the future or unknown),
// needs_check. Newest first. Paginated with limit/offset.
router.get('/notices', async (req, res) => {
  const { market, needs_check } = req.query;
  const upcoming = req.query.upcoming === undefined ? '1' : req.query.upcoming;
  // relevance: match = creative-sector PR only (default); comms = any PR/comms;
  // all = unfiltered raw feed. The niche prefilter runs here (services/tender/classify).
  const relevance = ['match', 'comms', 'all'].includes(req.query.relevance) ? req.query.relevance : 'match';
  // verdict view: shortlist (go + review + not-yet-scored) is the default working
  // list; nogo is the rejected pile; all shows everything regardless.
  const verdictView = ['shortlist', 'go', 'nogo', 'all'].includes(req.query.verdict) ? req.query.verdict : 'shortlist';
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const where = [];
  const params = [];
  if (market) { params.push(market); where.push(`s.market = $${params.length}`); }
  if (needs_check === '1' || needs_check === 'true') where.push('n.needs_manual_check = true');
  if (upcoming === '1' || upcoming === 'true') where.push('(n.closing_at IS NULL OR n.closing_at >= NOW())');
  // Dismissed notices are hidden unless explicitly requested.
  if (req.query.dismissed !== '1' && req.query.dismissed !== 'true') where.push('n.dismissed = false');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  try {
    // Classify in-process over the most recent matching notices, then filter by
    // the requested relevance tier. Counts are returned so the UI can label each
    // view ("Creative-sector PR (12) · All PR/comms (31) · Everything (150)").
    const { rows } = await pool.query(
      `SELECT n.id, n.external_ref, n.url, n.title, n.buyer_name, n.buyer_country, n.buyer_city,
              n.cpv_codes, n.published_at, n.closing_at, n.value_min, n.value_max, n.currency,
              n.description, n.needs_manual_check, n.first_seen_at, n.verdict, n.verdict_reason,
              s.name AS source_name, s.market, s.kind AS source_kind,
              EXISTS (SELECT 1 FROM tender_chat_messages c WHERE c.notice_id = n.id) AS has_chat
       FROM tender_notices n LEFT JOIN tender_sources s ON s.id = n.source_id
       ${clause}
       ORDER BY n.first_seen_at DESC
       LIMIT 500`,
      params
    );
    // Classify over the same fields the adapter saw (incl. description) so the
    // display tier matches ingest — without description the sector words in the
    // body (e.g. "heritage, culture, tourism") are missed and a real match sinks
    // to "maybe".
    const classified = rows.map(r => {
      const c = prefilter(r);
      return { ...r, tier: c.tier, relevance_reason: c.reason };
    });
    const counts = { match: 0, maybe: 0, noise: 0, total: classified.length };
    for (const r of classified) counts[r.tier]++;

    // A notice the user added by hand is intentional — never hide it behind the
    // relevance filter (otherwise "added" but "can't find it").
    const isManual = r => r.source_kind === 'manual';
    const relKeep = relevance === 'all' ? classified
      : relevance === 'comms' ? classified.filter(r => r.tier !== 'noise' || isManual(r))
      : classified.filter(r => r.tier === 'match' || isManual(r));

    // Verdict counts over the relevance-kept set, so the dropdown labels match
    // what the current relevance view would show. Not-yet-scored counts toward
    // the shortlist (pending), so nothing hides while the backlog qualifies.
    const verdictOf = r => (['go', 'review', 'nogo'].includes(r.verdict) ? r.verdict : 'pending');
    const vcounts = { shortlist: 0, go: 0, nogo: 0 };
    for (const r of relKeep) {
      const v = verdictOf(r);
      if (v === 'nogo' && !isManual(r)) vcounts.nogo++; else vcounts.shortlist++;
      if (v === 'go') vcounts.go++;
    }

    // Manual adds always survive the verdict filter too.
    const keep = verdictView === 'all' ? relKeep
      : verdictView === 'go' ? relKeep.filter(r => verdictOf(r) === 'go' || isManual(r))
      : verdictView === 'nogo' ? relKeep.filter(r => verdictOf(r) === 'nogo' && !isManual(r))
      : relKeep.filter(r => verdictOf(r) !== 'nogo' || isManual(r)); // shortlist

    // Go first, then review/pending; within a tier, soonest-closing first.
    const vrank = { go: 0, review: 1, pending: 1, nogo: 2 };
    keep.sort((a, b) => (vrank[verdictOf(a)] - vrank[verdictOf(b)])
      || ((a.closing_at ? new Date(a.closing_at) : Infinity) - (b.closing_at ? new Date(b.closing_at) : Infinity)));

    res.json({ notices: keep.slice(0, limit), counts, vcounts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add a tender by URL — Claude reads the page, extracts the details, and it
// drops into the list like any other notice. The guaranteed path for a notice
// you've already found (esp. small below-threshold ones search can miss).
router.post('/notices/add-url', async (req, res) => {
  const url = (req.body?.url || '').trim();
  if (!/^https?:\/\/.+/i.test(url)) return res.status(400).json({ error: 'Enter a valid tender URL (https://…).' });
  try {
    const notice = await addByUrl.buildNotice(url);
    const { rows } = await pool.query("SELECT id FROM tender_sources WHERE name = 'Added by URL'");
    const sourceId = rows[0]?.id;
    if (!sourceId) return res.status(500).json({ error: 'Manual source not found — migrations may not have run.' });
    const outcome = await ingest.upsertNotice(sourceId, notice);
    if (outcome === 'expired') return res.status(400).json({ error: `That notice looks closed (deadline ${notice.closing_at ? notice.closing_at.toISOString().slice(0, 10) : 'unknown'}).` });
    res.json({ ok: true, outcome, title: notice.title, closing_at: notice.closing_at });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Qualify (run the go/no-go test) on demand. With { ids } scores those notices
// (re-runs the test); without, scores a batch of not-yet-qualified ones. Returns
// how many still need scoring so the UI can loop a "Qualify all" until 0.
router.post('/notices/qualify', async (req, res) => {
  try {
    const score = require('../services/tender/score');
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    const { scored } = ids && ids.length
      ? await score.scoreIds(ids, { log: (m) => console.log(m) })
      : await score.scoreUnscored({ limit: 20, log: (m) => console.log(m) });
    const remaining = await score.pendingCount();
    res.json({ scored, remaining });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Dismiss several notices at once (bulk "Dismiss selected").
router.post('/notices/dismiss-bulk', async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'No notices selected.' });
  try {
    const { rowCount } = await pool.query(
      'UPDATE tender_notices SET dismissed = true, dismissed_at = NOW() WHERE id::text = ANY($1::text[])', [ids]
    );
    res.json({ ok: true, dismissed: rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Trigger an ingest run now. Optional body { source_id } to poll one source.
// Long-running (network + rate limits), so this awaits and returns the summary;
// the cron does the same on a schedule.
router.post('/ingest/run', async (req, res) => {
  try {
    const sourceId = req.body?.source_id || null;
    const report = await ingest.run({ sourceId, log: (m) => console.log(m) });
    res.json(report);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Dismiss a notice so it never shows again (and won't be emailed). Reversible.
router.post('/notices/:id/dismiss', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'UPDATE tender_notices SET dismissed = true, dismissed_at = NOW() WHERE id = $1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Notice not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/notices/:id/restore', async (req, res) => {
  try {
    await pool.query('UPDATE tender_notices SET dismissed = false, dismissed_at = NULL WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Digest settings — auto-email new matching tenders.
router.get('/settings', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT digest_enabled, digest_email, last_digest_at FROM tender_settings WHERE id = 1');
    res.json(rows[0] || { digest_enabled: false, digest_email: null, last_digest_at: null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/settings', async (req, res) => {
  const enabled = !!req.body?.digest_enabled;
  const email = (req.body?.digest_email || '').trim() || null;
  if (enabled && !email) return res.status(400).json({ error: 'An email address is required to turn alerts on.' });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'That email address looks invalid.' });
  try {
    const { rows } = await pool.query(
      `UPDATE tender_settings SET digest_enabled = $1, digest_email = $2, updated_at = NOW() WHERE id = 1
       RETURNING digest_enabled, digest_email, last_digest_at`,
      [enabled, email]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// Send the digest now (on-demand / test), even if the toggle is off.
router.post('/digest/run', async (_req, res) => {
  try { res.json(await digest.runDigest({ force: true, log: (m) => console.log(m) })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// The October bid profile — shared cross-bid memory the workspace reads/edits.
router.get('/profile', async (_req, res) => {
  try { res.json(await tenderProfile.get()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/profile', async (req, res) => {
  try { res.json(await tenderProfile.set(req.body?.profile_md)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/profile/append', async (req, res) => {
  try { res.json(await tenderProfile.append(req.body?.snippet)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
// Structured company details (SQ facts) + the field list the form renders.
router.get('/profile/company-fields', (_req, res) => res.json(tenderProfile.COMPANY_FIELDS));
router.put('/profile/company', async (req, res) => {
  try { res.json(await tenderProfile.setCompany(req.body?.company)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// A single notice (for the workspace page header).
router.get('/notices/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.*, s.name AS source_name, s.market FROM tender_notices n
       LEFT JOIN tender_sources s ON s.id = n.source_id WHERE n.id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Notice not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Set / edit a notice's closing date — fill one in when it couldn't be parsed
// ("deadline?"), or correct it if the buyer moves the deadline. Clearing it
// (null) flags it for manual check again.
router.put('/notices/:id/closing', async (req, res) => {
  if (!('closing_at' in (req.body || {}))) return res.status(400).json({ error: 'closing_at required' });
  const raw = req.body.closing_at;
  const d = raw ? new Date(raw) : null;
  if (raw && (!(d instanceof Date) || isNaN(d.getTime()))) return res.status(400).json({ error: 'That date could not be read — use YYYY-MM-DD.' });
  try {
    const { rows } = await pool.query(
      `UPDATE tender_notices
         SET closing_at = $1, needs_manual_check = CASE WHEN $1 IS NULL THEN true ELSE false END, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [d, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Notice not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// "Learn from this bid" — propose durable additions to the shared profile.
router.post('/notices/:id/profile-suggestion', async (req, res) => {
  try { res.json(await tenderChat.suggestProfileUpdate(req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Per-notice chat — "Start / Continue with Claude" (fit, plan, draft deliverables).
router.get('/notices/:id/chat', async (req, res) => {
  try { res.json(await tenderChat.history(req.params.id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/notices/:id/chat', async (req, res) => {
  try { res.json(await tenderChat.send(req.params.id, req.body?.message)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Export one chat message (a produced deliverable) as a downloadable doc.
router.get('/notices/:id/chat/:messageId/export', async (req, res) => {
  const fmt = req.query.format === 'pdf' ? 'pdf' : 'docx';
  try {
    const { rows } = await pool.query('SELECT content FROM tender_chat_messages WHERE id = $1 AND notice_id = $2', [req.params.messageId, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Message not found' });
    const { rows: n } = await pool.query('SELECT title FROM tender_notices WHERE id = $1', [req.params.id]);
    const title = n[0]?.title || 'Tender bid';
    const opts = { title, clientName: 'October Communications', generatedAt: new Date() };
    const safe = title.replace(/[^a-z0-9]+/gi, '-').slice(0, 60).replace(/^-|-$/g, '') || 'bid';
    if (fmt === 'pdf') {
      const buf = await chatExport.markdownToPdfBuffer(rows[0].content || '', opts);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safe}.pdf"`);
      return res.send(buf);
    }
    const buf = await chatExport.markdownToDocxBuffer(rows[0].content || '', opts);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.docx"`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Workspace files — upload / list / download / delete.
router.get('/notices/:id/files', async (req, res) => {
  try { res.json(await bidFiles.list(req.params.id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/notices/:id/files', bidUpload.array('files', 10), async (req, res) => {
  try {
    const saved = [];
    for (const f of req.files || []) {
      saved.push(await bidFiles.record(req.params.id, {
        filename: f.originalname, stored_name: f.filename, mime: f.mimetype, size_bytes: f.size,
      }));
    }
    res.json({ ok: true, files: saved });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/files/:fileId/download', async (req, res) => {
  try {
    const row = await bidFiles.getRow(req.params.fileId);
    if (!row) return res.status(404).json({ error: 'File not found' });
    const fp = path.join(bidFiles.dirFor(row.notice_id), row.stored_name);
    if (!fp.startsWith(bidFiles.ROOT + path.sep)) return res.status(400).json({ error: 'Invalid path' });
    res.download(fp, row.filename);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/files/:fileId', async (req, res) => {
  try {
    const ok = await bidFiles.remove(req.params.fileId);
    if (!ok) return res.status(404).json({ error: 'File not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
