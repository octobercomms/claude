// AEO tracker API — /api/ai-visibility. Mirrors the standard
// authenticated-per-tenant pattern.

const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const users = require('../services/users');
const aiVisibility = require('../services/aiVisibility');
const aiVisibilityReport = require('../services/aiVisibilityReport');
const pdfService = require('../services/pdfService');
const claudeService = require('../services/claude');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

router.param('promptId', async (req, res, next, id) => {
  try {
    const { rows } = await pool.query('SELECT client_id FROM ai_visibility_prompts WHERE id = $1', [id]);
    if (rows.length && !users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised for this prompt' });
    }
    next();
  } catch (err) { next(err); }
});

router.get('/clients/:clientId/prompts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, prompt, category, active, created_at
         FROM ai_visibility_prompts WHERE client_id = $1 ORDER BY created_at ASC`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/prompts', async (req, res) => {
  const { prompt, category } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO ai_visibility_prompts (client_id, prompt, category) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.clientId, prompt.slice(0, 240), category || null]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/prompts/:promptId', async (req, res) => {
  const { prompt, category, active } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE ai_visibility_prompts
          SET prompt = COALESCE($1, prompt),
              category = COALESCE($2, category),
              active = COALESCE($3, active)
        WHERE id = $4 RETURNING *`,
      [prompt ? prompt.slice(0, 240) : null, category ?? null, active ?? null, req.params.promptId]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/prompts/:promptId', async (req, res) => {
  try {
    await pool.query(`DELETE FROM ai_visibility_prompts WHERE id = $1`, [req.params.promptId]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Generate a starter set of prompts via Claude — AM picks which to
// keep, then bulk-creates the survivors.
router.post('/clients/:clientId/prompts/generate', async (req, res) => {
  try {
    const prompts = await aiVisibility.generatePromptsForClient(req.params.clientId);
    res.json({ prompts });
  } catch (err) {
    console.error('[aeo] generate failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Bulk-create prompts. Used after the generate step.
router.post('/clients/:clientId/prompts/bulk', async (req, res) => {
  const { prompts } = req.body || {};
  if (!Array.isArray(prompts) || !prompts.length) return res.status(400).json({ error: 'prompts array required' });
  try {
    const created = [];
    for (const p of prompts) {
      const text = String(p?.prompt || p || '').trim();
      if (!text) continue;
      const { rows } = await pool.query(
        `INSERT INTO ai_visibility_prompts (client_id, prompt, category) VALUES ($1, $2, $3) RETURNING id, prompt`,
        [req.params.clientId, text.slice(0, 240), (p?.category || null)]
      );
      created.push(rows[0]);
    }
    res.json({ created });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manual trigger — runs every active prompt across every engine. This is a long
// job (prompts × engines API calls), so it runs in the BACKGROUND and returns
// immediately; the panel polls /run-status + reloads to show progress.
router.post('/clients/:clientId/run', async (req, res) => {
  try {
    const r = await aiVisibility.startRunInBackground(req.params.clientId);
    if (r.already) return res.status(202).json({ started: false, running: true, message: 'A check is already running.' });
    if (!r.started) return res.status(400).json({ error: 'No active prompts to run yet — add or generate some first.' });
    res.status(202).json({ started: true, total: r.total });
  } catch (err) {
    console.error('[aeo] run failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Poll: is a background check running, and how far through is it?
router.get('/clients/:clientId/run-status', async (req, res) => {
  const p = aiVisibility.getProgress(req.params.clientId);
  res.json({ running: aiVisibility.isRunning(req.params.clientId), done: p?.done || 0, total: p?.total || 0 });
});

// Latest runs — used by the AM-facing list view.
router.get('/clients/:clientId/runs', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  try {
    const { rows } = await pool.query(
      `SELECT id, prompt_text, engine, response_text, brand_mentioned, brand_position,
              competitor_mentions, sentiment, fetched_at
         FROM ai_visibility_runs
        WHERE client_id = $1
        ORDER BY fetched_at DESC
        LIMIT $2`,
      [req.params.clientId, limit]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/clients/:clientId/summary', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const summary = await aiVisibility.summarise(req.params.clientId, { days });
    res.json(summary);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/clients/:clientId/trend', async (req, res) => {
  try {
    const weeks = Math.min(parseInt(req.query.weeks) || 12, 52);
    const trend = await aiVisibility.getTrend(req.params.clientId, { weeks });
    res.json(trend);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Branded, client-facing PDF of the visibility picture. Cookie-authed like every
// route here, so the frontend can link to it with a plain <a download>.
router.get('/clients/:clientId/report.pdf', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, domain FROM clients WHERE id = $1', [req.params.clientId]);
    const client = rows[0];
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const data = await aiVisibility.reportData(req.params.clientId, { days });
    if (!data.summary.total_runs) return res.status(400).json({ error: 'No visibility runs yet — run the check first, then export.' });

    // Best-effort consultant summary; the report renders fine without it.
    let aiSummary = null;
    try {
      const p = aiVisibilityReport.buildSummaryPrompt({ client, data });
      aiSummary = await claudeService.callClaude({ max_tokens: 400, system: p.system, user: p.user, feature: 'ai_visibility_summary', clientId: client.id });
    } catch (e) { console.error('[ai-visibility] summary failed:', e.message); }

    const html = aiVisibilityReport.buildHtml({ client, data, aiSummary });
    const pdf = await pdfService.generatePDFBuffer(html);
    const slug = String(client.name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'client';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ai-visibility-${slug}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('[ai-visibility] report failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
