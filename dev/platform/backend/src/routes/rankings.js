const express = require('express');
const pool = require('../db');
const { authenticate, agencyOnly } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, assertClientAccess } = require('../middleware/clientAccess');
const dataForSEO = require('../connectors/dataforseo');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
// All routes that take :clientId in the URL are auto-checked here.
// Routes that take :id (keyword UUID) or client_id via query/body look up
// the owning client and call assertClientAccess inside the handler.
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// List keywords for a client
router.get('/keywords', async (req, res) => {
  try {
    const { client_id, tag } = req.query;
    if (client_id) assertClientAccess(req, client_id);
    else if (req.visibleClientIds !== null) return res.status(400).json({ error: 'client_id required' });
    let query = `
      SELECT k.*,
        (SELECT position FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) as current_position,
        (SELECT source FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) as current_source,
        (SELECT position FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1 OFFSET 1) as previous_position,
        (SELECT MIN(position) FROM seo_rank_history WHERE keyword_id = k.id AND position IS NOT NULL) as best_position,
        (SELECT url FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) as ranking_url,
        (SELECT checked_at FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) as last_checked,
        (SELECT serp_features FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) as serp_features,
        (SELECT present FROM aio_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) as aio_present,
        (SELECT brand_cited FROM aio_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) as aio_brand_cited
      FROM seo_keywords k WHERE k.active = true
    `;
    const params = [];
    if (client_id) { params.push(client_id); query += ` AND k.client_id = $${params.length}`; }
    if (tag) { params.push(tag); query += ` AND k.tag = $${params.length}`; }
    query += ' ORDER BY k.keyword ASC';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add keyword
router.post('/keywords', async (req, res) => {
  const { client_id, keyword, target_url, device, tag, location_code, location_name } = req.body;
  if (!client_id || !keyword) return res.status(400).json({ error: 'client_id and keyword required' });
  try {
    assertClientAccess(req, client_id);
    const { rows } = await pool.query(
      `INSERT INTO seo_keywords (client_id, keyword, target_url, device, tag, location_code, location_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [client_id, keyword, target_url || null, device || 'desktop', tag || null,
       location_code || 2826, location_name || 'United Kingdom']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk import keywords (CSV data as JSON array)
router.post('/keywords/bulk', async (req, res) => {
  const { client_id, keywords } = req.body;
  if (!client_id || !Array.isArray(keywords)) {
    return res.status(400).json({ error: 'client_id and keywords array required' });
  }
  try {
    assertClientAccess(req, client_id);
    const inserted = [];
    for (const kw of keywords) {
      if (!kw.keyword) continue;
      const { rows } = await pool.query(
        `INSERT INTO seo_keywords (client_id, keyword, target_url, device, tag, location_code, location_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING RETURNING *`,
        [client_id, kw.keyword, kw.target_url || null, kw.device || 'desktop',
         kw.tag || null, kw.location_code || 2826, kw.location_name || 'United Kingdom']
      );
      if (rows.length) inserted.push(rows[0]);
    }
    res.json({ inserted: inserted.length, keywords: inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update keyword
router.put('/keywords/:id', async (req, res) => {
  const { keyword, target_url, device, tag, active, location_code, location_name } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM seo_keywords WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Keyword not found' });
    const k = rows[0];
    assertClientAccess(req, k.client_id);

    const { rows: updated } = await pool.query(
      `UPDATE seo_keywords SET
        keyword = $1, target_url = $2, device = $3, tag = $4, active = $5,
        location_code = $6, location_name = $7
       WHERE id = $8 RETURNING *`,
      [
        keyword ?? k.keyword, target_url ?? k.target_url, device ?? k.device,
        tag ?? k.tag, active ?? k.active, location_code ?? k.location_code,
        location_name ?? k.location_name, req.params.id
      ]
    );
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete keyword
router.delete('/keywords/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT client_id FROM seo_keywords WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(204).end();
    assertClientAccess(req, rows[0].client_id);
    await pool.query('DELETE FROM seo_keywords WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Full rank history for a keyword. No date cap — clients want to scroll
// back years for context. Returns serp_features per row so the timeline
// can show whether the position was alongside a featured snippet, image
// pack, etc. at that point in time.
router.get('/keywords/:id/history', async (req, res) => {
  try {
    const owner = await pool.query('SELECT client_id FROM seo_keywords WHERE id = $1', [req.params.id]);
    if (!owner.rows.length) return res.status(404).json({ error: 'Keyword not found' });
    assertClientAccess(req, owner.rows[0].client_id);
    const { rows } = await pool.query(
      `SELECT checked_at, position, url, source, serp_features FROM seo_rank_history
       WHERE keyword_id = $1
       ORDER BY checked_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Rank history matrix for all of a client's keywords (last 90 days)
router.get('/history/:clientId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT h.keyword_id, h.checked_at, h.position, h.source
       FROM seo_rank_history h
       JOIN seo_keywords k ON k.id = h.keyword_id
       WHERE k.client_id = $1
         AND h.checked_at >= CURRENT_DATE - INTERVAL '90 days'
       ORDER BY h.checked_at DESC`,
      [req.params.clientId]
    );
    const dates = [];
    const positions = {};
    for (const r of rows) {
      const d = (r.checked_at instanceof Date ? r.checked_at.toISOString() : String(r.checked_at)).slice(0, 10);
      if (!dates.includes(d)) dates.push(d);
      if (!positions[r.keyword_id]) positions[r.keyword_id] = {};
      positions[r.keyword_id][d] = { p: r.position, src: r.source };
    }
    res.json({ dates, positions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger rank check for a client
router.post('/check/:clientId', async (req, res) => {
  try {
    const { rows: keywords } = await pool.query(
      'SELECT * FROM seo_keywords WHERE client_id = $1 AND active = true',
      [req.params.clientId]
    );

    if (!keywords.length) {
      return res.json({ message: 'No active keywords', checked: 0 });
    }

    // Validate DataForSEO up front so the user gets an immediate, visible
    // error instead of a silent background failure.
    try {
      await dataForSEO.checkTokenValidity();
    } catch (err) {
      const detail = err.response?.data?.status_message || err.message;
      return res.status(502).json({ error: `DataForSEO check failed: ${detail}` });
    }

    // Run async
    runRankChecks(keywords).catch(err => {
      console.error('Rank check error:', err.message);
    });

    res.json({ message: 'Rank check initiated', keywords: keywords.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get tags for a client
router.get('/tags/:clientId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT DISTINCT tag FROM seo_keywords WHERE client_id = $1 AND tag IS NOT NULL ORDER BY tag',
      [req.params.clientId]
    );
    res.json(rows.map(r => r.tag));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export keywords to CSV data
router.get('/export/:clientId', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT k.keyword, k.target_url, k.device, k.tag, k.location_name, k.search_volume,
        (SELECT position FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) as current_position,
        (SELECT MIN(position) FROM seo_rank_history WHERE keyword_id = k.id) as best_position,
        (SELECT checked_at FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) as last_checked
      FROM seo_keywords k
      WHERE k.client_id = $1 AND k.active = true
      ORDER BY k.keyword
    `, [req.params.clientId]);

    const csvLines = ['keyword,target_url,device,tag,location,search_volume,current_position,best_position,last_checked'];
    for (const r of rows) {
      csvLines.push([
        `"${r.keyword}"`, `"${r.target_url || ''}"`, r.device,
        `"${r.tag || ''}"`, `"${r.location_name}"`,
        r.search_volume ?? '',
        r.current_position || '', r.best_position || '',
        r.last_checked ? r.last_checked.toISOString().split('T')[0] : ''
      ].join(','));
    }

    res.type('text/csv').send(csvLines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get last 12 months of manual SEO metrics for a client
router.get('/seo-metrics/:clientId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      // Return month as a plain YYYY-MM-DD string so it isn't shifted across a
      // timezone boundary when serialised (a DATE would round-trip as a UTC
      // timestamp and could roll back a day → previous month). Columns are
      // listed explicitly — `SELECT *, … AS month` yields two `month` columns
      // and makes `ORDER BY month` ambiguous.
      `SELECT id, client_id, to_char(month, 'YYYY-MM-DD') AS month,
              moz_da, authority_score, referring_domains, notes, created_at, updated_at
       FROM seo_manual_metrics
       WHERE client_id = $1
         AND month >= date_trunc('month', CURRENT_DATE - INTERVAL '11 months')
       ORDER BY month DESC`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upsert manual SEO metrics for a client/month
router.put('/seo-metrics/:clientId', async (req, res) => {
  const { month, moz_da, authority_score, referring_domains, notes } = req.body;
  if (!month) return res.status(400).json({ error: 'month is required (YYYY-MM-DD)' });
  try {
    const { rows } = await pool.query(
      // Normalise to the first of the month so the day picked never creates a
      // duplicate row — these metrics are month-keyed by design.
      `INSERT INTO seo_manual_metrics (client_id, month, moz_da, authority_score, referring_domains, notes)
       VALUES ($1, date_trunc('month', $2::date)::date, $3, $4, $5, $6)
       ON CONFLICT (client_id, month) DO UPDATE SET
         moz_da = EXCLUDED.moz_da,
         authority_score = EXCLUDED.authority_score,
         referring_domains = EXCLUDED.referring_domains,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING id, client_id, to_char(month, 'YYYY-MM-DD') AS month,
                 moz_da, authority_score, referring_domains, notes, created_at, updated_at`,
      [req.params.clientId, month, moz_da ?? null, authority_score ?? null, referring_domains ?? null, notes ?? null]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a manual SEO metrics row (by its stored month date) for a client
router.delete('/seo-metrics/:clientId/:month', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM seo_manual_metrics WHERE client_id = $1 AND month = $2::date',
      [req.params.clientId, req.params.month]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SEO summary: backlinks + domain rank for a client's domain
router.get('/seo-summary/:clientId', agencyOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT domain, slug FROM clients WHERE id = $1', [req.params.clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const domain = rows[0].domain || rows[0].slug;
    if (!domain) return res.status(400).json({ error: 'No domain configured for this client — set it on the Details tab.' });
    const backlinks = await dataForSEO.fetchBacklinkData(domain);
    if (!backlinks) return res.json({ domain, empty: true });
    res.json({
      domain: backlinks.target || domain,
      domain_rank: backlinks.rank,
      backlinks_total: backlinks.backlinks,
      referring_domains: backlinks.referring_domains,
      referring_ips: backlinks.referring_ips,
      new_backlinks: backlinks.new_backlinks,
      lost_backlinks: backlinks.lost_backlinks,
      broken_backlinks: backlinks.broken_backlinks,
      spam_score: backlinks.backlinks_spam_score,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch Google reviews for a client's domain
router.get('/reviews/:clientId', agencyOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const client = rows[0];
    const domain = req.query.domain || client.slug;
    const data = await dataForSEO.fetchReviews(domain);
    res.json(data || { error: 'No review data returned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check LLM / AI Overview visibility for a client
router.get('/llm-visibility/:clientId', agencyOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const client = rows[0];
    const domain = req.query.domain || client.slug;
    const { rows: kwRows } = await pool.query(
      'SELECT DISTINCT keyword FROM seo_keywords WHERE client_id = $1 AND active = true LIMIT 10',
      [req.params.clientId]
    );
    const keywords = kwRows.map(r => r.keyword);
    const data = await dataForSEO.fetchLLMVisibility(domain, keywords);
    res.json(data || { error: 'No LLM visibility data returned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function runRankChecks(keywords) {
  // Resolve each client's domain once — checkRank needs it to find where the
  // client (not the top competitor) ranks when a keyword has no target_url.
  const clientIds = [...new Set(keywords.map(k => k.client_id).filter(Boolean))];
  const domainByClient = {};
  if (clientIds.length) {
    const { rows } = await pool.query('SELECT id, domain FROM clients WHERE id = ANY($1)', [clientIds]);
    for (const r of rows) domainByClient[r.id] = r.domain;
  }
  for (const kw of keywords) {
    try {
      const result = await dataForSEO.checkRank(kw, domainByClient[kw.client_id]);
      await pool.query(
        `INSERT INTO seo_rank_history (keyword_id, checked_at, position, url, serp_features)
         VALUES ($1, CURRENT_DATE, $2, $3, $4)
         ON CONFLICT (keyword_id, checked_at) DO UPDATE
           SET position = EXCLUDED.position, url = EXCLUDED.url, serp_features = EXCLUDED.serp_features`,
        [kw.id, result.position, result.url, JSON.stringify(result.serp_features || [])]
      );
    } catch (err) {
      console.error(`Rank check failed for keyword ${kw.keyword}:`, err.message);
    }
  }

  // Refresh search volumes — one batched DataForSEO call per location.
  const byLocation = {};
  for (const kw of keywords) {
    const loc = kw.location_code || 2826;
    (byLocation[loc] = byLocation[loc] || []).push(kw);
  }
  for (const [loc, kws] of Object.entries(byLocation)) {
    try {
      const volumes = await dataForSEO.fetchSearchVolume(kws.map(k => k.keyword), Number(loc));
      for (const kw of kws) {
        const v = volumes[kw.keyword.toLowerCase()];
        if (v !== undefined) {
          await pool.query('UPDATE seo_keywords SET search_volume = $1 WHERE id = $2', [v, kw.id]);
        }
      }
    } catch (err) {
      console.error('Search volume fetch failed:', err.message);
    }
  }
}

module.exports = router;
