// Microsoft Clarity → CRO. Clarity is a free behaviour-analytics tool
// (heatmaps + session recordings). Its Data Export API returns the behaviour
// signals that reveal where a funnel leaks — rage clicks, dead clicks,
// excessive scroll, quick-backs, scroll depth, engagement, JS errors — broken
// down by page. We pull those for a client and have Claude turn them into
// prioritised, concrete on-page fixes (the "ads are fine, the funnel leaks"
// diagnosis). No paid connector — Clarity and its export API are free.
//
// API: GET https://www.clarity.ms/export-data/api/v1/project-live-insights
//      Bearer token (Clarity → Settings → Data Export → generate token).
//      numOfDays 1–3, up to 3 dimensions, 10 calls/day.

const axios = require('axios');
const pool = require('../db');
const { encrypt, decrypt } = require('../utils/encryption');
const claudeService = require('./claude');

const CLARITY_API = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';

function badRequest(msg) { const e = new Error(msg); e.status = 400; throw e; }

function parseJson(raw) {
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error('Clarity CRO returned malformed JSON.'); }
}

async function getConfig(clientId) {
  const { rows } = await pool.query('SELECT updated_at FROM client_clarity WHERE client_id = $1', [clientId]);
  return { connected: rows.length > 0, updated_at: rows[0]?.updated_at || null };
}

async function setToken(clientId, token) {
  const t = String(token || '').trim();
  if (!t) badRequest('A Clarity API token is required.');
  const enc = encrypt(t);
  await pool.query(
    `INSERT INTO client_clarity (client_id, token_encrypted) VALUES ($1, $2)
     ON CONFLICT (client_id) DO UPDATE SET token_encrypted = $2, updated_at = NOW()`,
    [clientId, JSON.stringify(enc)]
  );
  return getConfig(clientId);
}

async function clearToken(clientId) {
  await pool.query('DELETE FROM client_clarity WHERE client_id = $1', [clientId]);
}

async function loadToken(clientId) {
  const { rows } = await pool.query('SELECT token_encrypted FROM client_clarity WHERE client_id = $1', [clientId]);
  if (!rows.length) badRequest('Connect a Microsoft Clarity API token first.');
  return decrypt(rows[0].token_encrypted);
}

// One call covers all metrics for the chosen dimension. We key by URL so the
// fixes are page-specific. Resilient to the API's exact field naming — the
// raw rows are passed through to Claude.
async function fetchInsights(token, { numOfDays = 3, dimension1 = 'URL' } = {}) {
  const res = await axios.get(CLARITY_API, {
    params: { numOfDays, dimension1 },
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000,
    validateStatus: () => true,
  });
  if (res.status === 401 || res.status === 403) badRequest('Clarity rejected the API token — regenerate it in Clarity → Settings → Data Export.');
  if (res.status === 429) { const e = new Error('Clarity API daily limit reached (10 calls/day). Try again tomorrow.'); e.status = 429; throw e; }
  if (res.status >= 400 || !Array.isArray(res.data)) { const e = new Error(`Clarity API error (HTTP ${res.status}).`); e.status = 502; throw e; }
  return res.data;
}

const SYSTEM =
  'You are a senior conversion-rate-optimisation analyst. From Microsoft Clarity behaviour signals ' +
  '(rage clicks, dead clicks, excessive scroll, quick-backs, scroll depth, engagement time, JS errors) ' +
  'you find where a funnel leaks and give prioritised, concrete on-page fixes. British English. JSON only — no prose, no fences.';

function buildPrompt(metrics) {
  return `Microsoft Clarity behaviour data (last 3 days), per page URL:
"""
${JSON.stringify(metrics).slice(0, 14000)}
"""

Identify where users struggle and drop off, and give concrete fixes. Return ONLY:
{"summary":"2–3 sentence read of overall funnel health","findings":[{"priority":"critical|high|medium","url":"the page","issue":"what's wrong, citing the specific signal (e.g. 'high rage clicks on Add to Cart')","fix":"the concrete change to make"}]}

Rules:
- 4–8 findings, ordered worst-first.
- Every finding must cite the Clarity signal it's based on.
- Fixes must be specific and execution-ready (no generic advice like "improve UX").`;
}

async function runReport(clientId) {
  const token = await loadToken(clientId);
  const raw = await fetchInsights(token, { numOfDays: 3, dimension1: 'URL' });
  // Compact: metric name + the top rows of each breakdown (bounds the prompt).
  const metrics = raw.map(m => ({ metric: m.metricName || m.metric || 'metric', rows: (m.information || []).slice(0, 15) }));
  const hasData = metrics.some(m => m.rows.length);
  if (!hasData) { const e = new Error('Clarity returned no behaviour data yet — the project may be new or have low traffic. Give it a few days of visits.'); e.status = 400; throw e; }

  const out = parseJson(await claudeService.callClaude({
    max_tokens: 2500, system: SYSTEM, user: buildPrompt(metrics), feature: 'clarity_cro', clientId,
  }));
  const findings = Array.isArray(out.findings)
    ? out.findings.map(f => ({
        priority: ['critical', 'high', 'medium'].includes(f.priority) ? f.priority : 'medium',
        url: f.url || null, issue: f.issue || null, fix: f.fix || null,
        done: false,   // per-finding completion, toggled from the CRO panel
      })).filter(f => f.issue || f.fix).slice(0, 12)
    : [];
  const { rows } = await pool.query(
    `INSERT INTO clarity_cro_reports (client_id, summary, signals, findings)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [clientId, out.summary || null, JSON.stringify(metrics), JSON.stringify(findings)]
  );
  return rows[0];
}

async function latestReport(clientId) {
  const { rows } = await pool.query(
    'SELECT * FROM clarity_cro_reports WHERE client_id = $1 ORDER BY generated_at DESC LIMIT 1', [clientId]
  );
  return rows[0] || null;
}

// Toggle the `done` flag on one finding of a report. Scoped to the client id
// (the route already enforces client access) so a report can only be touched
// by someone who can see its client. Rewrites the whole findings array — small
// (≤12 items) so it's cheaper than a jsonb_set and avoids type assumptions.
async function setFindingDone(clientId, reportId, index, done) {
  const { rows } = await pool.query(
    'SELECT findings FROM clarity_cro_reports WHERE id = $1 AND client_id = $2', [reportId, clientId]
  );
  if (!rows[0]) { const e = new Error('Report not found.'); e.status = 404; throw e; }
  const findings = Array.isArray(rows[0].findings) ? rows[0].findings : [];
  if (!Number.isInteger(index) || index < 0 || index >= findings.length) {
    const e = new Error('Finding not found.'); e.status = 404; throw e;
  }
  findings[index] = { ...findings[index], done: !!done };
  const { rows: upd } = await pool.query(
    'UPDATE clarity_cro_reports SET findings = $1 WHERE id = $2 AND client_id = $3 RETURNING *',
    [JSON.stringify(findings), reportId, clientId]
  );
  return upd[0];
}

module.exports = { getConfig, setToken, clearToken, runReport, latestReport, setFindingDone };
