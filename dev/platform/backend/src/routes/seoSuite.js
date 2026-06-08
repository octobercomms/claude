// New-shape SEO endpoints, mounted at /api/seo. The existing /api/rankings
// keeps doing keyword + rank tracking; this file adds the rest of the
// Organic tab: intent classification, AI Overview history, GSC tabs,
// content gaps, content briefs.

const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, assertClientAccess } = require('../middleware/clientAccess');
const claudeService = require('../services/claude');
const dataForSEO = require('../connectors/dataforseo');
const google = require('../connectors/google');
const { decrypt } = require('../utils/encryption');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
// Most endpoints take :clientId; PUT /keywords/:id/intent looks up its
// own client_id inside the handler so it can check there.
router.use(requireClientAccess({ paramNames: ['clientId'] }));

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
    const { rows } = await pool.query('SELECT client_id FROM seo_keywords WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Keyword not found' });
    assertClientAccess(req, rows[0].client_id);
    await pool.query('UPDATE seo_keywords SET intent = $1 WHERE id = $2', [intent || null, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
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

// ─── QUERY FAN-OUT SIMULATOR ──────────────────────────────────────────────
// Google's Nov 2025 generative-AI guide documents "query fan-out" as the
// mechanism behind AI Overviews — the model spawns related queries and
// pulls top results from all of them. This simulator generates the likely
// fan-out for a seed query, runs DFS SERP across each, and reports the
// client's coverage so the AM can see which sub-intents to write content
// for next.
const seoFanout = require('../services/seoFanout');

router.get('/clients/:clientId/fanout', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, seed_query, location_code, fanout_count, ranked_count,
              coverage_score, summary_md, created_at
       FROM seo_fanout_runs
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.params.clientId]
    );
    res.json({ runs: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/clients/:clientId/fanout/:runId', async (req, res) => {
  try {
    const { rows: runRows } = await pool.query(
      `SELECT * FROM seo_fanout_runs WHERE id = $1 AND client_id = $2`,
      [req.params.runId, req.params.clientId]
    );
    if (!runRows.length) return res.status(404).json({ error: 'Run not found' });
    const { rows: queries } = await pool.query(
      `SELECT id, query, intent_label, rationale, client_position, client_url,
              top_urls, ai_overview_present, brand_cited, position_order
       FROM seo_fanout_queries
       WHERE run_id = $1
       ORDER BY position_order ASC`,
      [req.params.runId]
    );
    res.json({ run: runRows[0], queries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clients/:clientId/fanout', async (req, res) => {
  const { seed_query, location_code } = req.body || {};
  if (!seed_query) return res.status(400).json({ error: 'seed_query required' });
  try {
    const result = await seoFanout.runFanout({
      clientId: req.params.clientId,
      seedQuery: seed_query,
      locationCode: parseInt(location_code) || 2826,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error('[seoSuite] fanout failed:', err);
    res.status(502).json({ error: err.message });
  }
});

router.delete('/clients/:clientId/fanout/:runId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM seo_fanout_runs WHERE id = $1 AND client_id = $2`,
      [req.params.runId, req.params.clientId]
    );
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PIPELINE STEP 1: URL GAP ─────────────────────────────────────────────
// Paste a competitor URL → get every keyword that page ranks for +
// cross-reference against the client's own ranks. Output is the AM's
// brief for outranking that specific page.
const urlGap = require('../services/urlGap');

router.get('/clients/:clientId/url-gap', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, competitor_url, location_code, page_keyword_count, gap_count, summary_md, created_at
       FROM url_gap_runs
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.params.clientId]
    );
    res.json({ runs: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/clients/:clientId/url-gap/:runId', async (req, res) => {
  try {
    const { rows: runRows } = await pool.query(
      `SELECT * FROM url_gap_runs WHERE id = $1 AND client_id = $2`,
      [req.params.runId, req.params.clientId]
    );
    if (!runRows.length) return res.status(404).json({ error: 'Run not found' });
    const { rows: keywords } = await pool.query(
      `SELECT id, keyword, search_volume, competitor_position, client_position, is_gap, position_order
       FROM url_gap_keywords
       WHERE run_id = $1
       ORDER BY position_order ASC`,
      [req.params.runId]
    );
    res.json({ run: runRows[0], keywords });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/url-gap', async (req, res) => {
  const { competitor_url, location_code } = req.body || {};
  if (!competitor_url) return res.status(400).json({ error: 'competitor_url required' });
  try {
    const result = await urlGap.runUrlGap({
      clientId: req.params.clientId,
      competitorUrl: competitor_url,
      locationCode: parseInt(location_code) || 2826,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error('[seoSuite] url-gap failed:', err);
    res.status(502).json({ error: err.message });
  }
});

router.delete('/clients/:clientId/url-gap/:runId', async (req, res) => {
  try {
    await pool.query(`DELETE FROM url_gap_runs WHERE id = $1 AND client_id = $2`,
      [req.params.runId, req.params.clientId]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PIPELINE STEP 3: CONTENT DRAFTS ──────────────────────────────────────
// Generate a brand-aware full blog post from a brief; list / read / edit
// / delete drafts; sanitize is applied on edit so AM-pasted edits also
// get the AI-tells filter.
const contentDraft = require('../services/contentDraft');

router.get('/clients/:clientId/drafts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*,
              COALESCE(json_agg(
                json_build_object('id', p.id, 'platform', p.platform, 'status', p.status, 'external_url', p.external_url, 'published_at', p.published_at)
                ORDER BY p.created_at DESC
              ) FILTER (WHERE p.id IS NOT NULL), '[]') AS publications
       FROM content_drafts d
       LEFT JOIN content_publications p ON p.draft_id = d.id
       WHERE d.client_id = $1
       GROUP BY d.id
       ORDER BY d.created_at DESC
       LIMIT 50`,
      [req.params.clientId]
    );
    res.json({ drafts: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/drafts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM content_drafts WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Draft not found' });
    assertClientAccess(req, rows[0].client_id);
    res.json(rows[0]);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/clients/:clientId/drafts', async (req, res) => {
  const { brief, target_keyword } = req.body || {};
  if (!brief) return res.status(400).json({ error: 'brief required' });
  try {
    const draft = await contentDraft.generateDraft({
      clientId: req.params.clientId, brief, targetKeyword: target_keyword,
    });
    res.status(201).json(draft);
  } catch (err) {
    console.error('[seoSuite] draft generate failed:', err);
    res.status(502).json({ error: err.message });
  }
});

router.put('/drafts/:id', async (req, res) => {
  const { title, meta_description, body_markdown, status } = req.body || {};
  try {
    const lookup = await pool.query('SELECT client_id FROM content_drafts WHERE id = $1', [req.params.id]);
    if (!lookup.rows.length) return res.status(404).json({ error: 'Draft not found' });
    assertClientAccess(req, lookup.rows[0].client_id);
    const cleanMd = body_markdown ? contentDraft.sanitizeUnicode(body_markdown) : null;
    const html = cleanMd ? contentDraft.renderMarkdownToHtml(cleanMd) : null;
    const wordCount = cleanMd ? cleanMd.split(/\s+/).filter(Boolean).length : null;
    const { rows } = await pool.query(
      `UPDATE content_drafts SET
         title = COALESCE($1, title),
         meta_description = COALESCE($2, meta_description),
         body_markdown = COALESCE($3, body_markdown),
         body_html = COALESCE($4, body_html),
         word_count = COALESCE($5, word_count),
         status = COALESCE($6, status),
         updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [title ?? null, meta_description ?? null, cleanMd, html, wordCount, status ?? null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/drafts/:id', async (req, res) => {
  try {
    const lookup = await pool.query('SELECT client_id FROM content_drafts WHERE id = $1', [req.params.id]);
    if (lookup.rows.length) assertClientAccess(req, lookup.rows[0].client_id);
    await pool.query('DELETE FROM content_drafts WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ─── PIPELINE STEP 4: PUBLISH ─────────────────────────────────────────────
const contentPublish = require('../services/contentPublish');

router.post('/drafts/:id/publish', async (req, res) => {
  const { platform, connector_id, scheduled_at, status_override } = req.body || {};
  if (!platform) return res.status(400).json({ error: 'platform required' });
  try {
    const lookup = await pool.query('SELECT client_id FROM content_drafts WHERE id = $1', [req.params.id]);
    if (!lookup.rows.length) return res.status(404).json({ error: 'Draft not found' });
    assertClientAccess(req, lookup.rows[0].client_id);
    const pub = await contentPublish.publish({
      draftId: req.params.id,
      platform,
      connectorId: connector_id || null,
      scheduledAt: scheduled_at || null,
      statusOverride: status_override || null,
    });
    res.status(201).json(pub);
  } catch (err) {
    console.error('[seoSuite] publish failed:', err);
    res.status(502).json({ error: err.message });
  }
});

router.get('/drafts/:id/export/:format', async (req, res) => {
  try {
    const lookup = await pool.query('SELECT * FROM content_drafts WHERE id = $1', [req.params.id]);
    if (!lookup.rows.length) return res.status(404).json({ error: 'Draft not found' });
    assertClientAccess(req, lookup.rows[0].client_id);
    const draft = lookup.rows[0];
    if (req.params.format === 'docx') {
      const { mime, bytes } = await contentPublish.exportDraftAsDocx(draft);
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename="${(draft.title || 'draft').replace(/[^a-z0-9-]+/gi, '-')}.docx"`);
      return res.send(bytes);
    }
    if (req.params.format === 'md') {
      res.setHeader('Content-Type', 'text/markdown');
      return res.send(draft.body_markdown || '');
    }
    res.status(400).json({ error: 'format must be docx or md' });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ─── PIPELINE STEP 5: PROMOTE — BACKLINK PROSPECTS ────────────────────────
const backlinkProspect = require('../services/backlinkProspect');

router.get('/clients/:clientId/backlink-prospects', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM backlink_prospects
       WHERE client_id = $1
       ORDER BY relevance_score DESC, created_at DESC
       LIMIT 200`,
      [req.params.clientId]
    );
    res.json({ prospects: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/backlink-prospects/scan', async (req, res) => {
  try {
    const inserted = await backlinkProspect.prospectFromCompetitors({
      clientId: req.params.clientId,
    });
    res.status(201).json({ inserted: inserted.length, prospects: inserted });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put('/backlink-prospects/:id', async (req, res) => {
  const { status, notes } = req.body || {};
  try {
    const lookup = await pool.query('SELECT client_id FROM backlink_prospects WHERE id = $1', [req.params.id]);
    if (!lookup.rows.length) return res.status(404).json({ error: 'Prospect not found' });
    assertClientAccess(req, lookup.rows[0].client_id);
    const { rows } = await pool.query(
      `UPDATE backlink_prospects SET status = COALESCE($1, status), notes = COALESCE($2, notes) WHERE id = $3 RETURNING *`,
      [status ?? null, notes ?? null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ─── PROMOTE — JOURNALIST RESPONSES (Featured / Qwoted / SOS) ────────────
// AM pastes a journalist query → Claude drafts a response in the client's
// voice → AM edits + sends from their own inbox → records outcome here.
const journalistResponse = require('../services/journalistResponse');

router.get('/clients/:clientId/journalist-responses', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM journalist_responses
       WHERE client_id = $1
       ORDER BY (deadline IS NULL), deadline ASC, created_at DESC
       LIMIT 100`,
      [req.params.clientId]
    );
    res.json({ responses: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/journalist-responses', async (req, res) => {
  const { source, query_text, journalist_name, outlet, deadline, context } = req.body || {};
  if (!query_text) return res.status(400).json({ error: 'query_text required' });
  try {
    const draft = await journalistResponse.generateResponse({
      clientId: req.params.clientId,
      source: source || 'manual',
      queryText: query_text,
      journalistName: journalist_name,
      outlet,
      deadline,
      context,
    });
    res.status(201).json(draft);
  } catch (err) {
    console.error('[seoSuite] journalist response failed:', err);
    res.status(502).json({ error: err.message });
  }
});

router.put('/journalist-responses/:id', async (req, res) => {
  const { response_md, status, external_url, notes } = req.body || {};
  try {
    const lookup = await pool.query('SELECT client_id FROM journalist_responses WHERE id = $1', [req.params.id]);
    if (!lookup.rows.length) return res.status(404).json({ error: 'Response not found' });
    assertClientAccess(req, lookup.rows[0].client_id);
    const { rows } = await pool.query(
      `UPDATE journalist_responses SET
         response_md = COALESCE($1, response_md),
         status = COALESCE($2, status),
         external_url = COALESCE($3, external_url),
         notes = COALESCE($4, notes),
         updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [response_md ?? null, status ?? null, external_url ?? null, notes ?? null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/journalist-responses/:id', async (req, res) => {
  try {
    const lookup = await pool.query('SELECT client_id FROM journalist_responses WHERE id = $1', [req.params.id]);
    if (lookup.rows.length) assertClientAccess(req, lookup.rows[0].client_id);
    await pool.query('DELETE FROM journalist_responses WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
