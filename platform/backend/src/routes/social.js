const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const {
  loadVisibleClientIds, requireClientAccess, assertClientAccess,
} = require('../middleware/clientAccess');
const social = require('../services/social');
const replicate = require('../connectors/replicate');
const ideogram = require('../connectors/ideogram');
const adobe = require('../connectors/adobe');
const meta = require('../connectors/meta');
const users = require('../services/users');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// Per-post and per-batch UUIDs resolve to a client; reuse the pattern
// from outreach.js so a viewer can't reach into another tenant's batch.
router.param('id', async (req, res, next, id) => {
  try {
    const path = req.path;
    let q;
    if (path.startsWith('/batches/')) q = 'SELECT client_id FROM social_batches WHERE id = $1';
    else if (path.startsWith('/posts/')) q = 'SELECT client_id FROM social_posts WHERE id = $1';
    if (q) {
      const { rows } = await pool.query(q, [id]);
      if (rows.length && !users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
        return res.status(403).json({ error: 'Not authorised for this client' });
      }
    }
    next();
  } catch (err) {
    next(err);
  }
});

// ─── BATCHES + POSTS ──────────────────────────────────────────────────────

router.get('/clients/:clientId/batches', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*,
              (SELECT COUNT(*)::int FROM social_posts p WHERE p.batch_id = b.id) AS post_count
       FROM social_batches b WHERE b.client_id = $1
       ORDER BY b.created_at DESC LIMIT 50`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/clients/:clientId/posts', async (req, res) => {
  try {
    const { batch_id } = req.query;
    const params = [req.params.clientId];
    let where = 'client_id = $1';
    if (batch_id) { params.push(batch_id); where += ` AND batch_id = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT * FROM social_posts WHERE ${where} ORDER BY position ASC, created_at ASC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/generate', async (req, res) => {
  const { brief, platforms } = req.body || {};
  try {
    const result = await social.generateBatch({ clientId: req.params.clientId, brief, platforms });
    res.status(201).json(result);
  } catch (err) {
    console.error('[social] generate failed:', err);
    res.status(502).json({ error: err.message });
  }
});

router.put('/posts/:id', async (req, res) => {
  const { hook, caption, hashtags, visual_concept, storyboard, status, notes } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE social_posts SET
        hook = COALESCE($1, hook),
        caption = COALESCE($2, caption),
        hashtags = COALESCE($3, hashtags),
        visual_concept = COALESCE($4, visual_concept),
        storyboard = COALESCE($5::jsonb, storyboard),
        status = COALESCE($6, status),
        notes = COALESCE($7, notes)
       WHERE id = $8 RETURNING *`,
      [
        hook ?? null, caption ?? null,
        hashtags === undefined ? null : hashtags,
        visual_concept ?? null,
        storyboard === undefined ? null : JSON.stringify(storyboard),
        status ?? null,
        notes ?? null,
        req.params.id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/posts/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM social_posts WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/batches/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM social_batches WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── IMAGE GENERATION ─────────────────────────────────────────────────────

router.post('/posts/:id/image', async (req, res) => {
  const { provider = 'replicate', style_brief, aspect_ratio, seed, reference_image } = req.body || {};
  try {
    const { rows } = await pool.query('SELECT * FROM social_posts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    const post = rows[0];

    // Compose the image prompt from the post's visual concept + the AM's
    // optional style brief (e.g. "Josef Müller-Brockmann style"). The
    // visual concept already came out of Claude as a one-paragraph
    // direction so we can hand it to Flux / Ideogram directly.
    const prompt = [
      post.visual_concept || `${post.kind} for ${post.platform}: ${post.hook || post.caption?.slice(0, 80) || ''}`,
      style_brief ? `Style: ${style_brief}` : '',
    ].filter(Boolean).join('\n');

    let result;
    if (provider === 'ideogram') {
      result = await ideogram.generate({ prompt, aspect_ratio: aspect_ratio || '1:1', seed });
    } else if (provider === 'adobe') {
      result = await adobe.generate({ prompt, aspect_ratio: aspect_ratio || '1:1', seed, reference_image });
    } else {
      result = await replicate.generate({ prompt, aspect_ratio: aspect_ratio || '1:1', seed, reference_image });
    }
    // Append the new URL to the post's image_urls array.
    const { rows: updated } = await pool.query(
      `UPDATE social_posts SET image_urls = array_append(image_urls, $1) WHERE id = $2 RETURNING *`,
      [result.url, req.params.id]
    );
    res.status(201).json({ post: updated[0], image: result, prompt });
  } catch (err) {
    console.error('[social] image generate failed:', err);
    res.status(502).json({ error: err.message });
  }
});

// ─── PUBLISH + PERFORMANCE LOOP ───────────────────────────────────────────
//
// Mark a draft post as published. The AM pastes the live Instagram /
// TikTok / LinkedIn URL; we parse the platform-side id and fetch a
// first engagement snapshot so the loop kicks in immediately.
router.post('/posts/:id/publish', async (req, res) => {
  const { published_url } = req.body || {};
  if (!published_url) return res.status(400).json({ error: 'published_url required' });
  try {
    const parsed = meta.parseSocialUrl(published_url);
    if (!parsed) return res.status(400).json({ error: 'Could not recognise that URL. Supported: Instagram, TikTok, LinkedIn.' });
    const { rows: existing } = await pool.query('SELECT * FROM social_posts WHERE id = $1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Post not found' });

    const { rows } = await pool.query(
      `UPDATE social_posts SET
         status = 'published',
         published_url = $1,
         external_id = $2,
         external_platform = $3,
         published_at = COALESCE(published_at, NOW())
       WHERE id = $4 RETURNING *`,
      [published_url, parsed.external_id, parsed.platform, req.params.id]
    );
    const post = rows[0];

    // Best-effort first snapshot — never block the response on it.
    let firstSnapshot = null;
    try {
      const result = await social.refreshEngagement(post);
      firstSnapshot = result;
    } catch (err) {
      firstSnapshot = { skipped: true, reason: err.message };
    }
    res.json({ post, parsed, snapshot: firstSnapshot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pull a fresh engagement snapshot for a single post on demand.
router.post('/posts/:id/refresh-insights', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM social_posts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    const result = await social.refreshEngagement(rows[0]);
    if (result.skipped) return res.status(400).json({ error: result.reason });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Latest engagement snapshot per published post for a client. Used by the
// Winners panel + by the post cards to render their numbers.
router.get('/clients/:clientId/engagement', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (e.post_id)
         e.post_id, e.fetched_at, e.impressions, e.reach, e.views,
         e.likes, e.comments, e.shares, e.saves, e.watch_time_sec
       FROM social_post_engagement e
       JOIN social_posts p ON p.id = e.post_id
       WHERE p.client_id = $1
       ORDER BY e.post_id, e.fetched_at DESC`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/clients/:clientId/winners', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 90, 365);
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const winners = await social.getRecentWinners(req.params.clientId, { days, limit });
    res.json(winners);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Drop an image from a post (e.g. user didn't like a generation).
router.delete('/posts/:id/image', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    await pool.query('UPDATE social_posts SET image_urls = array_remove(image_urls, $1) WHERE id = $2', [url, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── COMPETITORS ─────────────────────────────────────────────────────────

router.get('/clients/:clientId/competitors', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT social_competitors FROM clients WHERE id = $1', [req.params.clientId]);
    res.json({ competitors: rows[0]?.social_competitors || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/clients/:clientId/competitors', async (req, res) => {
  const list = Array.isArray(req.body?.competitors) ? req.body.competitors.map(String).filter(Boolean).slice(0, 6) : [];
  try {
    await pool.query('UPDATE clients SET social_competitors = $1 WHERE id = $2', [list, req.params.clientId]);
    res.json({ competitors: list });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
