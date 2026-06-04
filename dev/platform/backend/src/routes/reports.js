const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const reportService = require('../services/reportService');
const users = require('../services/users');
const dataCollector = require('../services/dataCollector');
const reportTemplate = require('../services/reportTemplate');
const templateRenderer = require('../services/templateRenderer');
const pdfService = require('../services/pdfService');
const previewCache = require('../services/previewCache');

const router = express.Router();

// Short-lived signed token for opening a report HTML in a new tab. We can't
// send a Bearer header through window.open, so the frontend asks for a
// signed URL via the authenticated /preview-url endpoint and then opens
// /:id/html?token=<sig>. The signature binds the report id and an expiry
// so the URL can't be reused or modified.
function signReportToken(reportId, expiresAtSec) {
  const payload = `${reportId}.${expiresAtSec}`;
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('hex');
  return `${expiresAtSec}.${sig}`;
}
function verifyReportToken(reportId, token) {
  if (!token || typeof token !== 'string') return false;
  const [expStr, sig] = token.split('.');
  if (!expStr || !sig) return false;
  const exp = parseInt(expStr, 10);
  if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${reportId}.${exp}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
  } catch { return false; }
}

// HTML preview — accepts EITHER a short-lived signed token (for
// window.open) OR a Bearer JWT (for direct API callers). Without one of
// these, the report is not served.
router.get('/:id/html', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT client_id, html_content FROM reports WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Report not found');
    const row = rows[0];

    let authorised = false;
    if (req.query.token && verifyReportToken(req.params.id, req.query.token)) {
      authorised = true;
    } else {
      // Fall through to Bearer auth + visibility check
      await new Promise((resolve, reject) => authenticate(req, res, err => err ? reject(err) : resolve()));
      if (res.headersSent) return;
      const visible = await users.getVisibleClientIds(req.user);
      authorised = users.canAccessClient(visible, row.client_id);
    }
    if (!authorised) return res.status(403).send('Not authorised for this report');
    if (!row.html_content) return res.status(404).send('HTML not available');
    res.type('html').send(row.html_content);
  } catch (err) {
    if (res.headersSent) return;
    res.status(500).send(err.message);
  }
});

router.use(authenticate);

// Load the caller's client visibility (admin → null sentinel = all).
router.use(async (req, res, next) => {
  try {
    req.visibleClientIds = await users.getVisibleClientIds(req.user);
    next();
  } catch (err) {
    next(err);
  }
});

// Mint a short-lived signed URL for opening the HTML in a new tab.
router.get('/:id/preview-url', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT client_id FROM reports WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    if (!users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised for this report' });
    }
    const expiresAt = Math.floor(Date.now() / 1000) + 300;     // 5 minutes
    const token = signReportToken(req.params.id, expiresAt);
    res.json({ url: `/api/reports/${req.params.id}/html?token=${encodeURIComponent(token)}`, expires_at: expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List reports — scoped to the caller's visible clients
router.get('/', async (req, res) => {
  try {
    const { client_id, status, limit = 50, offset = 0 } = req.query;
    if (client_id && !users.canAccessClient(req.visibleClientIds, client_id)) {
      return res.status(403).json({ error: 'Not authorised for this client' });
    }
    let query = `
      SELECT r.*, c.name as client_name
      FROM reports r
      JOIN clients c ON c.id = r.client_id
      WHERE 1=1
    `;
    const params = [];
    if (client_id) { params.push(client_id); query += ` AND r.client_id = $${params.length}`; }
    if (req.visibleClientIds !== null) {
      if (!req.visibleClientIds.length) return res.json([]);
      params.push(req.visibleClientIds);
      query += ` AND r.client_id = ANY($${params.length})`;
    }
    if (status) { params.push(status); query += ` AND r.status = $${params.length}`; }
    params.push(limit, offset);
    query += ` ORDER BY r.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single report — checked against caller's visibility
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT r.*, c.name as client_name FROM reports r JOIN clients c ON c.id = r.client_id WHERE r.id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    if (!users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised for this report' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Trigger report generation
router.post('/trigger', async (req, res) => {
  const { client_id, report_type, period_start, period_end } = req.body;
  if (!client_id || !report_type) {
    return res.status(400).json({ error: 'client_id and report_type required' });
  }
  // Authorisation: reject if the caller can't see this client.
  // Without this check a viewer assigned to client A could trigger
  // report generation for client B (cost abuse + cross-tenant data
  // collection from B's connectors into a report row B's recipients
  // can't see but B's data still gets pulled).
  if (!users.canAccessClient(req.visibleClientIds, client_id)) {
    return res.status(403).json({ error: 'Not authorised for this client' });
  }
  try {
    const client = await pool.query('SELECT * FROM clients WHERE id = $1', [client_id]);
    if (!client.rows.length) return res.status(404).json({ error: 'Client not found' });

    // Create report record
    const start = period_start || getDefaultPeriodStart(report_type);
    const end = period_end || getDefaultPeriodEnd(report_type);

    const { rows } = await pool.query(
      `INSERT INTO reports (client_id, report_type, period_start, period_end, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [client_id, report_type, start, end]
    );
    const report = rows[0];

    // Run async
    reportService.generateReport(report.id).catch(err => {
      console.error(`Report ${report.id} failed:`, err.message);
    });

    res.status(202).json({ message: 'Report generation started', report_id: report.id, report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete report
router.delete('/:id', async (req, res) => {
  try {
    // Fetch the report's client_id and verify the caller can see it
    // before deleting. Without this guard, any authenticated viewer
    // could delete reports belonging to any client by enumerating
    // report UUIDs.
    const { rows } = await pool.query('SELECT client_id FROM reports WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    if (!users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised for this report' });
    }
    await pool.query('DELETE FROM reports WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resend report email
router.post('/:id/resend', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM reports WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    // Authorisation: caller must be able to see the report's client.
    // Otherwise any viewer could trigger an email send to another
    // client's configured report recipients — both a confidentiality
    // leak (re-delivering PII / metrics) and a spoofable annoyance
    // (recipient sees "Why am I getting Tuesday's report on Friday?").
    if (!users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised for this report' });
    }
    if (rows[0].status !== 'generated' && rows[0].status !== 'sent') {
      return res.status(400).json({ error: 'Report must be generated before resending' });
    }

    reportService.sendReport(req.params.id).catch(err => {
      console.error(`Resend ${req.params.id} failed:`, err.message);
    });

    res.json({ message: 'Resend initiated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Live preview — runs the same template resolver pipeline as a real
// report but returns the styled HTML straight back to the caller. Skips
// PDF generation, DB writes, and email. Caches raw connector data per
// (client, type, period) for 10 minutes and per-section narratives for
// 30, so AM iteration on a template renders in seconds rather than the
// 30-90s a full report takes.
router.post('/preview', async (req, res) => {
  const { client_id, report_type, period_start, period_end, force_refresh } = req.body || {};
  if (!client_id || !report_type) return res.status(400).json({ error: 'client_id and report_type required' });
  if (!['weekly', 'monthly'].includes(report_type)) return res.status(400).json({ error: 'invalid report_type' });
  if (!users.canAccessClient(req.visibleClientIds, client_id)) {
    return res.status(403).json({ error: 'Not authorised for this client' });
  }
  try {
    const periodStart = period_start || getDefaultPeriodStart(report_type);
    const periodEnd = period_end || getDefaultPeriodEnd(report_type);

    const clientRow = await pool.query('SELECT * FROM clients WHERE id = $1', [client_id]);
    if (!clientRow.rows.length) return res.status(404).json({ error: 'Client not found' });
    const client = clientRow.rows[0];

    if (force_refresh) previewCache.invalidateClient(client_id);

    // Raw connector data — cached for 10 min per (client, type, period).
    const cacheKey = previewCache.rawKey({ clientId: client_id, reportType: report_type, periodStart, periodEnd });
    let rawEntry = previewCache.getRawData(cacheKey);
    if (!rawEntry) {
      const collected = await dataCollector.collectClientData(client_id, periodStart, periodEnd);
      const seoData = await dataCollector.collectSEOData(client_id).catch(() => ({ rankings: [] }));
      rawEntry = { value: { data: collected.data, errors: collected.errors, seoData }, at: Date.now() };
      previewCache.setRawData(cacheKey, rawEntry.value);
    }
    const { data: rawData, seoData, errors: dataErrors } = rawEntry.value;
    const dataHash = previewCache.hashJson(rawData);

    // Template normalisation matches the generateReport path so existing
    // saved templates with "YoY" in their title get auto-promoted.
    const templates = client.report_templates || {};
    const availableTypes = Array.from(new Set(Object.keys(rawData).map(k => k.split(':')[0])));
    const template = reportTemplate.normaliseTemplate(
      templates[report_type] || reportTemplate.defaultTemplate(report_type, availableTypes)
    );

    // YoY data, when any section requests it. Cached on its own key so
    // the year-ago pull doesn't have to repeat either.
    let rawDataPrev = null;
    if (reportTemplate.templateRequiresYoy(template)) {
      const prevStart = reportTemplate.yoyDate(periodStart);
      const prevEnd = reportTemplate.yoyDate(periodEnd);
      const prevKey = previewCache.rawKey({ clientId: client_id, reportType: report_type, periodStart: prevStart, periodEnd: prevEnd });
      const cachedPrev = previewCache.getRawData(prevKey);
      if (cachedPrev) {
        rawDataPrev = cachedPrev.value.data;
      } else {
        try {
          const prev = await dataCollector.collectClientData(client_id, prevStart, prevEnd);
          previewCache.setRawData(prevKey, { data: prev.data, errors: prev.errors });
          rawDataPrev = prev.data;
        } catch (err) {
          console.error('[preview] yoy collection failed:', err.message);
        }
      }
    }

    // Time-series sections (time_grain + periods) — fetch one slice per
    // historical period in parallel, reusing the per-period preview
    // cache so iterating on the template doesn't re-pull every time.
    const seriesPlan = reportTemplate.periodsForTimeSeries(template);
    const rawDataByPeriod = { monthly: {}, weekly: {}, yearly: {} };
    const seriesFetches = [];
    for (const grain of Object.keys(seriesPlan)) {
      for (const offset of seriesPlan[grain]) {
        const range = reportTemplate.rangeForOffset({ periodStart, periodEnd, grain, offset });
        // Offset 0's range can be wider than the report period (notably
        // yearly grain where the current-year row is Jan 1 → periodEnd,
        // not just the report's month). Only reuse the main rawData when
        // the computed range matches the report period exactly; otherwise
        // treat it like any other historical fetch — cache lookup, then
        // fan-out collect.
        if (range.start === periodStart && range.end === periodEnd) {
          rawDataByPeriod[grain][offset] = rawData;
          continue;
        }
        const k = previewCache.rawKey({ clientId: client_id, reportType: report_type, periodStart: range.start, periodEnd: range.end });
        const cached = previewCache.getRawData(k);
        if (cached) {
          rawDataByPeriod[grain][offset] = cached.value.data;
          continue;
        }
        seriesFetches.push(
          dataCollector.collectClientData(client_id, range.start, range.end)
            .then(r => {
              previewCache.setRawData(k, { data: r.data, errors: r.errors });
              rawDataByPeriod[grain][offset] = r.data;
            })
            .catch(err => {
              console.error(`[preview] time-series ${grain}/${offset} (${range.start}..${range.end}) failed:`, err.message);
              rawDataByPeriod[grain][offset] = {};
            })
        );
      }
    }
    if (seriesFetches.length) await Promise.all(seriesFetches);

    // Wrap the narrative cache as a small adapter so templateRenderer
    // doesn't need to know about the cache layout — it just calls
    // narrativeCache.keyFor / .get / .set.
    let narrativeCacheHits = 0, narrativeCacheMisses = 0;
    const narrativeCache = {
      keyFor: (section, dataSlice, period) => previewCache.narrativeKey({
        clientId: client_id,
        section,
        period,
        dataHash: previewCache.hashJson({ slice: dataSlice, period }),
      }),
      get: (key) => {
        const v = previewCache.getNarrative(key);
        if (v != null) narrativeCacheHits++;
        else narrativeCacheMisses++;
        return v;
      },
      set: (key, value) => previewCache.setNarrative(key, value),
    };

    const period = report_type === 'monthly'
      ? new Date(periodStart).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      : `${new Date(periodStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

    // Pre-fetch GBP rates for non-GBP currencies in the data — used by
    // sumAcrossSources to normalise multi-market totals (e.g. US + UK
    // Google Ads) into a single GBP figure.
    const fxRates = await require('../services/fxRates').ratesToGbp(rawData, periodEnd);

    const resolved = await templateRenderer.resolveTemplate({
      template, client, period, periodStart, periodEnd, rawData, rawDataPrev, rawDataByPeriod, seoData, chatHistory: [], narrativeCache, fxRates,
    });

    const html = pdfService.buildTemplateReportHtml({ client, period, sections: resolved });

    res.json({
      html,
      period,
      period_start: periodStart,
      period_end: periodEnd,
      data_collected_at: new Date(rawEntry.at).toISOString(),
      data_errors: dataErrors || {},
      narrative_cache: { hits: narrativeCacheHits, misses: narrativeCacheMisses },
      sections: resolved.map(s => ({ id: s.id, type: s.type, title: s.title, cached: !!s.cached })),
    });
  } catch (err) {
    console.error('[preview] failed:', err);
    res.status(500).json({ error: err.message });
  }
});

function getDefaultPeriodStart(reportType) {
  const now = new Date();
  if (reportType === 'monthly') {
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return firstOfLastMonth.toISOString().split('T')[0];
  }
  // Weekly: last Monday
  const day = now.getDay();
  const lastMonday = new Date(now);
  lastMonday.setDate(now.getDate() - ((day + 6) % 7) - 7);
  return lastMonday.toISOString().split('T')[0];
}

function getDefaultPeriodEnd(reportType) {
  const now = new Date();
  if (reportType === 'monthly') {
    const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    return lastOfLastMonth.toISOString().split('T')[0];
  }
  // Weekly: last Sunday
  const day = now.getDay();
  const lastSunday = new Date(now);
  lastSunday.setDate(now.getDate() - ((day + 6) % 7) - 1);
  return lastSunday.toISOString().split('T')[0];
}

module.exports = router;
