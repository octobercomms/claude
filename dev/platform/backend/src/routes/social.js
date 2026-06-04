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

// Public, signed media proxy for the social autopilot. Meta's publish
// endpoints (image_url / video_url) need a URL they can fetch from the
// open web, but Drive files aren't public. This route streams the file
// from Drive after verifying an HMAC signature scoped to (planId, fileId,
// expiry). Lives above the auth middleware so Meta can hit it without a
// Bearer token.
router.get('/media-proxy/:planId/:fileId', async (req, res) => {
  const socialPublisher = require('../services/socialPublisher');
  try {
    const { planId, fileId } = req.params;
    const { exp, sig } = req.query;
    if (!socialPublisher.verifyMediaToken(planId, fileId, exp, sig)) {
      return res.status(403).send('Invalid or expired media token');
    }
    const { rows } = await pool.query(
      `SELECT client_id, drive_folder_url FROM social_post_plans WHERE id = $1`,
      [planId]
    );
    if (!rows.length) return res.status(404).send('Plan not found');
    const socialDrive = require('../services/socialDrive');
    const upstream = await socialDrive.downloadFile(rows[0].client_id, fileId);
    if (upstream.headers['content-type']) res.setHeader('Content-Type', upstream.headers['content-type']);
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    upstream.data.pipe(res);
  } catch (err) {
    console.error('[social media-proxy] failed:', err.message);
    res.status(500).send('Media proxy error');
  }
});

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
    // brief = '__autopilot__' hides the sentinel batch that hosts
    // autopilot-published posts — it isn't a brainstorm batch and would
    // confuse the history view.
    const { rows } = await pool.query(
      `SELECT b.*,
              (SELECT COUNT(*)::int FROM social_posts p WHERE p.batch_id = b.id) AS post_count
       FROM social_batches b
       WHERE b.client_id = $1 AND (b.brief IS NULL OR b.brief <> '__autopilot__')
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
    // Enriched: for each plan, surface the per-platform publication
    // statuses + the latest engagement snapshot (per linked social_posts
    // row) so the AM sees what ran and how it did without opening every
    // plan. publications_summary is small (3 rows max per plan), and
    // engagement_summary aggregates likes/comments/reach across all the
    // platforms a single plan was published to.
    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.status, p.scheduled_at, p.target_platforms,
              p.updated_at, p.created_at,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'platform', pub.platform,
                  'status', pub.status,
                  'posted_url', pub.posted_url,
                  'posted_at', pub.posted_at,
                  'error_message', pub.error_message
                ) ORDER BY pub.platform)
                FROM social_post_publications pub
                WHERE pub.plan_id = p.id
              ), '[]'::json) AS publications,
              COALESCE((
                SELECT json_build_object(
                  'reach',     SUM(COALESCE(e.reach, e.impressions, e.views, 0)),
                  'likes',     SUM(COALESCE(e.likes, 0)),
                  'comments',  SUM(COALESCE(e.comments, 0)),
                  'shares',    SUM(COALESCE(e.shares, 0)),
                  'saves',     SUM(COALESCE(e.saves, 0)),
                  'fetched_at', MAX(e.fetched_at),
                  'post_count', COUNT(DISTINCT sp.id)
                )
                FROM social_posts sp
                LEFT JOIN LATERAL (
                  SELECT * FROM social_post_engagement
                   WHERE post_id = sp.id ORDER BY fetched_at DESC LIMIT 1
                ) e ON true
                WHERE sp.plan_id = p.id
              ), '{}'::json) AS engagement
         FROM social_post_plans p
        WHERE p.client_id = $1
        ORDER BY p.updated_at DESC`,
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

// Bulk-schedule N brainstorm posts at once. The AM picks posts from a
// batch, a cadence (which days of the week, what time), and target
// platforms / Drive folder shared across all of them. We materialise
// one social_post_plans row per post and stagger scheduled_at across
// the cadence days starting from start_at.
router.post('/clients/:clientId/bulk-schedule', async (req, res) => {
  const {
    post_ids, target_platforms, drive_folder_url,
    start_at, days_of_week, time_of_day,
  } = req.body || {};
  if (!Array.isArray(post_ids) || !post_ids.length) {
    return res.status(400).json({ error: 'post_ids required' });
  }
  const ALLOWED = new Set(['instagram', 'facebook', 'linkedin']);
  const platforms = (target_platforms || []).filter(p => ALLOWED.has(p));
  if (!platforms.length) return res.status(400).json({ error: 'target_platforms must include at least one of instagram / facebook / linkedin' });
  if (!Array.isArray(days_of_week) || !days_of_week.length) {
    return res.status(400).json({ error: 'days_of_week (0=Sun..6=Sat) is required' });
  }
  const validDays = days_of_week.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
  if (!validDays.length) return res.status(400).json({ error: 'days_of_week must be 0-6 integers' });
  const [hhStr, mmStr] = String(time_of_day || '10:00').split(':');
  const hh = Math.max(0, Math.min(23, parseInt(hhStr, 10) || 10));
  const mm = Math.max(0, Math.min(59, parseInt(mmStr, 10) || 0));
  const startDate = start_at ? new Date(start_at) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (isNaN(startDate)) return res.status(400).json({ error: 'start_at must be a valid date' });

  try {
    // Pull the brainstorm posts. Reject any that don't belong to this client.
    const { rows: posts } = await pool.query(
      `SELECT id, kind, platform, hook, caption, hashtags, visual_concept, storyboard, framework
         FROM social_posts WHERE client_id = $1 AND id = ANY($2::uuid[])
         ORDER BY position ASC, created_at ASC`,
      [req.params.clientId, post_ids]
    );
    if (posts.length !== post_ids.length) {
      return res.status(400).json({ error: 'One or more post_ids do not belong to this client.' });
    }

    // Generate one slot per post, walking forward day-by-day and picking
    // the time on each day_of_week match. Time interpreted in server tz.
    const slots = [];
    const cursor = new Date(startDate);
    cursor.setHours(hh, mm, 0, 0);
    let safety = 0;
    while (slots.length < posts.length && safety < 365) {
      if (validDays.includes(cursor.getDay())) {
        slots.push(new Date(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(hh, mm, 0, 0);
      safety++;
    }
    if (slots.length < posts.length) {
      return res.status(400).json({ error: 'Could not generate enough schedule slots — pick more days or a longer horizon.' });
    }

    // Materialise one plan per post inside a transaction so a partial
    // failure doesn't leave half a schedule on the books.
    const dbClient = await pool.connect();
    const created = [];
    try {
      await dbClient.query('BEGIN');
      for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        const planJson = brainstormToPlan(post);
        const title = (post.hook || post.caption || '(scheduled post)').slice(0, 80);
        const { rows } = await dbClient.query(
          `INSERT INTO social_post_plans
             (client_id, title, plan, status, scheduled_at, drive_folder_url, target_platforms)
           VALUES ($1, $2, $3, 'locked', $4, $5, $6)
           RETURNING id, title, scheduled_at, target_platforms`,
          [req.params.clientId, title, JSON.stringify(planJson), slots[i].toISOString(),
           drive_folder_url || null, platforms]
        );
        created.push(rows[0]);
        // Mark the brainstorm post itself as scheduled so the grid
        // shows the AM which ones have been queued.
        await dbClient.query(
          `UPDATE social_posts SET status = 'scheduled', updated_at = NOW() WHERE id = $1`,
          [post.id]
        );
      }
      await dbClient.query('COMMIT');
    } catch (err) {
      await dbClient.query('ROLLBACK');
      throw err;
    } finally {
      dbClient.release();
    }
    res.json({ plans: created });
  } catch (err) {
    console.error('[social bulk-schedule] failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Map a brainstorm social_posts row into the plan JSON shape that the
// autopilot publisher + caption preview already understand.
function brainstormToPlan(post) {
  const scenes = Array.isArray(post.storyboard)
    ? post.storyboard.map((s, i) => ({
        number: s.frame || i + 1,
        name: s.style ? `Style ${s.style}` : `Scene ${i + 1}`,
        style_code: s.style || undefined,
        shot: s.shot || '',
        bullets: [s.on_screen_text, s.voiceover].filter(Boolean),
        duration_seconds: s.duration_sec || undefined,
      }))
    : [];
  return {
    version: 1,
    title: (post.hook || post.caption || '').slice(0, 120),
    platforms: [post.platform],
    framework: post.framework || undefined,
    hook: { text: post.hook || '' },
    caption: post.caption || '',
    hashtags: post.hashtags || [],
    visual_concept: post.visual_concept || undefined,
    scenes,
  };
}

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

// Resolve the actual accounts the publisher will post to, so the AM
// can confirm which IG handle / FB Page / LinkedIn member will own each
// post before they hit Publish. Best-effort — surfaces a friendly note
// per platform rather than a hard error, since the AM may not have all
// three connectors set up.
router.get('/clients/:clientId/plans/:planId/publish-targets', async (req, res) => {
  const out = { instagram: null, facebook: null, linkedin: null };
  // Meta
  try {
    const { rows } = await pool.query(
      `SELECT c.credentials, ig.config AS ig_config
         FROM connectors c
         LEFT JOIN connectors ig
           ON ig.client_id = c.client_id AND ig.connector_type = 'instagram_insights'
         WHERE c.client_id = $1
           AND c.connector_type IN ('meta_ads', 'instagram_insights')
           AND c.credentials IS NOT NULL AND c.credentials != '{}'
         ORDER BY c.connector_type LIMIT 1`,
      [req.params.clientId]
    );
    if (rows.length) {
      const { decrypt } = require('../utils/encryption');
      const metaConn = require('../connectors/meta');
      const creds = decrypt(rows[0].credentials);
      const preferredIg = rows[0].ig_config?.value || null;
      const targets = await metaConn.pickPublishingTargets(creds, preferredIg);
      out.instagram = targets.igBusinessId
        ? { ok: true, label: targets.pageName + ' / IG ' + targets.igBusinessId }
        : { ok: false, label: 'No IG Business account attached to the chosen Page.' };
      out.facebook = { ok: true, label: targets.pageName + ` (Page ${targets.pageId})` };
    } else {
      out.instagram = { ok: false, label: 'No Meta connector.' };
      out.facebook = { ok: false, label: 'No Meta connector.' };
    }
  } catch (err) {
    out.instagram = { ok: false, label: err.message };
    out.facebook = { ok: false, label: err.message };
  }
  // LinkedIn
  try {
    const { rows } = await pool.query(
      `SELECT credentials FROM connectors
         WHERE client_id = $1 AND connector_type = 'linkedin_organic'
           AND credentials IS NOT NULL AND credentials != '{}' LIMIT 1`,
      [req.params.clientId]
    );
    if (rows.length) {
      const { decrypt } = require('../utils/encryption');
      const liCreds = decrypt(rows[0].credentials);
      out.linkedin = { ok: true, label: liCreds.member_name || 'LinkedIn member' };
    } else {
      out.linkedin = { ok: false, label: 'No LinkedIn connector.' };
    }
  } catch (err) {
    out.linkedin = { ok: false, label: err.message };
  }
  res.json(out);
});

// Phase 2 — preview what's in the Drive folder so the AM can confirm
// the right files are there before the scheduled publish time. Phase 9
// adds aspect-ratio guidance per file given the plan's target platforms,
// so the AM catches a 16:9 video before it ships as an IG Reel.
router.get('/clients/:clientId/plans/:planId/drive-files', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT drive_folder_url, target_platforms FROM social_post_plans WHERE id = $1 AND client_id = $2`,
      [req.params.planId, req.params.clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
    if (!rows[0].drive_folder_url) return res.json({ files: [], note: 'No Drive folder set on this plan.' });
    const socialDrive = require('../services/socialDrive');
    const files = await socialDrive.listFolder(req.params.clientId, rows[0].drive_folder_url);
    const targetPlatforms = rows[0].target_platforms || [];
    const enriched = files.map(f => ({ ...f, warnings: aspectWarningsFor(f, targetPlatforms) }));
    res.json({ files: enriched });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Per-platform aspect-ratio recommendations. Returns a list of human
// warnings (empty when the file fits). We're permissive — anything
// within 5% of an accepted ratio counts as a match, so a 1080x1080
// photo doesn't get nagged about being 1.001 instead of 1.000.
function aspectWarningsFor(file, targetPlatforms) {
  const warnings = [];
  if (!file.aspect_ratio || !targetPlatforms?.length) return warnings;
  const isVideo = (file.mimeType || '').startsWith('video/');
  const a = file.aspect_ratio;
  const near = (target) => Math.abs(a - target) / target < 0.05;
  const ranges = {
    'IG Reel (9:16)': 9 / 16,
    'IG square (1:1)': 1,
    'IG portrait (4:5)': 4 / 5,
    'IG landscape (1.91:1)': 1.91,
    'FB landscape (16:9)': 16 / 9,
    'LinkedIn landscape (1.91:1)': 1.91,
    'LinkedIn square (1:1)': 1,
  };
  if (targetPlatforms.includes('instagram')) {
    if (isVideo && !near(9 / 16) && !near(1) && !near(4 / 5)) {
      warnings.push(`Instagram Reels prefers 9:16 (this is ${a}).`);
    }
    if (!isVideo && !near(1) && !near(4 / 5) && !near(1.91)) {
      warnings.push(`Instagram feed prefers 1:1, 4:5, or 1.91:1 (this is ${a}).`);
    }
  }
  if (targetPlatforms.includes('facebook')) {
    if (isVideo && !near(16 / 9) && !near(1) && !near(9 / 16)) {
      warnings.push(`Facebook video prefers 16:9, 1:1, or 9:16 (this is ${a}).`);
    }
    if (!isVideo && !near(1.91) && !near(1)) {
      warnings.push(`Facebook image prefers 1.91:1 or 1:1 (this is ${a}).`);
    }
  }
  if (targetPlatforms.includes('linkedin')) {
    if (isVideo && !near(16 / 9) && !near(1) && !near(9 / 16)) {
      warnings.push(`LinkedIn video prefers 16:9, 1:1, or 9:16 (this is ${a}).`);
    }
    if (!isVideo && !near(1.91) && !near(1)) {
      warnings.push(`LinkedIn image prefers 1.91:1 or 1:1 (this is ${a}).`);
    }
  }
  return warnings;
}

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

// Phase 3 — manually trigger publish for a plan. Same code path as the
// cron; useful when the AM wants to push immediately without waiting for
// the next 5-minute cron tick. The endpoint returns once every platform
// has been attempted (sync), so the UI can show results straight away.
router.post('/clients/:clientId/plans/:planId/publish-now', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, client_id, title, plan, scheduled_at, drive_folder_url, target_platforms
         FROM social_post_plans
        WHERE id = $1 AND client_id = $2`,
      [req.params.planId, req.params.clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
    const plan = rows[0];
    if (!plan.target_platforms?.length) return res.status(400).json({ error: 'No target platforms set on this plan.' });
    // Treat the manual trigger as "schedule = now" so the publisher row's
    // scheduled_at is sensible. We don't overwrite the stored scheduled_at.
    if (!plan.scheduled_at) plan.scheduled_at = new Date().toISOString();
    const socialPublisher = require('../services/socialPublisher');
    await socialPublisher.publishPlan(plan);
    const { rows: pubs } = await pool.query(
      `SELECT platform, status, caption, posted_at, posted_url, error_message, attempts
         FROM social_post_publications WHERE plan_id = $1 ORDER BY platform`,
      [plan.id]
    );
    res.json({ publications: pubs });
  } catch (err) {
    console.error('[social publish-now] failed:', err);
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
