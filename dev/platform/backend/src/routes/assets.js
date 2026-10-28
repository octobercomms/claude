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
const { loadVisibleClientIds, requireClientAccess, assertClientAccess,
  requireAdmin } = require('../middleware/clientAccess');
const assets = require('../services/assets');
const pool = require('../db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const scenes = require('../services/scenes');
const silenceCut = require('../services/silenceCut');
const reelOutcomes = require('../services/reelOutcomes');
const brollRender = require('../services/brollRender');
const { pathToFileURL } = require('url');
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

// ── Silence and filler removal ───────────────────────────────────────────────
//
// Two steps on purpose. `propose` says what it would take out and changes
// nothing; `apply` renders exactly the spans it is handed. An automatic cut
// that removes a deliberate pause is worse than no cut at all, because it is
// harder to notice than it is to fix.

router.post('/assets/:id/cut-proposal', assetAccess, async (req, res) => {
  try {
    if (req.asset.kind !== 'video') return res.status(400).json({ error: 'That asset is not a video.' });
    const source = socialCaptionRender.localPath(req.asset.client_id, req.asset);
    if (!source) return res.status(400).json({ error: 'That clip could not be found on disk.' });
    const plan = await silenceCut.propose({
      source, words: req.body?.words || null, options: req.body?.options || {} });
    res.json(plan);
  } catch (err) {
    console.error('[silence] proposal failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/assets/:id/cut-apply', assetAccess, async (req, res) => {
  try {
    const keep = req.body?.keep;
    if (!Array.isArray(keep) || !keep.length) {
      return res.status(400).json({ error: 'Nothing to keep. Run the proposal first.' });
    }
    if (req.asset.kind !== 'video') return res.status(400).json({ error: 'That asset is not a video.' });
    const clientId = req.asset.client_id;
    const source = socialCaptionRender.localPath(clientId, req.asset);
    if (!source) return res.status(400).json({ error: 'That clip could not be found on disk.' });

    const dir = path.join(UPLOAD_ROOT, clientId);
    fs.mkdirSync(dir, { recursive: true });
    const name = `tightened-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.mp4`;
    const out = await silenceCut.apply({ source, keep, outPath: path.join(dir, name) });

    // A new asset rather than a replacement. The original is what the operator
    // compares against, and an edit that overwrote its own source would make
    // "put it back" impossible.
    const asset = await assets.record({
      client_id: clientId, source: 'upload', source_id: name,
      title: `${req.asset.title || 'Clip'} · tightened`,
      url: `/api/brand/file/${clientId}/${name}`, mime: 'video/mp4',
      duration_s: out.seconds, bytes: out.bytes, created_by: req.user?.id || null,
      metadata: { tightened_from: req.asset.id, spans: out.spans,
        was_s: Number(req.asset.duration_s) || null },
    });
    res.status(201).json({ asset, ...out });
  } catch (err) {
    console.error('[silence] apply failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/**
 * The search terms this client tracks, for the reel checks panel.
 *
 * Its own route rather than part of the outcomes payload: the panel needs
 * these to judge the edit in front of the operator, which it does on every
 * keystroke, while the outcomes are about reels already published.
 */
router.get('/clients/:clientId/reel-keywords',
  requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
    try {
      res.json({ keywords: await reelOutcomes.keywordsFor(req.params.clientId) });
    } catch (err) {
      console.error('[reel-checks] keywords failed:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

/**
 * What the reel checks have been worth for this client.
 *
 * Read-only, and deliberately cheap enough for a panel to call on open: two
 * queries and arithmetic. It answers per check whether the reels that passed it
 * did better than the reels that did not, how many reels are behind that, and
 * what it is still too early to say.
 */
router.get('/clients/:clientId/reel-outcomes',
  requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
    try {
      const days = req.query.days ? Number(req.query.days) : undefined;
      const measure = req.query.measure === 'interaction_multiple'
        ? 'interaction_multiple' : 'reach_multiple';
      res.json(await reelOutcomes.learn(req.params.clientId, { days, measure }));
    } catch (err) {
      console.error('[reel-checks] outcomes failed:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

/**
 * How many library rows point at a file that is no longer there.
 *
 * Answers the only question that matters about an index: whether it is still
 * telling the truth. GET reports without changing anything, so it is safe to
 * look; POST archives what it found, which is what the nightly sweep does on
 * its own at 03:15.
 *
 * Admin only. It reads across every client, which is not a question an
 * account manager scoped to one of them should be able to ask.
 */
router.get('/assets-audit', requireAdmin, async (req, res) => {
  try {
    res.json(await assets.sweepMissingFiles({ dryRun: true }));
  } catch (err) {
    console.error('[assets] audit failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/assets-audit', requireAdmin, async (req, res) => {
  try {
    res.json(await assets.sweepMissingFiles());
  } catch (err) {
    console.error('[assets] sweep failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Where this talking head wants something else on screen.
 *
 * Moments, never footage: nothing here knows what is inside a b-roll clip, and
 * a proposal that guessed would place the wrong shot confidently. The operator
 * chooses what goes in each moment, from their own library.
 */
router.post('/assets/:id/broll-proposal', assetAccess, async (req, res) => {
  try {
    if (req.asset.kind !== 'video') return res.status(400).json({ error: 'That asset is not a video.' });
    const source = socialCaptionRender.localPath(req.asset.client_id, req.asset);
    if (!source) return res.status(400).json({ error: 'That clip could not be found on disk.' });

    // The transcript is the only input. Reuse the caller's words when they
    // have them, which they do straight after a tighten, so one clip is never
    // transcribed twice in a sitting.
    const silenceCutService = require('../services/silenceCut');
    const words = Array.isArray(req.body?.words) && req.body.words.length
      ? req.body.words
      : await silenceCutService.wordsFor(source, null);
    const mediaS = await silenceCutService.durationOf(source);

    const { planBroll } = await import(pathToFileURL(
      path.join(__dirname, '..', '..', '..', 'shared', 'brollPlan.mjs')).href);
    const plan = planBroll(words, { media_s: mediaS, ...(req.body?.options || {}) });
    res.json({ ...plan, words });
  } catch (err) {
    console.error('[broll] proposal failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/**
 * Render the approved placements.
 *
 * Each placement names a library asset, which is resolved here rather than
 * trusted from the browser: a path from a request body is a path someone can
 * choose.
 */
router.post('/assets/:id/broll-apply', assetAccess, async (req, res) => {
  try {
    if (req.asset.kind !== 'video') return res.status(400).json({ error: 'That asset is not a video.' });
    const clientId = req.asset.client_id;
    const source = socialCaptionRender.localPath(clientId, req.asset);
    if (!source) return res.status(400).json({ error: 'That clip could not be found on disk.' });

    const wanted = Array.isArray(req.body?.placements) ? req.body.placements : [];
    if (!wanted.length) return res.status(400).json({ error: 'Choose a clip for at least one moment.' });

    const placements = [];
    for (const p of wanted) {
      const chosen = await assets.get(p.asset_id);
      // Someone else's asset is not a file this request may reach, whatever
      // the body says.
      if (!chosen || chosen.client_id !== clientId) {
        return res.status(400).json({ error: 'One of the chosen clips does not belong to this client.' });
      }
      const file = socialCaptionRender.localPath(clientId, chosen);
      if (!file) return res.status(400).json({ error: `"${chosen.title || 'A clip'}" is not on disk any more.` });
      placements.push({ from: p.from, to: p.to, file });
    }

    const dir = path.join(UPLOAD_ROOT, clientId);
    fs.mkdirSync(dir, { recursive: true });
    const name = `broll-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.mp4`;
    const out = await brollRender.overlay({ source, placements, outPath: path.join(dir, name) });

    // A new asset beside the original, like every other edit: the operator
    // compares the two and throws one away.
    const asset = await assets.record({
      client_id: clientId, source: 'upload', source_id: name,
      title: `${req.asset.title || 'Clip'} · with b-roll`,
      url: `/api/brand/file/${clientId}/${name}`, mime: 'video/mp4',
      duration_s: out.seconds, bytes: out.bytes, created_by: req.user?.id || null,
      metadata: { broll_from: req.asset.id, placements: out.placements },
    });
    res.status(201).json({ asset, ...out });
  } catch (err) {
    console.error('[broll] apply failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
