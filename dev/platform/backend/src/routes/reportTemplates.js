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
const multer = require('multer');
const router = express.Router({ mergeParams: true });
const pool = require('../db');
const auth = require('../middleware/auth');
const reportTemplate = require('../services/reportTemplate');
const claudeService = require('../services/claude');

router.use(auth.authenticate);

const VALID_TYPES = ['weekly', 'monthly'];

// In-memory upload for the optional PDF/image attachment on the chat
// endpoint. Cap at 25MB — Anthropic accepts up to 32MB PDFs, and we
// don't want oversized uploads tying up the event loop in base64
// encoding.
const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}. Attach a PDF or image.`));
  },
});

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

// Chat endpoint — accepts either JSON (text-only) or multipart (with an
// optional PDF/image attachment). When multipart, `history` arrives as a
// JSON-encoded form field and `attachment` is the file. Multer runs only
// when the request is multipart; for JSON bodies it's a no-op and the
// existing express.json middleware handles parsing.
function handleChatUpload(req, res, next) {
  chatUpload.single('attachment')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

router.post('/:reportType/chat', handleChatUpload, async (req, res) => {
  const { id, reportType } = req.params;
  let history;
  if (typeof req.body?.history === 'string') {
    try { history = JSON.parse(req.body.history); }
    catch { return res.status(400).json({ error: 'history must be valid JSON' }); }
  } else {
    history = req.body?.history;
  }
  if (!VALID_TYPES.includes(reportType)) return res.status(400).json({ error: 'invalid report type' });
  if (!Array.isArray(history) || !history.length) return res.status(400).json({ error: 'history is required' });
  const { client, connectors } = await loadClientAndConnectors(id);
  if (!client) return res.status(404).json({ error: 'client not found' });

  const attachment = req.file
    ? { buffer: req.file.buffer, mimeType: req.file.mimetype, filename: req.file.originalname }
    : null;

  const currentTemplate = (client.report_templates || {})[reportType] || null;
  try {
    const { reply, proposed } = await claudeService.chatBuildReportTemplate({
      client, reportType, availableConnectors: connectors, currentTemplate, history, attachment,
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
