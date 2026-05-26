// Per-client report template — Claude-designed, account-manager-locked.
// Replaces the old checkbox + per-section instructions UI on the Reports tab.
//
// Endpoints:
//   GET  /api/clients/:id/report-template/:reportType
//        → { template, available_connectors, default_template }
//
//   POST /api/clients/:id/report-template/:reportType/chat
//        body: { history: [{ role, content }, …] }
//        → { reply, proposed }   (proposed is the JSON template draft when
//                                  Claude calls propose_template, else null)
//
//   PUT  /api/clients/:id/report-template/:reportType
//        body: { template }
//        → { ok: true }          (saves under clients.report_templates.<type>)

const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db');
const auth = require('../middleware/auth');
const reportTemplate = require('../services/reportTemplate');
const claudeService = require('../services/claude');

router.use(auth.authenticate);

const VALID_TYPES = ['weekly', 'monthly'];

async function loadClientAndConnectors(clientId) {
  const client = (await pool.query('SELECT * FROM clients WHERE id = $1', [clientId])).rows[0];
  if (!client) return { client: null, connectors: [] };
  const connectors = (await pool.query(
    'SELECT connector_type AS type, store_label AS "storeLabel", status FROM connectors WHERE client_id = $1 ORDER BY connector_type, store_label NULLS FIRST',
    [clientId]
  )).rows;
  return { client, connectors };
}

router.get('/:reportType', async (req, res) => {
  const { id, reportType } = req.params;
  if (!VALID_TYPES.includes(reportType)) return res.status(400).json({ error: 'invalid report type' });
  const { client, connectors } = await loadClientAndConnectors(id);
  if (!client) return res.status(404).json({ error: 'client not found' });
  const templates = client.report_templates || {};
  const availableTypes = Array.from(new Set(connectors.map(c => c.type)));
  res.json({
    template: templates[reportType] || null,
    default_template: reportTemplate.defaultTemplate(reportType, availableTypes),
    available_connectors: connectors,
  });
});

router.post('/:reportType/chat', async (req, res) => {
  const { id, reportType } = req.params;
  const { history } = req.body || {};
  if (!VALID_TYPES.includes(reportType)) return res.status(400).json({ error: 'invalid report type' });
  if (!Array.isArray(history) || !history.length) return res.status(400).json({ error: 'history is required' });
  const { client, connectors } = await loadClientAndConnectors(id);
  if (!client) return res.status(404).json({ error: 'client not found' });

  const currentTemplate = (client.report_templates || {})[reportType] || null;
  try {
    const { reply, proposed } = await claudeService.chatBuildReportTemplate({
      client, reportType, availableConnectors: connectors, currentTemplate, history,
    });
    res.json({ reply, proposed });
  } catch (err) {
    console.error('[report-template chat] failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:reportType', async (req, res) => {
  const { id, reportType } = req.params;
  const { template } = req.body || {};
  if (!VALID_TYPES.includes(reportType)) return res.status(400).json({ error: 'invalid report type' });
  const validationError = reportTemplate.validate(template);
  if (validationError) return res.status(400).json({ error: validationError });

  const existing = (await pool.query('SELECT report_templates FROM clients WHERE id = $1', [id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'client not found' });
  const merged = { ...(existing.report_templates || {}), [reportType]: template };
  await pool.query('UPDATE clients SET report_templates = $1 WHERE id = $2', [JSON.stringify(merged), id]);
  res.json({ ok: true, template });
});

module.exports = router;
