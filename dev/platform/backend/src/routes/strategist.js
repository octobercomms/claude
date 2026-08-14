const express = require('express');
const fs = require('fs');
const { marked } = require('marked');
const router = express.Router();
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, assertClientAccess } = require('../middleware/clientAccess');
const strategistReport = require('../services/strategistReport');
const briefing = require('../services/strategist/briefing');
const briefingExport = require('../services/strategist/briefingExport');
const pdfService = require('../services/pdfService');

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

// PDF rendering — same masthead + footer chrome as the client-facing
// reports, but body is the Strategist's markdown. Streams the file inline
// so the browser previews it; the AM can hit ⌘S to keep a copy.
router.get('/reports/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT r.*, cl.name AS client_name FROM strategist_reports r JOIN clients cl ON cl.id = r.client_id WHERE r.id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    const report = rows[0];
    assertClientAccess(req, report.client_id);
    if (report.status !== 'completed' || !report.markdown) {
      return res.status(400).json({ error: 'Report not ready' });
    }

    const period = `${new Date(report.period_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} – ${new Date(report.period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const markdownHtml = marked.parse(report.markdown, { gfm: true, breaks: false });
    const html = pdfService.buildStrategistReportHtml({
      clientName: report.client_name,
      period,
      markdownHtml,
    });
    const footerLines = [
      'Internal · Strategist briefing for the AM — not for client distribution.',
      process.env.REPORT_FOOTER_LINE_2,
      process.env.REPORT_FOOTER_LINE_3,
    ].filter(Boolean);
    const pdfPath = await pdfService.generatePDF(`strategist-${report.id}`, html, { printFooter: true, footerLines });

    const safeClient = String(report.client_name || 'client').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="strategist-${safeClient}-${report.period_end}.pdf"`);
    fs.createReadStream(pdfPath).pipe(res);
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

// On-demand email — same payload as the Monday cron job. Lets the AM
// preview / re-send a briefing without waiting for the next Monday.
// Recipients resolution: explicit body.to override → client's
// strategist_recipients → STRATEGIST_RECIPIENTS env var.
router.post('/reports/:id/email', async (req, res) => {
  const { to: toOverride } = req.body || {};
  try {
    const { rows: rows1 } = await pool.query(
      `SELECT r.id, r.client_id, r.period_start, r.period_end, r.markdown,
              c.name AS client_name, c.strategist_recipients
         FROM strategist_reports r JOIN clients c ON c.id = r.client_id
        WHERE r.id = $1`,
      [req.params.id]
    );
    if (!rows1.length) return res.status(404).json({ error: 'Report not found' });
    const r = rows1[0];
    const { rows: actionRows } = await pool.query(
      `SELECT text FROM strategist_recommendations WHERE report_id = $1 ORDER BY position ASC`,
      [r.id]
    );
    const envRecipients = (process.env.STRATEGIST_RECIPIENTS || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const clientRecipients = (r.strategist_recipients || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const overrideRecipients = (toOverride || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const to = overrideRecipients.length ? overrideRecipients : (clientRecipients.length ? clientRecipients : envRecipients);
    if (!to.length) return res.status(400).json({ error: 'No recipients configured. Add some to the Recipients box on this client, or set STRATEGIST_RECIPIENTS in the server .env.' });
    const period = r.period_start && r.period_end ? `${r.period_start} – ${r.period_end}` : '';
    const platformUrl = process.env.PLATFORM_URL || '';
    const reportUrl = platformUrl ? `${platformUrl}/clients/${r.client_id}/ads?tab=strategist&report=${r.id}` : null;
    const emailService = require('../services/emailService');
    await emailService.sendStrategistBriefing({
      to, clientName: r.client_name, period,
      markdown: r.markdown || '_Briefing has no content._',
      recommendations: actionRows.map(a => a.text),
      reportUrl,
    });
    res.json({ ok: true, sent_to: to });
  } catch (err) {
    console.error('[strategist] manual email failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Recommendation checklist ────────────────────────────────────
// Each row in strategist_recommendations is one numbered item parsed
// from the briefing's Recommendations section. AM ticks them off; next
// week's briefing knows what was done.

router.get('/reports/:id/actions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, position, text, done, done_at, done_by, notes
         FROM strategist_recommendations
        WHERE report_id = $1 ORDER BY position ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/actions/:id', async (req, res) => {
  const { done, notes } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE strategist_recommendations
          SET done = COALESCE($1, done),
              notes = COALESCE($2, notes),
              done_at = CASE
                WHEN $1 IS TRUE  AND done = false THEN NOW()
                WHEN $1 IS FALSE THEN NULL
                ELSE done_at END,
              done_by = CASE
                WHEN $1 IS TRUE  AND done = false THEN $3
                WHEN $1 IS FALSE THEN NULL
                ELSE done_by END
        WHERE id = $4
        RETURNING id, position, text, done, done_at, done_by, notes`,
      [typeof done === 'boolean' ? done : null, notes ?? null, req.user?.id || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Action not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Unified cross-PESO briefing ─────────────────────────────────────────────
// A whole-client briefing (Paid/Earned/Shared/Owned + synthesis) with one
// prioritised, pillar-tagged task list. See services/strategist/briefing.js.

router.post('/clients/:clientId/briefing/generate', async (req, res) => {
  const days = Math.max(7, Math.min(120, parseInt(req.body?.days, 10) || 30));
  try {
    const id = await briefing.generate({ clientId: req.params.clientId, days, trigger: 'manual' });
    const { rows } = await pool.query('SELECT * FROM strategist_briefings WHERE id = $1', [id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/clients/:clientId/briefings', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, period_start, period_end, generated_at, status, trigger, read_at, error_message,
              CASE WHEN synthesis IS NULL THEN 0 ELSE LENGTH(synthesis) END AS synthesis_len
         FROM strategist_briefings WHERE client_id = $1
        ORDER BY generated_at DESC LIMIT 50`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/briefings/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM strategist_briefings WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Briefing not found' });
    assertClientAccess(req, rows[0].client_id);
    const { rows: recs } = await pool.query(
      `SELECT id, pillar, priority, position, text, done, done_at, notes
         FROM strategist_briefing_recommendations WHERE briefing_id = $1
        ORDER BY position ASC`, [req.params.id]);
    res.json({ ...rows[0], recommendations: recs });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Download a briefing as a branded document. Two audiences:
//   ?audience=internal (default) — the verbatim briefing: synthesis, per-pillar
//     analysis, task list and the data appendix. For the account lead.
//   ?audience=client — a Claude reframe as a client-facing progress report
//     (cached; ?refresh=1 regenerates). Meant to be edited before sending.
// Format is pdf or docx (Word — editable). Reuses the report export engine.
router.get('/briefings/:id/export.:format(pdf|docx)', async (req, res) => {
  const { id, format } = req.params;
  const audience = req.query.audience === 'client' ? 'client' : 'internal';
  try {
    const { rows } = await pool.query(
      `SELECT b.*, cl.name AS client_name FROM strategist_briefings b
         JOIN clients cl ON cl.id = b.client_id WHERE b.id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Briefing not found' });
    const b = rows[0];
    assertClientAccess(req, b.client_id);
    if (b.status !== 'completed') return res.status(400).json({ error: 'Briefing not ready' });

    let markdown, title;
    if (audience === 'client') {
      markdown = await briefing.clientReport(id, { force: req.query.refresh === '1' });
      title = `${b.client_name} — Marketing update`;
    } else {
      const { rows: recs } = await pool.query(
        `SELECT pillar, priority, position, text, done FROM strategist_briefing_recommendations
          WHERE briefing_id = $1 ORDER BY position ASC`, [id]);
      markdown = briefingExport.internalMarkdown({ briefing: b, recommendations: recs });
      title = `${b.client_name} — Strategist briefing`;
    }

    const chatExport = require('../services/chatExport');
    const generatedAt = b.generated_at ? new Date(b.generated_at) : new Date();
    const safe = String(b.client_name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const filename = `${safe}-strategist-${audience}-${b.period_end || 'report'}.${format}`;

    if (format === 'pdf') {
      const buf = await chatExport.markdownToPdfBuffer(markdown, { title, clientName: b.client_name, generatedAt });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buf);
    }
    const buf = await chatExport.markdownToDocxBuffer(markdown, { title, clientName: b.client_name, generatedAt });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (err) {
    console.error('[strategist] briefing export failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/briefings/:id/read', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT client_id FROM strategist_briefings WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Briefing not found' });
    assertClientAccess(req, rows[0].client_id);
    await pool.query('UPDATE strategist_briefings SET read_at = COALESCE(read_at, NOW()) WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/briefings/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT client_id FROM strategist_briefings WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).end();
    assertClientAccess(req, rows[0].client_id);
    await pool.query('DELETE FROM strategist_briefings WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Tick a task off the account-wide list.
router.patch('/briefing-actions/:id', async (req, res) => {
  const { done, notes } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE strategist_briefing_recommendations
          SET done = COALESCE($1, done),
              notes = COALESCE($2, notes),
              done_at = CASE WHEN $1 IS TRUE AND done = false THEN NOW() WHEN $1 IS FALSE THEN NULL ELSE done_at END,
              done_by = CASE WHEN $1 IS TRUE AND done = false THEN $3 WHEN $1 IS FALSE THEN NULL ELSE done_by END
        WHERE id = $4
        RETURNING id, pillar, priority, position, text, done, done_at, notes`,
      [typeof done === 'boolean' ? done : null, notes ?? null, req.user?.id || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Action not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Weekly-email opt-out toggle for this client.
router.put('/clients/:clientId/active', async (req, res) => {
  try {
    const active = !!req.body?.active;
    await pool.query('UPDATE clients SET strategist_active = $1 WHERE id = $2', [active, req.params.clientId]);
    res.json({ ok: true, strategist_active: active });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
