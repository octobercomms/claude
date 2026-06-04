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
const arcads = require('../connectors/arcads');
const elevenlabs = require('../connectors/elevenlabs');
const crypto = require('crypto');
const meta = require('../connectors/meta');
const productionBrief = require('../services/productionBrief');
const remotionRender = require('../services/remotionRender');

function signBriefToken(postId, expiresAtSec) {
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${postId}.${expiresAtSec}`).digest('hex');
  return `${expiresAtSec}.${sig}`;
}
function verifyBriefToken(postId, token) {
  if (!token || typeof token !== 'string') return false;
  const [expStr, sig] = token.split('.');
  if (!expStr || !sig) return false;
  const exp = parseInt(expStr, 10);
  if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${postId}.${exp}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
  } catch { return false; }
}
const users = require('../services/users');

const router = express.Router();

// Public-style printable brief — accepts a short-lived signed token via
// query string so window.open works from the AM's browser. Lives above
// router.use(authenticate) so the route handler runs without a Bearer
// header.
router.get('/brief/:id.html', async (req, res) => {
  try {
    if (!verifyBriefToken(req.params.id, req.query.token)) {
      return res.status(403).send('Invalid or expired token');
    }
    const { rows } = await pool.query(
      `SELECT p.*, c.name AS client_name FROM social_posts p JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Post not found');
    const html = productionBrief.buildBriefHtml(rows[0], { name: rows[0].client_name });
    res.type('html').send(html);
  } catch (err) { res.status(500).send(err.message); }
});

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

// ─── VIDEO + AUDIO ────────────────────────────────────────────────────────
//
// Per-post UGC video via Arcads. The script defaults to the storyboard's
// voiceover lines concatenated; the AM can override. Long-running — we
// keep the request open and let the page show a spinner.
router.post('/posts/:id/video', async (req, res) => {
  const { script, actor_id, aspect_ratio } = req.body || {};
  try {
    const { rows } = await pool.query('SELECT * FROM social_posts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    const post = rows[0];
    const finalScript = script || defaultScriptFromStoryboard(post) || post.caption;
    if (!finalScript) return res.status(400).json({ error: 'No script — either pass one or fill out the storyboard.' });

    const result = await arcads.generateVideo({
      script: finalScript, actor_id,
      aspect_ratio: aspect_ratio || (post.kind === 'reel' || post.kind === 'story' ? '9:16' : '1:1'),
    });
    const { rows: row } = await pool.query(
      `INSERT INTO social_post_media (post_id, kind, provider, url, duration_sec, metadata)
       VALUES ($1, 'video', 'arcads', $2, $3, $4) RETURNING *`,
      [post.id, result.url, result.duration_sec, JSON.stringify({ actor_id: result.actor_id, job_id: result.job_id, script: finalScript })]
    );
    res.status(201).json({ media: row[0] });
  } catch (err) {
    console.error('[social] arcads video failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Per-post voiceover via ElevenLabs. Same defaulting logic as video.
router.post('/posts/:id/voiceover', async (req, res) => {
  const { script, voice_id } = req.body || {};
  try {
    const { rows } = await pool.query('SELECT * FROM social_posts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    const post = rows[0];
    const finalScript = script || defaultScriptFromStoryboard(post) || post.caption;
    if (!finalScript) return res.status(400).json({ error: 'No script — either pass one or fill out the storyboard.' });

    const result = await elevenlabs.generateVoiceover({ text: finalScript, voice_id, client_id: post.client_id });
    const { rows: row } = await pool.query(
      `INSERT INTO social_post_media (post_id, kind, provider, url, duration_sec, metadata)
       VALUES ($1, 'audio', 'elevenlabs', $2, $3, $4) RETURNING *`,
      [post.id, result.url, result.duration_sec, JSON.stringify({ voice_id: result.voice_id, script: finalScript })]
    );
    res.status(201).json({ media: row[0] });
  } catch (err) {
    console.error('[social] elevenlabs voiceover failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Return all media (video + audio) for a post — used by the card to render
// the players inline.
router.get('/posts/:id/media', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM social_post_media WHERE post_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/media/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, p.client_id FROM social_post_media m
       JOIN social_posts p ON p.id = m.post_id WHERE m.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(204).end();
    if (!users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised' });
    }
    await pool.query('DELETE FROM social_post_media WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function defaultScriptFromStoryboard(post) {
  const frames = post.storyboard || [];
  return frames.map(f => f.voiceover).filter(Boolean).join(' ');
}

// ─── PRODUCTION BRIEF ─────────────────────────────────────────────────────
// Per-post shot list for filming, following October's Video Style System.
// Two formats from the same source: markdown for the API + HTML for a
// printable page the AM opens in a new tab.
router.get('/posts/:id/brief', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM social_posts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    res.json({ markdown: productionBrief.buildBriefMarkdown(rows[0]) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── REMOTION RENDER (A / C / G) ──────────────────────────────────────────
// Walks the storyboard, picks every frame tagged A, C or G, renders each
// via Remotion using the client's brand colour. Result lands as
// social_post_media rows with kind='motion' + provider='remotion' so the
// card shows the MP4s inline alongside any UGC video or voiceover.
router.post('/posts/:id/render-templates', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM social_posts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    const post = rows[0];

    const targets = (post.storyboard || []).filter(f => ['A', 'C', 'G'].includes(f.style));
    if (!targets.length) return res.status(400).json({ error: 'No A/C/G frames in this post — only reels with the Video Style System grammar can auto-render.' });

    const { rows: brandAssets } = await pool.query(
      'SELECT id, kind, metadata FROM brand_assets WHERE client_id = $1',
      [post.client_id]
    );

    const rendered = [];
    for (const frame of targets) {
      try {
        const result = await remotionRender.renderFrameForPost(post, frame, brandAssets);
        const { rows: row } = await pool.query(
          `INSERT INTO social_post_media (post_id, kind, provider, url, duration_sec, metadata)
           VALUES ($1, 'motion', 'remotion', $2, $3, $4) RETURNING *`,
          [
            post.id, result.url, result.duration_sec,
            JSON.stringify({ style: frame.style, frame: frame.frame, on_screen_text: frame.on_screen_text }),
          ]
        );
        rendered.push(row[0]);
      } catch (err) {
        console.error(`[remotion] frame ${frame.frame} (${frame.style}) failed:`, err.message);
        rendered.push({ style: frame.style, frame: frame.frame, error: err.message });
      }
    }
    res.status(201).json({ rendered });
  } catch (err) {
    console.error('[remotion] render-templates failed:', err);
    res.status(502).json({ error: err.message });
  }
});

router.get('/posts/:id/brief-url', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM social_posts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    const expiresAt = Math.floor(Date.now() / 1000) + 300;     // 5 minutes
    const token = signBriefToken(req.params.id, expiresAt);
    res.json({ url: `/api/social/brief/${req.params.id}.html?token=${encodeURIComponent(token)}`, expires_at: expiresAt });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

router.get('/clients/:clientId/framework-breakdown', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 90, 365);
    const breakdown = await social.getFrameworkBreakdown(req.params.clientId, { days });
    res.json(breakdown);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Trending TikTok sounds — list latest cached + on-demand refresh.
router.get('/clients/:clientId/trending-sounds', async (req, res) => {
  try {
    const sounds = await social.getRecentTrendingSounds(req.params.clientId, { limit: 25 });
    res.json({ sounds });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/trending-sounds/refresh', async (req, res) => {
  try {
    const region = (req.body?.region || 'GB').toUpperCase();
    const sounds = await social.refreshTrendingSounds({ clientId: req.params.clientId, region });
    res.json({ sounds, fetched_at: new Date().toISOString() });
  } catch (err) {
    console.error('[social] trending-sounds refresh failed:', err);
    res.status(502).json({ error: err.message });
  }
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

// ─── Social Post Planner (conversational) ────────────────────────
// Per-client list of detailed plans + chat-based refinement. Replaces
// the batch flow above eventually — they run side-by-side for now.
const socialPlanner = require('../services/socialPlanner');
const chatExport = require('../services/chatExport');
const multer = require('multer');

// Same upload constraints as the report-template chat — 25MB cap on
// memoryStorage, PDF/image mime allowlist. Errors come back as JSON
// instead of express's HTML 500 default.
const PLAN_UPLOAD_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const planChatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (PLAN_UPLOAD_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}. Attach a PDF or image.`));
  },
});
function handlePlanChatUpload(req, res, next) {
  planChatUpload.single('attachment')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

router.get('/clients/:clientId/plans', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, status, scheduled_at, target_platforms, updated_at, created_at
         FROM social_post_plans WHERE client_id = $1 ORDER BY updated_at DESC`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/clients/:clientId/plans/:planId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, client_id, title, plan, status, scheduled_at, drive_folder_url, target_platforms, updated_at
         FROM social_post_plans WHERE id = $1 AND client_id = $2`,
      [req.params.planId, req.params.clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Chat endpoint accepts JSON or multipart. With multipart, `history`
// arrives as a JSON-encoded form field and `attachment` is the file —
// same pattern as the report-template chat upload.
router.post('/clients/:clientId/plans/chat', handlePlanChatUpload, async (req, res) => {
  let history, current_plan;
  if (typeof req.body?.history === 'string') {
    try { history = JSON.parse(req.body.history); } catch { return res.status(400).json({ error: 'history must be valid JSON' }); }
    if (typeof req.body?.current_plan === 'string') {
      try { current_plan = JSON.parse(req.body.current_plan); } catch { current_plan = null; }
    }
  } else {
    history = req.body?.history;
    current_plan = req.body?.current_plan;
  }
  if (!Array.isArray(history) || !history.length) return res.status(400).json({ error: 'history is required' });
  try {
    const c = (await pool.query('SELECT id, name, briefing_field, monthly_focus FROM clients WHERE id = $1', [req.params.clientId])).rows[0];
    if (!c) return res.status(404).json({ error: 'Client not found' });
    const attachment = req.file
      ? { buffer: req.file.buffer, mimeType: req.file.mimetype, filename: req.file.originalname }
      : null;
    const result = await socialPlanner.chatBuildPlan({ client: c, currentPlan: current_plan || null, history, attachment });
    res.json(result);
  } catch (err) {
    console.error('[social planner chat] failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/clients/:clientId/plans/:planId', async (req, res) => {
  const { title, plan } = req.body || {};
  const err = socialPlanner.validatePlan(plan);
  if (err) return res.status(400).json({ error: err });
  try {
    const { rows } = await pool.query(
      `UPDATE social_post_plans SET title = $1, plan = $2, status = 'locked', updated_at = NOW()
       WHERE id = $3 AND client_id = $4 RETURNING id, title, plan, status, updated_at`,
      [title || plan.title || 'Untitled plan', JSON.stringify(plan), req.params.planId, req.params.clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
    res.json(rows[0]);
  } catch (err2) { res.status(500).json({ error: err2.message }); }
});

router.post('/clients/:clientId/plans', async (req, res) => {
  const { title, plan } = req.body || {};
  try {
    const { rows } = await pool.query(
      `INSERT INTO social_post_plans (client_id, title, plan, status)
       VALUES ($1, $2, $3, $4) RETURNING id, title, plan, status, updated_at`,
      [req.params.clientId, title || plan?.title || 'Untitled plan', JSON.stringify(plan || {}), plan ? 'locked' : 'draft']
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Autopilot config — schedule + Drive folder + which platforms. Once
// set, the publisher cron picks up the plan at scheduled_at, reads the
// Drive folder, generates per-platform captions, and posts. Phase 1
// stores the config only; publisher worker lands in Phase 2.
router.patch('/clients/:clientId/plans/:planId/schedule', async (req, res) => {
  const { scheduled_at, drive_folder_url, target_platforms } = req.body || {};
  const ALLOWED = new Set(['instagram', 'facebook', 'linkedin']);
  const platforms = Array.isArray(target_platforms) ? target_platforms.filter(p => ALLOWED.has(p)) : null;
  try {
    const { rows } = await pool.query(
      `UPDATE social_post_plans
          SET scheduled_at = COALESCE($1::timestamptz, scheduled_at),
              drive_folder_url = COALESCE($2, drive_folder_url),
              target_platforms = COALESCE($3, target_platforms),
              updated_at = NOW()
        WHERE id = $4 AND client_id = $5
        RETURNING id, title, scheduled_at, drive_folder_url, target_platforms`,
      [scheduled_at ?? null, drive_folder_url ?? null, platforms, req.params.planId, req.params.clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Phase 2 — preview what's in the Drive folder so the AM can confirm
// the right files are there before the scheduled publish time.
router.get('/clients/:clientId/plans/:planId/drive-files', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT drive_folder_url FROM social_post_plans WHERE id = $1 AND client_id = $2`,
      [req.params.planId, req.params.clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
    if (!rows[0].drive_folder_url) return res.json({ files: [], note: 'No Drive folder set on this plan.' });
    const socialDrive = require('../services/socialDrive');
    const files = await socialDrive.listFolder(req.params.clientId, rows[0].drive_folder_url);
    res.json({ files });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Phase 2 — preview the captions Claude will use per platform, so the
// AM can sanity-check before publish. Computed on demand, not stored
// (so the AM can iterate by editing the plan and re-previewing).
router.post('/clients/:clientId/plans/:planId/preview-captions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT plan, target_platforms FROM social_post_plans WHERE id = $1 AND client_id = $2`,
      [req.params.planId, req.params.clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
    const { plan, target_platforms } = rows[0];
    if (!target_platforms?.length) return res.status(400).json({ error: 'No target platforms set on this plan.' });
    const socialCaptions = require('../services/socialCaptions');
    const captions = await socialCaptions.captionsForPlan(plan, target_platforms);
    res.json({ captions });
  } catch (err) {
    console.error('[social caption preview] failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/clients/:clientId/plans/:planId/publications', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, platform, scheduled_at, status, caption, posted_at, posted_url, error_message, attempts
         FROM social_post_publications
        WHERE plan_id = $1 AND client_id = $2
        ORDER BY scheduled_at ASC, platform ASC`,
      [req.params.planId, req.params.clientId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/clients/:clientId/plans/:planId', async (req, res) => {
  try {
    await pool.query('DELETE FROM social_post_plans WHERE id = $1 AND client_id = $2', [req.params.planId, req.params.clientId]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/clients/:clientId/plans/:planId/export.:format(pdf|docx)', async (req, res) => {
  const { clientId, planId, format } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT p.title, p.plan, c.name AS client_name FROM social_post_plans p
       JOIN clients c ON c.id = p.client_id
       WHERE p.id = $1 AND p.client_id = $2`,
      [planId, clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
    const row = rows[0];
    const markdown = socialPlanner.planToMarkdown(row.plan);
    const safeSlug = (row.client_name + '-' + (row.title || 'plan')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    const filename = `${safeSlug}.${format}`;
    const opts = { title: row.title || 'Social Post Plan', clientName: row.client_name, generatedAt: new Date() };
    const buf = format === 'pdf'
      ? await chatExport.markdownToPdfBuffer(markdown, opts)
      : await chatExport.markdownToDocxBuffer(markdown, opts);
    res.setHeader('Content-Type', format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    console.error('[social plan export] failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
