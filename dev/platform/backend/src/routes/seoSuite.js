// New-shape SEO endpoints, mounted at /api/seo. The existing /api/rankings
// keeps doing keyword + rank tracking; this file adds the rest of the
// Organic tab: intent classification, AI Overview history, GSC tabs,
// content gaps, content briefs.

const express = require('express');
const pool = require('../db');
const { authenticate, agencyOnly } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, assertClientAccess } = require('../middleware/clientAccess');
const claudeService = require('../services/claude');
const dataForSEO = require('../connectors/dataforseo');
const google = require('../connectors/google');
const pageSpeed = require('../services/pageSpeed');
const seoDrift = require('../services/seoDrift');
const seoSxo = require('../services/seoSxo');
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
// A client can have SEVERAL Search Console connectors — one per property /
// region (e.g. Falcon: US, UK, EU), each its own row with its own credentials.
// Resolve the connector for the requested site (so we use THAT property's
// token), falling back to the first active one when no site is given.
async function loadGSCConnector(clientId, site) {
  const wanted = site ? String(site).trim() : '';
  const { rows } = await pool.query(
    `SELECT * FROM connectors
       WHERE client_id = $1 AND connector_type = 'google_search_console' AND status = 'active'
       ORDER BY store_label NULLS LAST, created_at`,
    [clientId]
  );
  if (!rows.length) return null;
  const conn = (wanted && rows.find(r => r.config?.value === wanted)) || rows[0];
  const creds = conn.credentials ? decrypt(conn.credentials) : null;
  const siteUrl = conn.config?.value;
  if (!siteUrl) return null;
  // Service-account connectors have no per-user credentials — they read via
  // the platform service account, so only OAuth connectors need creds here.
  if (conn.auth_mode === 'oauth' && !creds) return null;
  return { creds, siteUrl, authMode: conn.auth_mode, storeLabel: conn.store_label || null };
}

function defaultGSCRange(req) {
  const days = parseInt(req.query.days || '28');
  const end = new Date();
  end.setDate(end.getDate() - 2);     // GSC data lags by ~2 days
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

// The chosen property is loaded by loadGSCConnector, so its siteUrl is already
// the right one; this just keeps the call sites tidy.
function effectiveSite(req, conn) {
  return conn.siteUrl;
}

// List the client's Search Console connectors (one per property/region) so the
// UI can offer a switcher. Each row already carries its site + region label.
router.get('/clients/:clientId/gsc/sites', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT store_label, config FROM connectors
         WHERE client_id = $1 AND connector_type = 'google_search_console' AND status = 'active'
         ORDER BY store_label NULLS LAST, created_at`,
      [req.params.clientId]
    );
    const sites = rows
      .map(r => ({
        value: r.config?.value,
        label: r.store_label ? `${r.store_label} — ${r.config?.value}` : (r.config?.value || ''),
        region: r.store_label || null,
      }))
      .filter(s => s.value);
    res.json({ sites, selected: sites[0]?.value || null });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/clients/:clientId/gsc/queries', async (req, res) => {
  try {
    const conn = await loadGSCConnector(req.params.clientId, req.query.site);
    if (!conn) return res.status(404).json({ error: 'No active Search Console connector for this client.' });
    const { startDate, endDate } = defaultGSCRange(req);
    const rows = await google.fetchSearchAnalytics(conn.creds, {
      authMode: conn.authMode, siteUrl: effectiveSite(req, conn), startDate, endDate, dimensions: ['query'], rowLimit: 100,
    });
    res.json({ startDate, endDate, rows });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/clients/:clientId/gsc/pages', async (req, res) => {
  try {
    const conn = await loadGSCConnector(req.params.clientId, req.query.site);
    if (!conn) return res.status(404).json({ error: 'No active Search Console connector for this client.' });
    const { startDate, endDate } = defaultGSCRange(req);
    const rows = await google.fetchSearchAnalytics(conn.creds, {
      authMode: conn.authMode, siteUrl: effectiveSite(req, conn), startDate, endDate, dimensions: ['page'], rowLimit: 100,
    });
    res.json({ startDate, endDate, rows });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/clients/:clientId/gsc/devices', async (req, res) => {
  try {
    const conn = await loadGSCConnector(req.params.clientId, req.query.site);
    if (!conn) return res.status(404).json({ error: 'No active Search Console connector for this client.' });
    const { startDate, endDate } = defaultGSCRange(req);
    const rows = await google.fetchSearchAnalytics(conn.creds, {
      authMode: conn.authMode, siteUrl: effectiveSite(req, conn), startDate, endDate, dimensions: ['device'], rowLimit: 10,
    });
    res.json({ startDate, endDate, rows });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/clients/:clientId/gsc/countries', async (req, res) => {
  try {
    const conn = await loadGSCConnector(req.params.clientId, req.query.site);
    if (!conn) return res.status(404).json({ error: 'No active Search Console connector for this client.' });
    const { startDate, endDate } = defaultGSCRange(req);
    const rows = await google.fetchSearchAnalytics(conn.creds, {
      authMode: conn.authMode, siteUrl: conn.siteUrl, startDate, endDate, dimensions: ['country'], rowLimit: 25,
    });
    res.json({ startDate, endDate, rows });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/clients/:clientId/gsc/sitemaps', async (req, res) => {
  try {
    const conn = await loadGSCConnector(req.params.clientId, req.query.site);
    if (!conn) return res.status(404).json({ error: 'No active Search Console connector for this client.' });
    const sitemaps = await google.fetchSearchConsoleSitemaps(conn.creds, { siteUrl: effectiveSite(req, conn), authMode: conn.authMode });
    res.json({ sitemaps });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── CTR BOOST ────────────────────────────────────────────────────────────
// The white-hat counterpart to CTR-manipulation services: instead of faking
// the NavBoost click signals, find pages that rank well but are under-clicked
// (a title/meta gap) and rewrite the snippet to earn the real click.
const ctrBoost = require('../services/ctrBoost');

router.get('/clients/:clientId/ctr-opportunities', async (req, res) => {
  try {
    const conn = await loadGSCConnector(req.params.clientId, req.query.site);
    if (!conn) return res.status(404).json({ error: 'No active Search Console connector for this client.' });
    const { startDate, endDate } = defaultGSCRange(req);
    const rows = await google.fetchSearchAnalytics(conn.creds, {
      authMode: conn.authMode, siteUrl: conn.siteUrl, startDate, endDate,
      dimensions: ['query', 'page'], rowLimit: 1000,
    });
    const opportunities = ctrBoost.scoreOpportunities(rows, {
      minImpressions: parseInt(req.query.minImpressions || '50'),
      maxPosition: parseInt(req.query.maxPosition || '20'),
    });
    res.json({ startDate, endDate, opportunities });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/clients/:clientId/ctr-opportunities/rewrite', async (req, res) => {
  const { query, url, current_title, current_description, position, ctr } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query required' });
  try {
    const suggestion = await ctrBoost.rewrite(req.params.clientId, {
      query, url, current_title, current_description, position, ctr,
    });
    res.json({ suggestion });
  } catch (err) {
    if (err instanceof SyntaxError) return res.status(502).json({ error: 'Claude returned malformed JSON' });
    res.status(500).json({ error: err.message });
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
    // Brand voice profile (when set up) — injected so the single-keyword
    // brief picks up the same voice context as the cluster brief +
    // drafter. Lazy require to avoid a circular import when this module
    // is loaded before brandVoice's own imports settle.
    const brandVoice = require('../services/brandVoice');
    const voiceProfile = await brandVoice.loadActiveProfile(req.params.clientId);
    const voiceContext = brandVoice.renderForPrompt(voiceProfile);

    const prompt = `Client: ${client?.name}
About: ${client?.briefing_field || '(no briefing)'}
Domain: ${client?.domain || '(no domain)'}${voiceContext}

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

// ─── SITE AUDIT ────────────────────────────────────────────────────────────
// Crawls the client's domain, scores on-page technical issues, persists
// them so they can be dismissed individually + pulled into Pipeline as
// content opportunities.
const siteAudit = require('../services/siteAudit');

router.get('/clients/:clientId/site-audits', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, domain, pages_crawled, status, score, summary_json, started_at, completed_at, error_message
       FROM site_audits WHERE client_id = $1 ORDER BY started_at DESC LIMIT 30`,
      [req.params.clientId]
    );
    res.json({ audits: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Real Core Web Vitals for a URL (default: the client's domain home) via
// PageSpeed Insights — CrUX field data preferred, Lighthouse lab fallback.
router.get('/clients/:clientId/core-web-vitals', async (req, res) => {
  try {
    let url = String(req.query.url || '').trim();
    if (!url) {
      const { rows } = await pool.query('SELECT domain FROM clients WHERE id = $1', [req.params.clientId]);
      const domain = (rows[0]?.domain || '').trim();
      if (!domain) return res.status(400).json({ error: 'No URL given and this client has no domain set.' });
      url = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
    }
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must be a full http(s) URL' });
    const strategy = req.query.strategy === 'desktop' ? 'desktop' : 'mobile';
    const result = await pageSpeed.fetchCoreWebVitals(url, { strategy });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

// SXO — read the SERP backwards: page-type + persona + wireframe for a query.
router.post('/clients/:clientId/sxo', async (req, res) => {
  try {
    res.json(await seoSxo.runSxo({
      clientId: req.params.clientId,
      seedQuery: req.body.seed_query,
      locationCode: Number(req.body.location_code) || 2826,
    }));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── SEO drift baselining (Integration E) ───────────────────────────────────
router.get('/clients/:clientId/drift/baselines', async (req, res) => {
  try {
    res.json({ baselines: await seoDrift.listBaselines(req.params.clientId) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/drift/baselines', async (req, res) => {
  try {
    res.json(await seoDrift.captureBaseline(req.params.clientId, req.body.label));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/clients/:clientId/drift/baselines/:id', async (req, res) => {
  try {
    await seoDrift.deleteBaseline(req.params.clientId, req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/clients/:clientId/drift/compare', async (req, res) => {
  try {
    res.json(await seoDrift.compareToBaseline(req.params.clientId, req.query.baseline_id || null));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/clients/:clientId/site-audits/latest', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM site_audits WHERE client_id = $1 AND status = 'complete'
       ORDER BY completed_at DESC LIMIT 1`,
      [req.params.clientId]
    );
    if (!rows.length) return res.json({ audit: null, issues: [] });
    const audit = rows[0];
    const { rows: issues } = await pool.query(
      `SELECT id, page_url, category, severity, detail, metadata, status, notes, created_at, updated_at
       FROM site_audit_issues WHERE audit_id = $1
       ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, category`,
      [audit.id]
    );
    res.json({ audit, issues });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Open issues across all audits — what Pipeline → Find "From your own
// site" reads to surface content opportunities. Filters to open status
// and groups by category for easy AM scan.
router.get('/clients/:clientId/site-audits/open-issues', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.page_url, i.category, i.severity, i.detail, i.metadata, i.status
       FROM site_audit_issues i
       JOIN site_audits a ON a.id = i.audit_id AND a.status = 'complete'
       WHERE i.client_id = $1 AND i.status = 'open'
       ORDER BY CASE i.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                a.completed_at DESC`,
      [req.params.clientId]
    );
    res.json({ issues: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/site-audits/run', async (req, res) => {
  // Fire-and-respond: kick off the crawl async, return the running row
  // immediately so the UI can poll. A 30-page crawl with 800ms delay
  // is ~30s minimum — blocking the request defeats the dashboard UX.
  try {
    const { rows: clientRows } = await pool.query('SELECT domain FROM clients WHERE id = $1', [req.params.clientId]);
    if (!clientRows.length || !clientRows[0].domain) {
      return res.status(400).json({ error: 'Client has no domain set' });
    }
    const { rows } = await pool.query(
      `SELECT id FROM site_audits WHERE client_id = $1 AND status = 'running'
       AND started_at > NOW() - INTERVAL '10 minutes'`,
      [req.params.clientId]
    );
    if (rows.length) {
      return res.status(409).json({ error: 'An audit is already running for this client.', audit_id: rows[0].id });
    }
    // Kick off async — let errors land on the audit row, not the response.
    siteAudit.runAudit({ clientId: req.params.clientId })
      .catch(err => console.error(`[siteAudit] background run failed for client ${req.params.clientId}:`, err.message));
    res.status(202).json({ status: 'started' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/site-audit-issues/:id', async (req, res) => {
  const { status, notes } = req.body || {};
  try {
    const lookup = await pool.query('SELECT client_id FROM site_audit_issues WHERE id = $1', [req.params.id]);
    if (!lookup.rows.length) return res.status(404).json({ error: 'Issue not found' });
    assertClientAccess(req, lookup.rows[0].client_id);
    const { rows } = await pool.query(
      `UPDATE site_audit_issues SET status = COALESCE($1, status), notes = COALESCE($2, notes), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status ?? null, notes ?? null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ─── QUICK WINS ────────────────────────────────────────────────────────────
// Keywords ranked 11–20 — one good refresh away from page 1. Computed
// from seo_keywords at read time; dismiss state persists.
const quickWins = require('../services/quickWins');

router.get('/clients/:clientId/quick-wins', async (req, res) => {
  try {
    const wins = await quickWins.listForClient(req.params.clientId);
    res.json({ wins });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/quick-wins/:keywordId/dismiss', async (req, res) => {
  try {
    await quickWins.dismiss({
      clientId: req.params.clientId,
      keywordId: req.params.keywordId,
      reason: req.body?.reason,
    });
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/quick-wins/:keywordId/restore', async (req, res) => {
  try {
    await quickWins.undismiss({ clientId: req.params.clientId, keywordId: req.params.keywordId });
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── CONTENT QUALITY AUDIT ─────────────────────────────────────────────────
// Per-page Claude-graded deep dive — different from the heuristic
// site_audit which sweeps 30 pages for tech issues. This goes deep on
// one URL: thin-content score, readability, keyword usage, missing
// sub-topics, suggested additions, priority. AM triggers per page.
const contentAudit = require('../services/contentAudit');

router.get('/clients/:clientId/content-audits', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, url, target_keyword, status, title, word_count,
              thin_content_score, readability_grade, keyword_usage,
              priority, content_grade, publish_verdict, started_at, completed_at, error_message
       FROM content_audits WHERE client_id = $1 ORDER BY started_at DESC LIMIT 50`,
      [req.params.clientId]
    );
    res.json({ audits: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/content-audits/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM content_audits WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Audit not found' });
    assertClientAccess(req, rows[0].client_id);
    res.json(rows[0]);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/clients/:clientId/content-audits', async (req, res) => {
  const { url, target_keyword } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    // Fire-and-respond: a Claude call takes 15–40s; return the running
    // row immediately so the UI can poll.
    const { rows: clientRows } = await pool.query('SELECT id FROM clients WHERE id = $1', [req.params.clientId]);
    if (!clientRows.length) return res.status(404).json({ error: 'Client not found' });
    contentAudit.runAudit({
      clientId: req.params.clientId, url, targetKeyword: target_keyword,
    }).catch(err => console.error(`[contentAudit] background run failed:`, err.message));
    res.status(202).json({ status: 'started' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/content-audits/:id', async (req, res) => {
  try {
    const lookup = await pool.query('SELECT client_id FROM content_audits WHERE id = $1', [req.params.id]);
    if (lookup.rows.length) assertClientAccess(req, lookup.rows[0].client_id);
    await pool.query('DELETE FROM content_audits WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ─── BRIEF CLUSTER MODE ────────────────────────────────────────────────────
// Two-stage: paste N keywords → Claude groups them into 3–8 topic
// clusters (cheap, one call). AM picks a cluster → Claude generates a
// brief targeting the whole cluster (one secondary call per cluster).
const keywordClusters = require('../services/keywordClusters');

router.post('/clients/:clientId/keyword-clusters', async (req, res) => {
  const { keywords } = req.body || {};
  if (!keywords) return res.status(400).json({ error: 'keywords required' });
  try {
    const out = await keywordClusters.clusterKeywords({
      clientId: req.params.clientId, keywords,
    });
    res.json(out);
  } catch (err) {
    console.error('[seoSuite] cluster failed:', err);
    res.status(502).json({ error: err.message });
  }
});

router.post('/clients/:clientId/keyword-clusters/brief', async (req, res) => {
  const { cluster } = req.body || {};
  if (!cluster?.primary) return res.status(400).json({ error: 'cluster with primary required' });
  try {
    const brief = await keywordClusters.briefForCluster({
      clientId: req.params.clientId, cluster,
    });
    res.json({ brief });
  } catch (err) {
    console.error('[seoSuite] cluster brief failed:', err);
    res.status(502).json({ error: err.message });
  }
});

// ─── PAGE KEYWORD FOOTPRINT ────────────────────────────────────────────────
// Per-page noun-phrase extraction, populated by the site_audit crawler.
// Returns the latest audit's footprint grouped by page so the AM can see
// "this page is about: enamel mug, double walled, cast iron" at a glance.
router.get('/clients/:clientId/keyword-footprint', async (req, res) => {
  try {
    const latest = await pool.query(
      `SELECT id, started_at, completed_at FROM site_audits
       WHERE client_id = $1 AND status = 'complete'
       ORDER BY completed_at DESC LIMIT 1`,
      [req.params.clientId]
    );
    if (!latest.rows.length) return res.json({ audit: null, pages: [] });
    const auditId = latest.rows[0].id;
    const { rows } = await pool.query(
      `SELECT page_url, phrase, frequency, rank
       FROM site_audit_page_keywords
       WHERE audit_id = $1
       ORDER BY page_url, rank`,
      [auditId]
    );
    // Group by page.
    const byPage = new Map();
    for (const r of rows) {
      if (!byPage.has(r.page_url)) byPage.set(r.page_url, { page_url: r.page_url, phrases: [] });
      byPage.get(r.page_url).phrases.push({ phrase: r.phrase, frequency: r.frequency, rank: r.rank });
    }
    res.json({ audit: latest.rows[0], pages: Array.from(byPage.values()) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── BACKLINKS: ANCHOR TEXT + DOFOLLOW SPLIT ───────────────────────────────
// DFS Backlinks endpoints — gated until 1 Jul 2026. Pre-cutover the
// route returns a 503 with the unlock date; post-cutover it works.
const { isUnlocked } = require('../services/dfsAvailability');

router.get('/clients/:clientId/anchor-text', agencyOnly, async (req, res) => {
  if (!isUnlocked()) {
    return res.status(503).json({
      error: 'Backlinks anchor-text is gated until DataForSEO Backlinks unlocks on 1 July 2026.',
    });
  }
  try {
    const { rows } = await pool.query('SELECT domain FROM clients WHERE id = $1', [req.params.clientId]);
    if (!rows.length || !rows[0].domain) return res.status(400).json({ error: 'Client has no domain set' });
    const anchors = await dataForSEO.fetchAnchorTextDistribution(rows[0].domain, { limit: 100 });
    res.json({ anchors });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

router.get('/clients/:clientId/dofollow-split', agencyOnly, async (req, res) => {
  if (!isUnlocked()) {
    return res.status(503).json({
      error: 'Backlinks dofollow split is gated until DataForSEO Backlinks unlocks on 1 July 2026.',
    });
  }
  try {
    const { rows } = await pool.query('SELECT domain FROM clients WHERE id = $1', [req.params.clientId]);
    if (!rows.length || !rows[0].domain) return res.status(400).json({ error: 'Client has no domain set' });
    const split = await dataForSEO.fetchDofollowSplit(rows[0].domain);
    res.json(split);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ─── BACKLINKS: SNAPSHOT PANEL (Phase E2, reads E1's dfs_* tables) ──────────
// These read the persisted 3-day snapshots rather than hitting DFS live, so
// they're cheap and work even while the API is gated (they just return an
// empty state until the first sweep has run).

// Latest summary + a trend series (one point per snapshot, last 90 days) for
// the headline cards and the referring-domains sparkline.
router.get('/clients/:clientId/backlinks/trend', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { rows: latest } = await pool.query(
      `SELECT captured_at, backlinks_total, referring_domains_total, dofollow_ratio, spam_score, rank
         FROM dfs_backlinks_summary
        WHERE client_id = $1
        ORDER BY captured_at DESC
        LIMIT 1`,
      [clientId]
    );
    const { rows: history } = await pool.query(
      `SELECT captured_at, backlinks_total, referring_domains_total
         FROM dfs_backlinks_summary
        WHERE client_id = $1 AND captured_at > NOW() - INTERVAL '90 days'
        ORDER BY captured_at ASC`,
      [clientId]
    );
    res.json({ latest: latest[0] || null, history });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Top-N referring domains from the most recent snapshot.
router.get('/clients/:clientId/backlinks/referring-domains', async (req, res) => {
  try {
    const { clientId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    // Pin to the latest captured_at so a mid-sweep read can't mix cycles.
    const { rows: cap } = await pool.query(
      'SELECT MAX(captured_at) AS captured_at FROM dfs_referring_domains WHERE client_id = $1',
      [clientId]
    );
    const capturedAt = cap[0]?.captured_at;
    if (!capturedAt) return res.json({ captured_at: null, domains: [] });
    const { rows } = await pool.query(
      `SELECT domain, rank, first_seen, last_seen, backlinks_count, dofollow
         FROM dfs_referring_domains
        WHERE client_id = $1 AND captured_at = $2
        ORDER BY rank DESC NULLS LAST, backlinks_count DESC
        LIMIT $3`,
      [clientId, capturedAt, limit]
    );
    res.json({ captured_at: capturedAt, domains: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// New / lost referring domains between the two most recent snapshots
// (Phase E3). The Monday-morning scan feed: which domains started or
// stopped linking to the client since last cycle. Diffs by domain name
// across the latest two distinct captured_at values. E1 only snapshots
// dofollow referring domains, so this is a followed-links diff — the
// version worth acting on.
router.get('/clients/:clientId/backlinks/changes', async (req, res) => {
  try {
    const { clientId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    // The two most recent snapshot timestamps.
    const { rows: caps } = await pool.query(
      `SELECT DISTINCT captured_at FROM dfs_referring_domains
        WHERE client_id = $1 ORDER BY captured_at DESC LIMIT 2`,
      [clientId]
    );
    if (caps.length < 2) {
      // Need two cycles to diff — surface which state we're in so the UI
      // can explain (no data yet vs only one snapshot so far).
      return res.json({
        current: caps[0]?.captured_at || null,
        previous: null,
        gained: [],
        lost: [],
      });
    }
    const [current, previous] = [caps[0].captured_at, caps[1].captured_at];
    const [gained, lost] = await Promise.all([
      pool.query(
        `SELECT domain, rank, first_seen, backlinks_count, dofollow
           FROM dfs_referring_domains cur
          WHERE client_id = $1 AND captured_at = $2
            AND NOT EXISTS (
              SELECT 1 FROM dfs_referring_domains prev
               WHERE prev.client_id = $1 AND prev.captured_at = $3 AND prev.domain = cur.domain)
          ORDER BY rank DESC NULLS LAST, backlinks_count DESC
          LIMIT $4`,
        [clientId, current, previous, limit]
      ),
      pool.query(
        `SELECT domain, rank, last_seen, backlinks_count, dofollow
           FROM dfs_referring_domains prev
          WHERE client_id = $1 AND captured_at = $2
            AND NOT EXISTS (
              SELECT 1 FROM dfs_referring_domains cur
               WHERE cur.client_id = $1 AND cur.captured_at = $3 AND cur.domain = prev.domain)
          ORDER BY rank DESC NULLS LAST, backlinks_count DESC
          LIMIT $4`,
        [clientId, previous, current, limit]
      ),
    ]);
    res.json({ current, previous, gained: gained.rows, lost: lost.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manual "refresh now" — runs a snapshot immediately rather than waiting for
// the 3-day cron. Gated: pullBacklinks throws a 503 before the cutover.
router.post('/clients/:clientId/backlinks/refresh', async (req, res) => {
  try {
    const result = await require('../services/dfsBacklinks').pullBacklinks(req.params.clientId);
    res.json(result);
  } catch (err) { res.status(err.status || 502).json({ error: err.message }); }
});

// ─── BRAND VOICE PROFILE ───────────────────────────────────────────────────
// One active profile per client. Re-running marks the previous one
// inactive (history preserved). Cluster briefs + full drafts read the
// active profile automatically via brandVoice.loadActiveProfile().
const brandVoice = require('../services/brandVoice');

router.get('/clients/:clientId/brand-voice', async (req, res) => {
  try {
    const active = await brandVoice.loadActiveProfile(req.params.clientId);
    const { rows: history } = await pool.query(
      `SELECT id, source_urls, status, started_at, completed_at, error_message
       FROM brand_voice_profiles
       WHERE client_id = $1
       ORDER BY started_at DESC LIMIT 20`,
      [req.params.clientId]
    );
    res.json({ active, history });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/brand-voice', async (req, res) => {
  const { urls } = req.body || {};
  if (!Array.isArray(urls) || !urls.length) return res.status(400).json({ error: 'urls array required' });
  try {
    // Fire-and-respond — Claude analysis takes 20–40s.
    brandVoice.runExtraction({ clientId: req.params.clientId, urls })
      .catch(err => console.error('[brandVoice] background extraction failed:', err.message));
    res.status(202).json({ status: 'started' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PROGRAMMATIC PAGE BUILDER ─────────────────────────────────────────────
// CSV-driven bulk brief generation. AM uploads a CSV + a template
// prompt with {placeholders}; service generates one brief per row,
// persists them in programmatic_briefs. AM promotes any single brief
// into Pipeline → Draft, or exports the lot.
const programmaticBriefs = require('../services/programmaticBriefs');

router.get('/clients/:clientId/programmatic-runs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, template_prompt, csv_headers, total_rows, completed_rows, failed_rows,
              status, estimated_cost_usd, started_at, completed_at, error_message
       FROM programmatic_runs WHERE client_id = $1
       ORDER BY started_at DESC LIMIT 30`,
      [req.params.clientId]
    );
    res.json({ runs: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/programmatic-runs/:id', async (req, res) => {
  try {
    const { rows: runRows } = await pool.query('SELECT * FROM programmatic_runs WHERE id = $1', [req.params.id]);
    if (!runRows.length) return res.status(404).json({ error: 'Run not found' });
    assertClientAccess(req, runRows[0].client_id);
    const { rows: briefs } = await pool.query(
      `SELECT * FROM programmatic_briefs WHERE run_id = $1 ORDER BY row_index ASC`,
      [req.params.id]
    );
    res.json({ run: runRows[0], briefs });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/clients/:clientId/programmatic-runs', async (req, res) => {
  const { name, template_prompt, primary_keyword_template, csv_text } = req.body || {};
  if (!template_prompt) return res.status(400).json({ error: 'template_prompt required' });
  if (!primary_keyword_template) return res.status(400).json({ error: 'primary_keyword_template required' });
  if (!csv_text) return res.status(400).json({ error: 'csv_text required' });
  try {
    // Fire-and-respond — Claude calls run in the background; the UI
    // polls. We do a quick CSV parse to fail fast on malformed input.
    programmaticBriefs.csvToObjects(csv_text);
    programmaticBriefs.runProgrammaticBatch({
      clientId: req.params.clientId,
      name, templatePrompt: template_prompt,
      primaryKeywordTemplate: primary_keyword_template,
      csvText: csv_text,
    }).catch(err => console.error('[programmatic] background run failed:', err.message));
    res.status(202).json({ status: 'started' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/programmatic-briefs/:id/promote', async (req, res) => {
  try {
    const lookup = await pool.query('SELECT client_id FROM programmatic_briefs WHERE id = $1', [req.params.id]);
    if (!lookup.rows.length) return res.status(404).json({ error: 'Brief not found' });
    assertClientAccess(req, lookup.rows[0].client_id);
    const draft = await programmaticBriefs.promoteToDraft({ briefId: req.params.id });
    res.status(201).json(draft);
  } catch (err) { res.status(err.status || 502).json({ error: err.message }); }
});

router.delete('/programmatic-runs/:id', async (req, res) => {
  try {
    const lookup = await pool.query('SELECT client_id FROM programmatic_runs WHERE id = $1', [req.params.id]);
    if (lookup.rows.length) assertClientAccess(req, lookup.rows[0].client_id);
    await pool.query('DELETE FROM programmatic_runs WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ─── REFINE CHAT ───────────────────────────────────────────────────────────
// Generic single-turn iteration on a Claude-generated artifact (a draft,
// a brief, an ad concept). The AM sends the current artifact + their
// instruction; Claude replies conversationally and optionally returns a
// revised version inside <revision> tags for one-click Apply. Stateless
// server-side — transcript lives in component state.
const refineChat = require('../services/refineChat');

router.post('/clients/:clientId/refine-chat', async (req, res) => {
  const { kind, artifact, messages, artifact_meta } = req.body || {};
  if (!kind || artifact == null || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'kind, artifact, messages required' });
  }
  try {
    const reply = await refineChat.refine({
      clientId: req.params.clientId,
      kind, artifact, messages, artifactMeta: artifact_meta,
    });
    res.json({ reply });
  } catch (err) {
    console.error('[refine-chat] failed:', err);
    res.status(502).json({ error: err.message });
  }
});

// ─── LOCAL SEO TOOLKIT ─────────────────────────────────────────────────────
// Five on-demand Claude tools (competition gap, schema audit, buyer-intent
// keywords, competitor X-ray, GBP posts). One generic table backs all five;
// the :tool segment selects the runner + history scope.
const localSeo = require('../services/localSeo');

router.get('/clients/:clientId/local-seo/:tool', async (req, res) => {
  if (!localSeo.isTool(req.params.tool)) return res.status(404).json({ error: 'Unknown tool' });
  try {
    const runs = await localSeo.listRuns(req.params.clientId, req.params.tool);
    res.json({ runs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/local-seo/:tool', async (req, res) => {
  if (!localSeo.isTool(req.params.tool)) return res.status(404).json({ error: 'Unknown tool' });
  try {
    const run = await localSeo.run(req.params.tool, req.params.clientId, req.body || {});
    res.status(201).json({ run });
  } catch (err) {
    console.error(`[seoSuite] local-seo ${req.params.tool} failed:`, err.message);
    // Bad input (missing field, blocked URL) is the AM's to fix → 400;
    // a malformed-JSON / model failure is upstream → 502.
    const status = /required|Add at least|Could not read|Set the client|blocked|Refusing|DNS lookup|malformed URL|too long/i.test(err.message) ? 400 : 502;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/clients/:clientId/local-seo/:tool/:runId', async (req, res) => {
  try {
    await localSeo.deleteRun(req.params.clientId, req.params.runId);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── AGENT READINESS ──────────────────────────────────────────────────────
// A lightweight, in-house take on Lighthouse's "Agentic Browsing" category:
// fetch the client's homepage + llms.txt and statically check the signals AI
// agents use to read/navigate the site. No paid API — just fetches their own
// site — so it runs on demand from the Owned › Optimise panel.
router.post('/clients/:clientId/agent-readiness', async (req, res) => {
  try {
    const agentReadiness = require('../services/agentReadiness');
    res.json(await agentReadiness.analyze(req.params.clientId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// The last stored check (or null) so the panel shows it on reload without a
// re-run. DB-only read — no external fetch.
router.get('/clients/:clientId/agent-readiness', async (req, res) => {
  try {
    const agentReadiness = require('../services/agentReadiness');
    res.json(await agentReadiness.getLatest(req.params.clientId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
