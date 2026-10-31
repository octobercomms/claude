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
// Generated assets are fetched off the provider's CDN and kept here — see
// services/generatedMedia.js for why that is not optional.
const generatedMedia = require('../services/generatedMedia');

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
  const { headline, body, cta, angle, visual_concept, status, notes, show_to_client } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE ad_creatives SET
        headline = COALESCE($1, headline),
        body = COALESCE($2, body),
        cta = COALESCE($3, cta),
        angle = COALESCE($4, angle),
        visual_concept = COALESCE($5, visual_concept),
        status = COALESCE($6, status),
        notes = COALESCE($7, notes),
        show_to_client = COALESCE($9, show_to_client)
       WHERE id = $8 RETURNING *`,
      [headline ?? null, body ?? null, cta ?? null, angle ?? null,
       visual_concept ?? null, status ?? null, notes ?? null, req.params.id,
       // Explicitly boolean-or-null: `false ?? null` is false, which is the
       // whole point — COALESCE must see the false and write it, where a
       // falsy check would have discarded the only value anyone sets here.
       typeof show_to_client === 'boolean' ? show_to_client : null]
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

// Launch's hand-off: the whole batch as a zip — copy.csv plus every rendered
// asset — so the AM can build it in Ads Manager by hand.
//
// `:id` and not `:batchId`, deliberately: router.param('id') above is what
// checks the caller may see this client, and it keys on that exact name. A
// route named `:batchId` here would serve any batch to anyone, which is how
// the resize-batches routes below ended up needing a loader of their own.
//
// The counts go in headers as well as the zip, so the UI can say what came
// back without unzipping it, and so a short download is visible immediately.
router.get('/batches/:id/export', async (req, res) => {
  try {
    const out = await require('../services/adExport').exportBatch(req.params.id);
    if (!out) return res.status(404).json({ error: 'Batch not found' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.setHeader('X-Export-Assets', String(out.counts.assets));
    res.setHeader('X-Export-Missing', String(out.counts.missing));
    res.setHeader('Access-Control-Expose-Headers', 'X-Export-Assets, X-Export-Missing');
    res.send(out.buffer);
  } catch (err) {
    console.error('[ad-export] failed:', err);
    res.status(500).json({ error: err.message });
  }
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
      // The still the clip is built from. Replicate fetches a URL it is
      // given, and OMI's own files sit behind authentication at a relative
      // path, so a stored asset is handed over as a data URI instead. The
      // alternative — passing /api/brand/file/… — is a reference Replicate
      // silently cannot read, and an image-to-video model given no image
      // produces a clip of something else entirely.
      let referenceImage = null;
      if (from_image_id) {
        const { rows: ir } = await pool.query(
          'SELECT url, source_url FROM ad_creative_images WHERE id = $1 AND creative_id = $2',
          [from_image_id, creative.id]
        );
        if (ir.length) {
          const local = generatedMedia.localPathFor(ir[0].url);
          if (local) {
            try {
              const buf = await fs.promises.readFile(local);
              // Replicate takes a data URI up to around 10MB. A render is
              // well under that; the guard is for a fan-out of something
              // enormous, where the provider link is the better route.
              if (buf.length > 8 * 1024 * 1024) throw new Error('too large to inline');
              referenceImage = `data:${generatedMedia.mimeFor(local)};base64,${buf.toString('base64')}`;
            } catch (err) {
              referenceImage = ir[0].source_url || null;
              if (!referenceImage) {
                return res.status(409).json({
                  error: `The still this clip would be built from could not be read: ${err.message}.`,
                });
              }
            }
          } else {
            referenceImage = ir[0].source_url || ir[0].url;
          }
        }
      }
      const generated = [];
      for (const aspect of aspect_ratios) {
        try {
          const result = await replicate.generateVideo({
            prompt: promptBase, aspect_ratio: aspect, duration: clipDuration,
            reference_image: referenceImage, seed,
          });
          const kept = await generatedMedia.storeOrKeep({
            clientId: creative.client_id, url: result.url,
            stem: `video-${aspect.replace(':', 'x')}`,
          });
          const { rows: row } = await pool.query(
            `INSERT INTO ad_creative_images
             (creative_id, provider, aspect_ratio, url, prompt, media_type, duration_seconds,
              source_url, stored_bytes)
             VALUES ($1, $2, $3, $4, $5, 'video', $6, $7, $8) RETURNING *`,
            [creative.id, 'replicate-video', aspect, kept.url, promptBase, clipDuration,
             kept.source_url || null, kept.bytes ?? null]
          );
          generated.push({ ...row[0], stored: kept.stored, store_error: kept.stored ? undefined : kept.reason });
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
        const kept = await generatedMedia.storeOrKeep({
          clientId: creative.client_id, url: result.url,
          stem: `${provider}-${aspect.replace(':', 'x')}`,
        });
        const { rows: row } = await pool.query(
          `INSERT INTO ad_creative_images
             (creative_id, provider, aspect_ratio, url, prompt, source_url, stored_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [creative.id, provider, aspect, kept.url, promptBase,
           kept.source_url || null, kept.bytes ?? null]
        );
        generated.push({ ...row[0], stored: kept.stored, store_error: kept.stored ? undefined : kept.reason });
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

// Fan one image out to other aspect ratios, expanding the background rather
// than cropping it — the same composition reshaped, without re-prompting the
// generator and paying for a new render.
//
// This ran on the Photoshop API until the assets moved onto this box. That
// API takes the source as a URL it fetches itself, and OMI's own files live
// behind authentication at a relative path, so it could never read them: the
// fan-out was already broken for any uploaded source and would have broken
// for every source once generated output stopped living on a provider CDN.
//
// It runs on the same expand path the Resize tool uses instead, which takes
// the bytes as a data URI and needs nothing public. Three things follow from
// that: an upload can be fanned out for the first time, the output is already
// stored here, and the spend is logged per call the way Resize's is.
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
    if (src.media_type === 'video') {
      return res.status(400).json({ error: 'Fan-out reshapes a still image. Render the video at the ratio you need instead.' });
    }

    // The bytes, wherever they are. Normally the file is on this box; a row
    // from before assets were kept here still points at a provider CDN, and
    // that link may have expired, which is worth saying plainly rather than
    // failing as "expand returned no image".
    let buffer;
    try {
      buffer = await generatedMedia.readBytes(src, {
        // A row that had to be re-fetched is kept, so the next read is local.
        onKept: (got) => pool.query(
          'UPDATE ad_creative_images SET url = $1, source_url = COALESCE(source_url, $2), stored_bytes = $3 WHERE id = $4',
          [got.url, src.source_url || src.url, got.bytes, src.id]
        ).catch(() => {}),
      });
    } catch (err) {
      return res.status(409).json({
        error: `The source image could not be read: ${err.message}. Re-render this concept, or upload the image, and the copy will be kept here.`,
      });
    }

    // Explicit sizes, not catalogue keys: 16:9 is a real 16:9 here, where the
    // ad-size catalogue's nearest entry is 1.91:1.
    const SIZES = {
      '1:1':  { w: 1024, h: 1024 },
      '4:5':  { w: 1024, h: 1280 },
      '9:16': { w: 1024, h: 1820 },
      '16:9': { w: 1792, h: 1024 },
    };
    const wanted = aspect_ratios
      .filter(a => SIZES[a] && a !== src.aspect_ratio)
      .map(a => ({ key: `fanout-${a.replace(':', 'x')}`, label: a, ratio: a, family: 'Ad creative', ...SIZES[a] }));
    if (!wanted.length) {
      return res.status(400).json({ error: 'No new aspect ratios to produce — pick a shape this image is not already in.' });
    }

    // saveSource false: the source is already a row in this table, so keeping
    // a second copy of it would just litter the client's folder.
    const result = await adResize.resizeImage({
      clientId: src.client_id, buffer, sizes: wanted, userId: req.user?.id, saveSource: false,
    });

    const generated = [];
    for (const out of result.outputs) {
      if (out.error || !out.url) {
        generated.push({ aspect_ratio: out.ratio, error: out.error || 'no image produced' });
        continue;
      }
      const bytes = adResize.sizeOnDisk(out.url);
      const { rows: row } = await pool.query(
        `INSERT INTO ad_creative_images
           (creative_id, provider, aspect_ratio, url, prompt, stored_bytes)
         VALUES ($1, 'fal-expand', $2, $3, $4, $5) RETURNING *`,
        [src.creative_id, out.ratio, out.url,
         `Expanded from the ${src.aspect_ratio} render`, bytes]
      );
      generated.push({ ...row[0], method: out.method });
    }
    res.status(201).json({ source_image_id: src.id, generated, spend_usd: result.spend_usd });
  } catch (err) {
    console.error('[ad-creative] fan-out failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Keep whatever is still keepable.
//
// Every row written before generated assets were stored here points at a
// provider CDN. Some of those links are dead already and nothing recovers
// them; the ones from the last day or two are alive, and this is the only
// chance to keep them. One pass per client, reporting what it managed.
//
// Ordered newest first for that reason: the recent rows are the ones with a
// live link, so a run that hits the time limit has spent it on the assets it
// could actually save.
router.post('/clients/:clientId/images/backfill', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.body?.limit) || 200, 1), 1000);
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.url, i.source_url, i.aspect_ratio, i.provider, c.client_id
         FROM ad_creative_images i
         JOIN ad_creatives c ON c.id = i.creative_id
        WHERE c.client_id = $1 AND i.stored_bytes IS NULL
        ORDER BY i.created_at DESC
        LIMIT $2`,
      [req.params.clientId, limit]
    );

    let stored = 0, bytes = 0, expired = 0, skipped = 0;
    const failures = [];
    for (const row of rows) {
      // Already ours and simply never measured: record the size and move on,
      // so the row stops coming back in this query.
      const local = generatedMedia.localPathFor(row.url);
      if (local) {
        let size = null;
        try { size = fs.statSync(local).size; } catch { /* gone */ }
        if (size) {
          await pool.query('UPDATE ad_creative_images SET stored_bytes = $1 WHERE id = $2', [size, row.id]);
          stored++; bytes += size;
        } else {
          skipped++;
          failures.push({ id: row.id, aspect_ratio: row.aspect_ratio, reason: 'local file missing' });
        }
        continue;
      }

      const kept = await generatedMedia.storeOrKeep({
        clientId: row.client_id, url: row.source_url || row.url,
        stem: `${row.provider || 'ad'}-${String(row.aspect_ratio || '').replace(':', 'x')}`,
      });
      if (kept.stored) {
        await pool.query(
          'UPDATE ad_creative_images SET url = $1, source_url = COALESCE(source_url, $2), stored_bytes = $3 WHERE id = $4',
          [kept.url, row.source_url || row.url, kept.bytes, row.id]
        );
        stored++; bytes += kept.bytes;
      } else {
        expired++;
        failures.push({ id: row.id, aspect_ratio: row.aspect_ratio, reason: kept.reason });
      }
    }

    res.json({
      examined: rows.length,
      stored, expired, skipped,
      bytes,
      // Capped: a client with hundreds of dead links does not need every one
      // listed back, and the count is the part that matters.
      failures: failures.slice(0, 25),
      more: rows.length === limit,
    });
  } catch (err) {
    console.error('[ad-creative] backfill failed:', err.message);
    res.status(500).json({ error: err.message });
  }
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
    // A library image that could not be read. Reported rather than only
    // logged: "I picked four and got three back" needs an answer on screen.
    const libraryFailures = [];

    // Creative picked out of this client's library rather than uploaded. The
    // request names image **ids**, never URLs: the server looks each one up,
    // refuses any that does not belong to this client, and fetches only the
    // URL it stored itself. Taking a URL from the client would be an open
    // proxy pointed at whatever the caller fancied.
    let imageIds = req.body?.image_ids;
    if (typeof imageIds === 'string') {
      try { imageIds = JSON.parse(imageIds); }
      catch { imageIds = imageIds.split(',').map(x => x.trim()).filter(Boolean); }
    }
    if (Array.isArray(imageIds) && imageIds.length) {
      const { rows: imgs } = await pool.query(
        `SELECT i.id, i.url, i.source_url, i.media_type, c.client_id
           FROM ad_creative_images i
           JOIN ad_creatives c ON c.id = i.creative_id
          WHERE i.id = ANY($1::uuid[]) AND c.client_id = $2
          LIMIT 25`,
        [imageIds.slice(0, 25), req.params.clientId]
      );
      for (const img of imgs) {
        if ((img.media_type || 'image') !== 'image') continue;
        try {
          // Read through generatedMedia.readBytes, not fetch(). These urls are local
          // paths, and fetch() cannot take a relative one: it threw
          // "Failed to parse URL" on every upload picked out of the library,
          // and logged it where nobody was looking while the UI reported a
          // resize of nothing.
          const buffer = await generatedMedia.readBytes(img, {
            onKept: (got) => pool.query(
              'UPDATE ad_creative_images SET url = $1, source_url = COALESCE(source_url, $2), stored_bytes = $3 WHERE id = $4',
              [got.url, img.source_url || img.url, got.bytes, img.id]
            ).catch(() => {}),
          });
          const ext = path.extname(String(img.url).split('?')[0]).toLowerCase() || '.png';
          files.push({
            originalname: `library-${img.id}${/^\.(png|jpe?g|webp|gif|avif)$/.test(ext) ? ext : '.png'}`,
            mimetype: generatedMedia.mimeFor(ext),
            buffer,
          });
        } catch (err) {
          console.error(`[ad-resize] library image ${img.id} failed:`, err.message);
          libraryFailures.push({ id: img.id, reason: err.message });
        }
      }
    }

    if (!files.length) {
      return res.status(libraryFailures.length ? 409 : 400).json({
        error: libraryFailures.length
          ? `None of the chosen images could be read: ${libraryFailures.map(f => f.reason).join('; ')}`
          : 'file required',
        library_failures: libraryFailures.length ? libraryFailures : undefined,
      });
    }
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
    const result = {
      items, spend_usd: +total.toFixed(4),
      library_failures: libraryFailures.length ? libraryFailures : undefined,
    };
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
