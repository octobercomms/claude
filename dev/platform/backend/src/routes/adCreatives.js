// Ad Creative routes — generate concept batches and render image variants
// across multiple aspect ratios per concept. Lives under /api/ad-creatives,
// pulled into the Paid tab on the client page.

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const adCreative = require('../services/adCreative');
const adResize = require('../services/adResize');
const replicate = require('../connectors/replicate');
const ideogram = require('../connectors/ideogram');
const adobe = require('../connectors/adobe');
const users = require('../services/users');

// Uploads share the brand-asset store on disk (uploads/<clientId>/) and are
// served back through the existing authenticated /api/brand/file route, so we
// don't need a second static-file server.
const UPLOAD_ROOT = path.join(__dirname, '../../uploads');
const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB — video clips are bigger
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

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
                json_build_object(
                  'id', i.id, 'provider', i.provider, 'aspect_ratio', i.aspect_ratio,
                  'url', i.url, 'media_type', i.media_type, 'duration_seconds', i.duration_seconds
                )
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

// Variant Matrix — one brief fans out into a large, deliberately diverse set of
// on-brand ad concepts (up to 100), looped in chunks so the model doesn't just
// reword one idea. Lands in a single batch so render + resize work unchanged.
router.post('/clients/:clientId/matrix', async (req, res) => {
  const { brief, platform, count, asset_ids, campaign_context } = req.body || {};
  try {
    const result = await adCreative.generateMatrix({
      clientId: req.params.clientId,
      brief,
      platform: platform || 'meta',
      count: Math.min(Math.max(parseInt(count) || 50, 12), 100),
      assetIds: Array.isArray(asset_ids) ? asset_ids : [],
      campaignContext: campaign_context || null,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error('[ad-creative] matrix failed:', err);
    res.status(502).json({ error: err.message });
  }
});

// The client's persisted "worked example" batch — generated once from the
// client profile, then reused. Flows through every Build step so an AM (or a
// client being shown the tool) can see what each stage produces.
router.post('/clients/:clientId/example-batch', async (req, res) => {
  try {
    const result = await adCreative.ensureExampleBatch({ clientId: req.params.clientId });
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    console.error('[ad-creative] example batch failed:', err);
    res.status(502).json({ error: err.message });
  }
});

// Quick single-ad preview from the brief text — not persisted.
router.post('/clients/:clientId/sample', async (req, res) => {
  try {
    const sample = await adCreative.sampleAd({
      clientId: req.params.clientId,
      brief: (req.body || {}).brief,
      platform: (req.body || {}).platform || 'meta',
    });
    res.json({ sample });
  } catch (err) {
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
  const {
    provider = 'replicate', aspect_ratios = ['1:1'], style_brief, seed,
    media_type = 'image', duration, from_image_id,
  } = req.body || {};
  if (!Array.isArray(aspect_ratios) || !aspect_ratios.length) {
    return res.status(400).json({ error: 'aspect_ratios array required' });
  }
  if (media_type !== 'image' && media_type !== 'video') {
    return res.status(400).json({ error: 'media_type must be image or video' });
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

    if (media_type === 'video') {
      // Video only on Replicate (Ideogram + Adobe don't do video). Cap
      // duration at 10s — anything longer can run several minutes and
      // costs ~$1+ per render.
      const clipDuration = Math.min(Math.max(parseInt(duration) || 5, 5), 10);
      let referenceImage = null;
      if (from_image_id) {
        const { rows: ir } = await pool.query(
          'SELECT url FROM ad_creative_images WHERE id = $1 AND creative_id = $2',
          [from_image_id, creative.id]
        );
        if (ir.length) referenceImage = ir[0].url;
      }
      const generated = [];
      for (const aspect of aspect_ratios) {
        try {
          const result = await replicate.generateVideo({
            prompt: promptBase, aspect_ratio: aspect, duration: clipDuration,
            reference_image: referenceImage, seed,
          });
          const { rows: row } = await pool.query(
            `INSERT INTO ad_creative_images
             (creative_id, provider, aspect_ratio, url, prompt, media_type, duration_seconds)
             VALUES ($1, $2, $3, $4, $5, 'video', $6) RETURNING *`,
            [creative.id, 'replicate-video', aspect, result.url, promptBase, clipDuration]
          );
          generated.push(row[0]);
        } catch (err) {
          console.error(`[ad-creative] video ${aspect} generation failed:`, err.message);
          generated.push({ aspect_ratio: aspect, error: err.message });
        }
      }
      return res.status(201).json({ creative_id: creative.id, images: generated });
    }

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

// Attach the brand's own image or video to a creative, in place of (or
// alongside) an AI render. Stored on disk under the client's upload folder and
// recorded as an ad_creative_images row with provider 'upload', so it shows up,
// counts, exports and seeds video exactly like a generated asset.
router.post('/creatives/:id/upload', uploadMem.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const { rows } = await pool.query('SELECT client_id FROM ad_creatives WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Creative not found' });
    const clientId = rows[0].client_id;

    const dir = path.join(UPLOAD_ROOT, clientId);
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(req.file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.writeFileSync(path.join(dir, filename), req.file.buffer);

    const url = `/api/brand/file/${clientId}/${filename}`;
    const mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
    const aspect = /^(1:1|4:5|9:16|16:9|custom)$/.test(req.body?.aspect_ratio || '') ? req.body.aspect_ratio : 'custom';
    const { rows: img } = await pool.query(
      `INSERT INTO ad_creative_images (creative_id, provider, aspect_ratio, url, prompt, media_type)
       VALUES ($1, 'upload', $2, $3, $4, $5) RETURNING *`,
      [req.params.id, aspect, url, `Uploaded: ${req.file.originalname}`, mediaType]
    );
    res.status(201).json(img[0]);
  } catch (err) {
    console.error('[ad-creative] upload failed:', err.message);
    res.status(500).json({ error: err.message });
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

// ── Resize for ads ────────────────────────────────────────────────────────────
// Standalone tool: upload one image and reshape it into the standard paid-social
// + display ad sizes, generatively expanding the background (no cropping) and
// upscaling first if the source is too small. Built on fal (data URIs) so an
// auth-behind upload never needs a public URL. Outputs are served via
// /api/brand/file like every other client upload.
router.get('/clients/:clientId/ad-sizes', async (req, res) => {
  res.json({ groups: adResize.catalog(), prices: adResize.prices() });
});

// Accepts one or many images ('files'), plus a legacy single 'file'. Each image
// is reshaped into the selected sizes independently; one image failing doesn't
// sink the rest.
router.post('/clients/:clientId/resize', uploadMem.fields([{ name: 'files', maxCount: 25 }, { name: 'file', maxCount: 1 }]), async (req, res) => {
  try {
    const files = [...(req.files?.files || []), ...(req.files?.file || [])];
    if (!files.length) return res.status(400).json({ error: 'file required' });
    let sizes = req.body?.sizes;
    if (typeof sizes === 'string') {
      try { sizes = JSON.parse(sizes); }
      catch { sizes = sizes.split(',').map(s => s.trim()).filter(Boolean); }
    }
    if (!Array.isArray(sizes) || !sizes.length) return res.status(400).json({ error: 'Pick at least one ad size.' });

    const items = [];
    let total = 0;
    for (const f of files) {
      if (!f.mimetype.startsWith('image/')) { items.push({ name: f.originalname, error: 'Not an image file.' }); continue; }
      try {
        const out = await adResize.resizeImage({
          clientId: req.params.clientId, buffer: f.buffer, sizeKeys: sizes, userId: req.user.id,
        });
        items.push({ name: f.originalname, ...out });
        total += out.spend_usd || 0;
      } catch (err) {
        console.error(`[ad-resize] ${f.originalname} failed:`, err.message);
        items.push({ name: f.originalname, error: err.message });
      }
    }
    const result = { items, spend_usd: +total.toFixed(4) };
    // Persist the run so it can be reopened / bulk-downloaded later. Don't fail
    // the response if the save hiccups — the outputs are already on disk.
    let batch = null;
    try {
      batch = await adResize.recordBatch({
        clientId: req.params.clientId, createdBy: req.user.id,
        sourceCount: files.length, sizeCount: sizes.length, result,
      });
    } catch (e) { console.error('[ad-resize] save batch failed:', e.message); }
    res.json({ batch_id: batch?.id || null, created_at: batch?.created_at || null, ...result });
  } catch (err) {
    console.error('[ad-resize] failed:', err);
    res.status(err.status || 502).json({ error: err.message });
  }
});

// Load a saved batch and assert the caller can see its client. Returns the row
// or sends the response and returns null.
async function loadResizeBatch(req, res) {
  const batch = await adResize.getBatch(req.params.batchId);
  if (!batch) { res.status(404).json({ error: 'Not found' }); return null; }
  if (!users.canAccessClient(req.visibleClientIds, batch.client_id)) {
    res.status(403).json({ error: 'Not authorised' }); return null;
  }
  return batch;
}

// Past resize runs for a client (history list).
router.get('/clients/:clientId/resize-batches', async (req, res) => {
  try { res.json(await adResize.listBatches(req.params.clientId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Full payload for one saved run (re-render a past run).
router.get('/resize-batches/:batchId', async (req, res) => {
  const batch = await loadResizeBatch(req, res); if (!batch) return;
  res.json({ batch_id: batch.id, created_at: batch.created_at, ...(batch.result || {}) });
});

// Download every output in a run as a single .zip.
router.get('/resize-batches/:batchId/download', async (req, res) => {
  const batch = await loadResizeBatch(req, res); if (!batch) return;
  try {
    const bytes = await adResize.zipBatch(batch);
    if (!bytes || !bytes.length) return res.status(404).json({ error: 'No files to download.' });
    const stamp = new Date(batch.created_at).toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="ad-sizes-${stamp}.zip"`);
    res.send(bytes);
  } catch (err) { console.error('[ad-resize] zip failed:', err); res.status(500).json({ error: err.message }); }
});

// Re-run only the failed sizes in a saved run (uses each image's stored source
// — no re-upload). Runs that predate source-saving fall back to a re-upload.
router.post('/resize-batches/:batchId/retry', async (req, res) => {
  const batch = await loadResizeBatch(req, res); if (!batch) return;
  try { res.json(await adResize.retryBatch(batch, { userId: req.user.id })); }
  catch (err) { console.error('[ad-resize] retry failed:', err); res.status(err.status || 502).json({ error: err.message }); }
});

router.delete('/resize-batches/:batchId', async (req, res) => {
  const batch = await loadResizeBatch(req, res); if (!batch) return;
  try { await adResize.deleteBatch(batch); res.status(204).end(); }
  catch (err) { res.status(500).json({ error: err.message }); }
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
