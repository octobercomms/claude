// Ad Creative routes — generate concept batches and render image variants
// across multiple aspect ratios per concept. Lives under /api/ad-creatives,
// pulled into the Paid tab on the client page.

const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const adCreative = require('../services/adCreative');
const replicate = require('../connectors/replicate');
const ideogram = require('../connectors/ideogram');
const adobe = require('../connectors/adobe');
const users = require('../services/users');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// Resolve :id (batch / creative) to client and refuse cross-tenant access.
router.param('id', async (req, res, next, id) => {
  try {
    const path = req.path;
    let q;
    if (path.startsWith('/batches/')) q = 'SELECT client_id FROM ad_creative_batches WHERE id = $1';
    else if (path.startsWith('/creatives/')) q = 'SELECT client_id FROM ad_creatives WHERE id = $1';
    if (q) {
      const { rows } = await pool.query(q, [id]);
      if (rows.length && !users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
        return res.status(403).json({ error: 'Not authorised for this client' });
      }
    }
    next();
  } catch (err) { next(err); }
});

router.get('/clients/:clientId/batches', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*,
              (SELECT COUNT(*)::int FROM ad_creatives c WHERE c.batch_id = b.id) AS creative_count
       FROM ad_creative_batches b WHERE b.client_id = $1
       ORDER BY b.created_at DESC LIMIT 50`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/clients/:clientId/creatives', async (req, res) => {
  try {
    const { batch_id } = req.query;
    const params = [req.params.clientId];
    let where = 'c.client_id = $1';
    if (batch_id) { params.push(batch_id); where += ` AND c.batch_id = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT c.*,
              COALESCE(json_agg(
                json_build_object('id', i.id, 'provider', i.provider, 'aspect_ratio', i.aspect_ratio, 'url', i.url)
                ORDER BY i.created_at
              ) FILTER (WHERE i.id IS NOT NULL), '[]') AS images
       FROM ad_creatives c
       LEFT JOIN ad_creative_images i ON i.creative_id = c.id
       WHERE ${where}
       GROUP BY c.id
       ORDER BY c.position ASC, c.created_at ASC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/generate', async (req, res) => {
  const { brief, platform, count, asset_ids, campaign_context } = req.body || {};
  try {
    const result = await adCreative.generateBatch({
      clientId: req.params.clientId,
      brief,
      platform: platform || 'meta',
      count: Math.min(Math.max(parseInt(count) || 8, 4), 16),
      assetIds: Array.isArray(asset_ids) ? asset_ids : [],
      campaignContext: campaign_context || null,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error('[ad-creative] generate failed:', err);
    res.status(502).json({ error: err.message });
  }
});

router.put('/creatives/:id', async (req, res) => {
  const { headline, body, cta, angle, visual_concept, status, notes } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE ad_creatives SET
        headline = COALESCE($1, headline),
        body = COALESCE($2, body),
        cta = COALESCE($3, cta),
        angle = COALESCE($4, angle),
        visual_concept = COALESCE($5, visual_concept),
        status = COALESCE($6, status),
        notes = COALESCE($7, notes)
       WHERE id = $8 RETURNING *`,
      [headline ?? null, body ?? null, cta ?? null, angle ?? null,
       visual_concept ?? null, status ?? null, notes ?? null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Creative not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/creatives/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM ad_creatives WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/batches/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM ad_creative_batches WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Render image variations for a creative. The AM picks which aspect
// ratios (e.g. 1:1 + 4:5 + 9:16) and the provider; we render each in
// turn and persist as ad_creative_images. Variations can be appended
// later — each call adds new rows rather than replacing.
router.post('/creatives/:id/images', async (req, res) => {
  const { provider = 'replicate', aspect_ratios = ['1:1'], style_brief, seed } = req.body || {};
  if (!Array.isArray(aspect_ratios) || !aspect_ratios.length) {
    return res.status(400).json({ error: 'aspect_ratios array required' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM ad_creatives WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Creative not found' });
    const creative = rows[0];

    const promptBase = [
      creative.visual_concept || `${creative.angle}: ${creative.headline}`,
      `Direct-response ad creative. Headline overlay: "${creative.headline}". CTA: "${creative.cta}".`,
      style_brief ? `Style: ${style_brief}` : '',
    ].filter(Boolean).join('\n');

    const generator = provider === 'ideogram' ? ideogram : provider === 'adobe' ? adobe : replicate;
    const generated = [];
    for (const aspect of aspect_ratios) {
      try {
        const result = await generator.generate({ prompt: promptBase, aspect_ratio: aspect, seed });
        const { rows: row } = await pool.query(
          `INSERT INTO ad_creative_images (creative_id, provider, aspect_ratio, url, prompt)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [creative.id, provider, aspect, result.url, promptBase]
        );
        generated.push(row[0]);
      } catch (err) {
        console.error(`[ad-creative] ${aspect} generation failed:`, err.message);
        generated.push({ aspect_ratio: aspect, error: err.message });
      }
    }
    res.status(201).json({ creative_id: creative.id, images: generated });
  } catch (err) {
    console.error('[ad-creative] image generate failed:', err);
    res.status(502).json({ error: err.message });
  }
});

// Photoshop generative resize — take one existing image on this creative
// and fan it out to a list of target aspect ratios in one click. Saves
// having to re-prompt the image generator just to get a different shape
// of the same composition.
router.post('/images/:id/fan-out', authenticate, loadVisibleClientIds, async (req, res) => {
  const { aspect_ratios = ['1:1', '4:5', '9:16', '16:9'] } = req.body || {};
  try {
    const { rows } = await pool.query(
      `SELECT i.*, c.client_id, c.id AS creative_id FROM ad_creative_images i
       JOIN ad_creatives c ON c.id = i.creative_id
       WHERE i.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Image not found' });
    const src = rows[0];
    if (!users.canAccessClient(req.visibleClientIds, src.client_id)) {
      return res.status(403).json({ error: 'Not authorised' });
    }
    const sizeMap = { '1:1': [1024, 1024], '4:5': [1024, 1280], '9:16': [1024, 1820], '16:9': [1792, 1024] };
    const generated = [];
    for (const aspect of aspect_ratios) {
      if (aspect === src.aspect_ratio) continue;
      const [w, h] = sizeMap[aspect] || sizeMap['1:1'];
      try {
        const result = await adobe.generativeResize({ image_url: src.url, width: w, height: h });
        const { rows: row } = await pool.query(
          `INSERT INTO ad_creative_images (creative_id, provider, aspect_ratio, url, prompt)
           VALUES ($1, 'adobe-resize', $2, $3, $4) RETURNING *`,
          [src.creative_id, aspect, result.url, `Generative resize from ${src.aspect_ratio} source`]
        );
        generated.push(row[0]);
      } catch (err) {
        console.error(`[ad-creative] fan-out ${aspect} failed:`, err.message);
        generated.push({ aspect_ratio: aspect, error: err.message });
      }
    }
    res.status(201).json({ source_image_id: src.id, generated });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

router.delete('/images/:id', authenticate, loadVisibleClientIds, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.client_id FROM ad_creative_images i
       JOIN ad_creatives c ON c.id = i.creative_id
       WHERE i.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(204).end();
    if (!users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised' });
    }
    await pool.query('DELETE FROM ad_creative_images WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
