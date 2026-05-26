// Server-side proxy for the October Forms API. Keeps the X-OCF-Api-Key
// strictly in the backend (encrypted in the connectors table) and gates
// access through the existing client/connector authorisation.

const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { decrypt } = require('../utils/encryption');
const octoberForms = require('../connectors/october_forms');

const router = express.Router();
router.use(authenticate);

async function loadConnector(connectorId) {
  const { rows } = await pool.query(
    'SELECT id, client_id, connector_type, status, credentials, config FROM connectors WHERE id = $1',
    [connectorId]
  );
  if (!rows.length) return { error: 'Connector not found', status: 404 };
  const row = rows[0];
  if (row.connector_type !== 'october_forms') return { error: 'Not an October Forms connector', status: 400 };
  if (!row.credentials || row.credentials === '{}') return { error: 'Connector has no credentials', status: 400 };
  const creds = decrypt(row.credentials);
  if (!creds) return { error: 'Could not decrypt credentials', status: 500 };
  return { row, creds };
}

function requireFormId(row, res) {
  const formId = row.config?.value;
  if (!formId) {
    res.status(400).json({ error: 'No form selected for this connector — pick a form in the connector config.' });
    return null;
  }
  return formId;
}

function handleProxyError(res, err, context) {
  const status = err.response?.status;
  const detail = err.response?.data?.message || err.response?.data?.error?.message || err.message;
  console.error(`October Forms proxy [${context}]:`, status, detail);
  res.status(status || 502).json({
    error: typeof detail === 'string' ? detail : JSON.stringify(detail),
    upstream_status: status || null,
  });
}

// KPIs for the selected form over a date range
router.get('/connectors/:id/stats', async (req, res) => {
  try {
    const { row, creds, error, status } = await loadConnector(req.params.id);
    if (error) return res.status(status).json({ error });
    const formId = requireFormId(row, res); if (!formId) return;
    const { from, to } = req.query;
    const data = await octoberForms.getStats(creds, formId, from, to);
    res.json(data);
  } catch (err) { handleProxyError(res, err, 'stats'); }
});

// Step-by-step drop-off
router.get('/connectors/:id/funnel', async (req, res) => {
  try {
    const { row, creds, error, status } = await loadConnector(req.params.id);
    if (error) return res.status(status).json({ error });
    const formId = requireFormId(row, res); if (!formId) return;
    const { from, to } = req.query;
    const data = await octoberForms.getFunnel(creds, formId, from, to);
    res.json(data);
  } catch (err) { handleProxyError(res, err, 'funnel'); }
});

// Daily counts for views / starts / completes
router.get('/connectors/:id/timeseries', async (req, res) => {
  try {
    const { row, creds, error, status } = await loadConnector(req.params.id);
    if (error) return res.status(status).json({ error });
    const formId = requireFormId(row, res); if (!formId) return;
    const { from, to } = req.query;
    const data = await octoberForms.getTimeseries(creds, formId, from, to);
    res.json(data);
  } catch (err) { handleProxyError(res, err, 'timeseries'); }
});

// Paginated submissions list (no answer payloads)
router.get('/connectors/:id/submissions', async (req, res) => {
  try {
    const { row, creds, error, status } = await loadConnector(req.params.id);
    if (error) return res.status(status).json({ error });
    const formId = requireFormId(row, res); if (!formId) return;
    const { from, to, status: subStatus, limit, offset } = req.query;
    const data = await octoberForms.getSubmissions(creds, formId, { from, to, status: subStatus, limit, offset });
    res.json(data);
  } catch (err) { handleProxyError(res, err, 'submissions'); }
});

// Full single submission — answers_table + files
router.get('/connectors/:id/submissions/:submissionId', async (req, res) => {
  try {
    const { creds, error, status } = await loadConnector(req.params.id);
    if (error) return res.status(status).json({ error });
    const data = await octoberForms.getSubmission(creds, req.params.submissionId);
    res.json(data);
  } catch (err) { handleProxyError(res, err, 'submission'); }
});

module.exports = router;
