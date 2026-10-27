/**
 * The client asset library, over HTTP.
 *
 * Read-heavy on purpose. Assets are created by whichever tool produced them,
 * never by posting here: a row in this table is a claim that something exists,
 * and the only thing entitled to make that claim is the thing that made it.
 * What this surface offers is finding, filtering and archiving.
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, assertClientAccess } = require('../middleware/clientAccess');
const assets = require('../services/assets');
const pool = require('../db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const scenes = require('../services/scenes');
const socialCaptionRender = require('../services/socialCaptionRender');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);

router.get('/clients/:clientId/assets',
  requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
    try {
      const { kind, source, search, limit, offset, archived } = req.query;
      const rows = await assets.list(req.params.clientId, {
        kind: kind || null,
        source: source || null,
        search: search || null,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
        includeArchived: archived === '1',
      });
      res.json({
        assets: rows,
        counts: await assets.counts(req.params.clientId),
        // The sources present for THIS client, so the filter offers only what
        // exists rather than a list of eight mostly-empty options.
        sources: [...new Set(rows.map((r) => r.source))].sort(),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

/** Resolve one asset, with its access checked through the client that owns it. */
async function assetAccess(req, res, next) {
  try {
    const row = await assets.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'No such asset' });
    assertClientAccess(req, row.client_id);
    req.asset = row;
    next();
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
}

router.get('/assets/:id', assetAccess, (req, res) => res.json(req.asset));

// Archive, never delete. A scheduled post holding this id must still be able to
// resolve it, and "we made this and dropped it" is worth knowing when the same
// idea comes round again.
router.put('/assets/:id/archived', assetAccess, async (req, res) => {
  try {
    res.json(await assets.archive(req.params.id, req.body?.archived !== false));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/assets/:id/title', assetAccess, async (req, res) => {
  try {
    const title = String(req.body?.title ?? '').slice(0, 300);
    const { rows } = await pool.query(
      'UPDATE client_assets SET title = $1 WHERE id = $2 RETURNING *', [title, req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Scene templates ──────────────────────────────────────────────────────────
//
// A client's photographs into a reel, with no filming. Mounted beside the asset
// library rather than under a section, because the images come from the library
// and the reel goes back into it.

router.get('/scene-templates', (req, res) => {
  try { res.json({ templates: scenes.templates() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * Render one. The images are asset ids, so the only things that reach the
 * renderer are things this client already owns.
 */
router.post('/clients/:clientId/scene-render',
  requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
    const clientId = req.params.clientId;
    try {
      const { template_id: templateId, asset_ids: assetIds, title } = req.body || {};
      if (!templateId) return res.status(400).json({ error: 'Pick a scene template.' });
      if (!Array.isArray(assetIds) || !assetIds.length) {
        return res.status(400).json({ error: 'Pick at least one image.' });
      }
      if (assetIds.length > 20) {
        // Not a technical limit. Twenty slots at two seconds is forty seconds,
        // past the length anything holds attention, and the render grows with it.
        return res.status(400).json({ error: 'Twenty images is the most a reel should carry.' });
      }

      const images = [];
      for (const id of assetIds) {
        const a = await assets.get(id);
        if (!a) return res.status(404).json({ error: `No such asset: ${id}` });
        if (a.client_id !== clientId) {
          return res.status(403).json({ error: 'One of those assets belongs to a different client.' });
        }
        if (a.kind !== 'image') return res.status(400).json({ error: `${a.title || id} is not an image.` });
        const local = socialCaptionRender.localPath(clientId, a);
        if (!local) return res.status(400).json({ error: `${a.title || id} could not be found on disk.` });
        images.push(local);
      }

      const dir = path.join(UPLOAD_ROOT, clientId);
      fs.mkdirSync(dir, { recursive: true });
      const name = `scene-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.mp4`;
      const outPath = path.join(dir, name);
      const out = await scenes.render({ templateId, images, outPath });

      const asset = await assets.record({
        client_id: clientId, source: 'scene_render', source_id: name,
        title: title || `${scenes.template(templateId).name} · ${out.slots} images`,
        url: `/api/brand/file/${clientId}/${name}`, mime: 'video/mp4',
        width: out.width, height: out.height, duration_s: out.seconds,
        bytes: fs.statSync(outPath).size, created_by: req.user?.id || null,
        metadata: { template: templateId, from: assetIds },
      });
      res.status(201).json({ asset, seconds: out.seconds, slots: out.slots });
    } catch (err) {
      console.error('[scenes] render failed:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

module.exports = router;
