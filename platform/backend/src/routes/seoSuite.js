// New-shape SEO endpoints, mounted at /api/seo. The existing /api/rankings
// keeps doing keyword + rank tracking; this file adds the rest of the
// Organic tab: intent classification, AI Overview history, GSC tabs,
// content gaps, content briefs.

const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const claudeService = require('../services/claude');
const dataForSEO = require('../connectors/dataforseo');
const google = require('../connectors/google');
const { decrypt } = require('../utils/encryption');

const router = express.Router();
router.use(authenticate);

// ─── INTENT CLASSIFICATION ────────────────────────────────────────────────
// Tags every active keyword for a client with Informational / Navigational
// / Commercial / Transactional intent in one batched Claude call. Cheap
// enough to run on demand from the UI.
router.post('/clients/:clientId/keywords/classify-intent', async (req, res) => {
  try {
    const { rows: keywords } = await pool.query(
      `SELECT id, keyword FROM seo_keywords WHERE client_id = $1 AND active = true ORDER BY keyword`,
      [req.params.clientId]
    );
    if (!keywords.length) return res.json({ updated: 0 });

    const clientRow = await pool.query('SELECT name, briefing_field FROM clients WHERE id = $1', [req.params.clientId]);
    const client = clientRow.rows[0];

    const prompt = `Client: ${client?.name || ''}
About: ${client?.briefing_field || '(no briefing)'}

For each keyword below, classify the dominant search intent as one of:
- Informational  → user wants to learn ("how to season cast iron")
- Navigational   → user wants a specific brand/site ("falcon enamelware")
- Commercial     → user is comparing options before buying ("best enamel mugs")
- Transactional  → user is ready to buy ("buy enamel mug uk")

Return ONLY a JSON object mapping the exact keyword string to its intent
label. Example: {"how to season cast iron":"Informational","buy enamel mug":"Transactional"}

Keywords:
${keywords.map(k => `- ${k.keyword}`).join('\n')}`;

    const reply = await claudeService.callClaude({
      max_tokens: 2048,
      system: 'You classify search intent. British English. Respond with JSON only.',
      user: prompt,
    });
    const cleaned = reply.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let intentMap;
    try { intentMap = JSON.parse(cleaned); }
    catch { return res.status(502).json({ error: 'Claude returned malformed JSON', raw: reply.slice(0, 500) }); }

    let updated = 0;
    for (const kw of keywords) {
      const intent = intentMap[kw.keyword];
      if (!intent) continue;
      const normalized = String(intent).toLowerCase().match(/^(informational|navigational|commercial|transactional)/)?.[1];
      if (!normalized) continue;
      const label = normalized.charAt(0).toUpperCase() + normalized.slice(1);
      await pool.query('UPDATE seo_keywords SET intent = $1 WHERE id = $2', [label, kw.id]);
      updated++;
    }
    res.json({ updated, total: keywords.length });
  } catch (err) {
    console.error('[seoSuite] intent classify failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Manual intent override from the UI.
router.put('/keywords/:id/intent', async (req, res) => {
  const { intent } = req.body || {};
  const allowed = ['Informational', 'Navigational', 'Commercial', 'Transactional'];
  if (intent && !allowed.includes(intent)) return res.status(400).json({ error: 'invalid intent' });
  try {
    await pool.query('UPDATE seo_keywords SET intent = $1 WHERE id = $2', [intent || null, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI OVERVIEW (AIO) ─────────────────────────────────────────────────────
// Per-client AIO history aggregated by date: # keywords with AIO present
// and # of those where the client's brand is cited. Plus the per-keyword
// latest state for a simple table.
router.get('/clients/:clientId/aio', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days || '180'), 730);
    const summary = await pool.query(
      `SELECT a.checked_at::text AS date,
              COUNT(*) FILTER (WHERE a.present)     AS present_count,
              COUNT(*) FILTER (WHERE a.brand_cited) AS cited_count,
              COUNT(*) AS total_keywords
       FROM aio_history a
       JOIN seo_keywords k ON k.id = a.keyword_id
       WHERE k.client_id = $1 AND a.checked_at >= CURRENT_DATE - ($2::int || ' days')::interval
       GROUP BY a.checked_at
       ORDER BY a.checked_at ASC`,
      [req.params.clientId, days]
    );

    const latest = await pool.query(
      `SELECT DISTINCT ON (a.keyword_id)
         k.id AS keyword_id, k.keyword, k.intent,
         a.checked_at, a.present, a.brand_cited, a.snippet
       FROM aio_history a
       JOIN seo_keywords k ON k.id = a.keyword_id
       WHERE k.client_id = $1 AND k.active = true
       ORDER BY a.keyword_id, a.checked_at DESC`,
      [req.params.clientId]
    );

    res.json({ trend: summary.rows, latest: latest.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger an AIO check immediately for one client — useful when an AM
// wants a fresh snapshot without waiting for the weekly cron.
router.post('/clients/:clientId/aio/check-now', async (req, res) => {
  try {
    const { rows: keywords } = await pool.query(
      `SELECT k.*, c.domain FROM seo_keywords k
       JOIN clients c ON c.id = k.client_id
       WHERE k.client_id = $1 AND k.active = true`,
      [req.params.clientId]
    );
    let ok = 0;
    for (const kw of keywords) {
      try {
        const result = await dataForSEO.checkAIOverview(kw, kw.domain);
        await pool.query(
          `INSERT INTO aio_history (keyword_id, checked_at, present, brand_cited, snippet)
           VALUES ($1, CURRENT_DATE, $2, $3, $4)
           ON CONFLICT (keyword_id, checked_at) DO UPDATE
             SET present = EXCLUDED.present, brand_cited = EXCLUDED.brand_cited, snippet = EXCLUDED.snippet`,
          [kw.id, result.present, result.brand_cited, result.snippet]
        );
        ok++;
      } catch (err) {
        console.error('[AIO] check-now failed:', err.message);
      }
    }
    res.json({ checked: ok, total: keywords.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GSC TABS ─────────────────────────────────────────────────────────────
// One connector → many possible views. We resolve the connector + its
// saved siteUrl here and fan out to specific GSC queries.
async function loadGSCConnector(clientId) {
  const { rows } = await pool.query(
    `SELECT * FROM connectors WHERE client_id = $1 AND connector_type = 'google_search_console' AND status = 'active' LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return null;
  const conn = rows[0];
  const creds = conn.credentials ? decrypt(conn.credentials) : null;
  const siteUrl = conn.config?.value;
  if (!creds || !siteUrl) return null;
  return { creds, siteUrl };
}

function defaultGSCRange(req) {
  const days = parseInt(req.query.days || '28');
  const end = new Date();
  end.setDate(end.getDate() - 2);     // GSC data lags by ~2 days
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

router.get('/clients/:clientId/gsc/queries', async (req, res) => {
  try {
    const conn = await loadGSCConnector(req.params.clientId);
    if (!conn) return res.status(404).json({ error: 'No active Search Console connector for this client.' });
    const { startDate, endDate } = defaultGSCRange(req);
    const rows = await google.fetchSearchAnalytics(conn.creds, {
      siteUrl: conn.siteUrl, startDate, endDate, dimensions: ['query'], rowLimit: 100,
    });
    res.json({ startDate, endDate, rows });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/clients/:clientId/gsc/pages', async (req, res) => {
  try {
    const conn = await loadGSCConnector(req.params.clientId);
    if (!conn) return res.status(404).json({ error: 'No active Search Console connector for this client.' });
    const { startDate, endDate } = defaultGSCRange(req);
    const rows = await google.fetchSearchAnalytics(conn.creds, {
      siteUrl: conn.siteUrl, startDate, endDate, dimensions: ['page'], rowLimit: 100,
    });
    res.json({ startDate, endDate, rows });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/clients/:clientId/gsc/devices', async (req, res) => {
  try {
    const conn = await loadGSCConnector(req.params.clientId);
    if (!conn) return res.status(404).json({ error: 'No active Search Console connector for this client.' });
    const { startDate, endDate } = defaultGSCRange(req);
    const rows = await google.fetchSearchAnalytics(conn.creds, {
      siteUrl: conn.siteUrl, startDate, endDate, dimensions: ['device'], rowLimit: 10,
    });
    res.json({ startDate, endDate, rows });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/clients/:clientId/gsc/countries', async (req, res) => {
  try {
    const conn = await loadGSCConnector(req.params.clientId);
    if (!conn) return res.status(404).json({ error: 'No active Search Console connector for this client.' });
    const { startDate, endDate } = defaultGSCRange(req);
    const rows = await google.fetchSearchAnalytics(conn.creds, {
      siteUrl: conn.siteUrl, startDate, endDate, dimensions: ['country'], rowLimit: 25,
    });
    res.json({ startDate, endDate, rows });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/clients/:clientId/gsc/sitemaps', async (req, res) => {
  try {
    const conn = await loadGSCConnector(req.params.clientId);
    if (!conn) return res.status(404).json({ error: 'No active Search Console connector for this client.' });
    const sitemaps = await google.fetchSearchConsoleSitemaps(conn.creds, { siteUrl: conn.siteUrl });
    res.json({ sitemaps });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── COMPETITORS + CONTENT GAPS ───────────────────────────────────────────
router.get('/clients/:clientId/competitors', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT competitor_domains FROM clients WHERE id = $1', [req.params.clientId]);
    res.json({ competitors: rows[0]?.competitor_domains || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/clients/:clientId/competitors', async (req, res) => {
  const competitors = Array.isArray(req.body?.competitors) ? req.body.competitors.map(String).filter(Boolean).slice(0, 5) : [];
  try {
    await pool.query('UPDATE clients SET competitor_domains = $1 WHERE id = $2', [competitors, req.params.clientId]);
    res.json({ competitors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Content gap analysis — DataForSEO Domain Intersection. Pay-per-call,
// run on demand from the UI rather than scheduled.
router.post('/clients/:clientId/content-gaps', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT domain, competitor_domains FROM clients WHERE id = $1', [req.params.clientId]);
    const client = rows[0];
    if (!client?.domain) return res.status(400).json({ error: 'Client domain not set.' });
    if (!client.competitor_domains?.length) return res.status(400).json({ error: 'Add competitor domains first.' });
    const locationCode = parseInt(req.body?.location_code) || 2826;
    const gaps = await dataForSEO.fetchDomainIntersection(client.domain, client.competitor_domains, locationCode);
    res.json({ gaps });
  } catch (err) {
    console.error('[seoSuite] content-gaps failed:', err);
    res.status(502).json({ error: err.message });
  }
});

// ─── CONTENT BRIEF ────────────────────────────────────────────────────────
// Generate a brief for a target keyword: outline, headings, key questions
// to answer, recommended internal links from the client's existing pages.
router.post('/clients/:clientId/content-brief', async (req, res) => {
  const { keyword } = req.body || {};
  if (!keyword) return res.status(400).json({ error: 'keyword required' });
  try {
    const clientRow = await pool.query('SELECT name, briefing_field, domain FROM clients WHERE id = $1', [req.params.clientId]);
    const client = clientRow.rows[0];

    const prompt = `Client: ${client?.name}
About: ${client?.briefing_field || '(no briefing)'}
Domain: ${client?.domain || '(no domain)'}

Generate a content brief for the target keyword: "${keyword}"

Return a JSON object with the keys:
- title: a working title for the piece
- target_intent: one of Informational / Navigational / Commercial / Transactional
- summary: 1-2 sentence pitch for what this piece should be
- outline: an array of 5-8 section objects { heading, points: [3-5 bullet strings] }
- questions_to_answer: array of 4-6 specific questions the piece should answer
- suggested_word_count: integer
- internal_link_targets: array of 3-5 page URL slug suggestions (under ${client?.domain || 'the client domain'}) — guess sensible slugs based on the brief
- meta_title: <60 char SEO title
- meta_description: <155 char SEO description

Return ONLY the JSON object. No prose.`;

    const reply = await claudeService.callClaude({
      max_tokens: 2048,
      system: 'You are an SEO content strategist. British English. Output JSON only.',
      user: prompt,
    });
    const cleaned = reply.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let brief;
    try { brief = JSON.parse(cleaned); }
    catch { return res.status(502).json({ error: 'Claude returned malformed JSON', raw: reply.slice(0, 500) }); }
    res.json({ brief });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
