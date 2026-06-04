// Approval workflow — shareable preview links that clients open without
// logging in. The AM bundles a Social batch or a list of posts/ad
// creatives, hits "Share for approval", gets a URL. The client opens it,
// approves or requests changes per post, leaves comments.
//
// Two route groups in this file:
//   1. /api/approvals/*  — authenticated, AM-side: create / list / revoke.
//   2. /api/approvals/public/:token — unauthenticated client view + POST
//      back of decisions.
//
// The token is opaque random hex stored in approval_links.token; no JWT
// shenanigans. Each link can carry an expiry; expired tokens 410.

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const users = require('../services/users');

const router = express.Router();
const UPLOAD_ROOT = path.join(__dirname, '../../uploads');

// Public proxy for local files (voiceovers, uploaded brand audio) so the
// approval page can play them without requiring login. Token gates which
// client's uploads are reachable.
router.get('/public/:token/file/:filename', async (req, res) => {
  if (req.params.filename.includes('..') || req.params.filename.includes('/')) {
    return res.status(400).send('Invalid filename');
  }
  try {
    const { rows } = await pool.query('SELECT client_id, expires_at FROM approval_links WHERE token = $1', [req.params.token]);
    if (!rows.length) return res.status(404).send('Not found');
    if (rows[0].expires_at && new Date(rows[0].expires_at) < new Date()) return res.status(410).send('Expired');
    const filePath = path.join(UPLOAD_ROOT, rows[0].client_id, req.params.filename);
    if (!filePath.startsWith(UPLOAD_ROOT + path.sep)) return res.status(400).send('Invalid path');
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
    res.sendFile(filePath);
  } catch (err) { res.status(500).send(err.message); }
});

// ─── PUBLIC SIDE (no auth) ────────────────────────────────────────────────
//
// Mounted first so /api/approvals/public/* doesn't go through the
// router.use(authenticate) block below.
router.get('/public/:token', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM approval_links WHERE token = $1', [req.params.token]);
    if (!rows.length) return res.status(404).json({ error: 'Approval link not found' });
    const link = rows[0];
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Approval link has expired' });
    }

    // Resolve which posts / creatives this link points to.
    let posts = [], creatives = [];
    if (link.scope === 'social_batch') {
      const { rows: ps } = await pool.query(
        `SELECT p.*,
           (SELECT json_agg(m.*) FROM social_post_media m WHERE m.post_id = p.id) AS media
         FROM social_posts p WHERE p.batch_id = $1 ORDER BY p.position ASC`,
        [link.scope_id]
      );
      posts = ps;
    } else if (link.scope === 'ad_creative_batch') {
      const { rows: cs } = await pool.query(
        `SELECT c.*,
           COALESCE(json_agg(i.*) FILTER (WHERE i.id IS NOT NULL), '[]') AS images
         FROM ad_creatives c
         LEFT JOIN ad_creative_images i ON i.creative_id = c.id
         WHERE c.batch_id = $1 GROUP BY c.id ORDER BY c.position ASC`,
        [link.scope_id]
      );
      creatives = cs;
    } else if (link.scope === 'post_list' && link.post_ids?.length) {
      const { rows: ps } = await pool.query(
        `SELECT p.*,
           (SELECT json_agg(m.*) FROM social_post_media m WHERE m.post_id = p.id) AS media
         FROM social_posts p WHERE p.id = ANY($1) ORDER BY p.position ASC`,
        [link.post_ids]
      );
      posts = ps;
    }

    // Client info — name only, no internal fields.
    const { rows: clientRows } = await pool.query('SELECT name FROM clients WHERE id = $1', [link.client_id]);
    const client = clientRows[0] || {};

    // Prior responses on this link, so the public view shows what's
    // already been decided.
    const { rows: responses } = await pool.query(
      'SELECT post_id, ad_creative_id, decision, comment, reviewer_name, created_at FROM approval_responses WHERE link_id = $1 ORDER BY created_at ASC',
      [link.id]
    );

    // Rewrite any local /api/brand/file/<clientId>/<filename> URLs into
    // /api/approvals/public/<token>/file/<filename> so reviewers can
    // play voiceovers / view brand uploads without logging in.
    const rewriteUrl = (u) => {
      if (!u || typeof u !== 'string') return u;
      const m = u.match(/^\/api\/brand\/file\/[^/]+\/(.+)$/);
      return m ? `/api/approvals/public/${req.params.token}/file/${m[1]}` : u;
    };
    for (const p of posts) {
      p.image_urls = (p.image_urls || []).map(rewriteUrl);
      p.media = (p.media || []).map(m => ({ ...m, url: rewriteUrl(m.url) }));
    }
    for (const c of creatives) {
      c.images = (c.images || []).map(i => ({ ...i, url: rewriteUrl(i.url) }));
    }

    res.json({
      title: link.title,
      client: { name: client.name },
      posts, creatives, responses,
      expires_at: link.expires_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/public/:token/respond', async (req, res) => {
  const { post_id, ad_creative_id, decision, comment, reviewer_name } = req.body || {};
  if (!['approved', 'changes_requested', 'rejected', 'commented'].includes(decision || 'commented')) {
    return res.status(400).json({ error: 'invalid decision' });
  }
  if (!post_id && !ad_creative_id) return res.status(400).json({ error: 'post_id or ad_creative_id required' });
  try {
    const { rows } = await pool.query('SELECT * FROM approval_links WHERE token = $1', [req.params.token]);
    if (!rows.length) return res.status(404).json({ error: 'Approval link not found' });
    const link = rows[0];
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Approval link has expired' });
    }

    // Bind the post / ad creative to the link's declared scope. Without
    // this, anyone who knows the public token can mark ANY post or ad
    // creative as approved by supplying its UUID in the body — including
    // posts from other clients' batches that this token was never meant
    // to authorise.
    if (post_id) {
      const inScope = await postIsInLinkScope(link, post_id);
      if (!inScope) return res.status(403).json({ error: 'post_id is not part of this approval link.' });
    }
    if (ad_creative_id) {
      const inScope = await adCreativeIsInLinkScope(link, ad_creative_id);
      if (!inScope) return res.status(403).json({ error: 'ad_creative_id is not part of this approval link.' });
    }

    const { rows: row } = await pool.query(
      `INSERT INTO approval_responses (link_id, post_id, ad_creative_id, decision, comment, reviewer_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [link.id, post_id || null, ad_creative_id || null, decision || 'commented', comment || null, (reviewer_name || '').slice(0, 120) || null]
    );
    // Reflect approvals onto the underlying row so the AM sees the
    // status update on the Social / Paid card without polling responses.
    // The scope binding above guarantees post_id / ad_creative_id belong
    // to a batch the link's client owns, so the UPDATE can't reach into
    // another tenant's data.
    if (decision === 'approved' && post_id) {
      await pool.query("UPDATE social_posts SET status = 'approved' WHERE id = $1 AND status = 'draft'", [post_id]);
    } else if (decision === 'approved' && ad_creative_id) {
      await pool.query("UPDATE ad_creatives SET status = 'approved' WHERE id = $1 AND status = 'draft'", [ad_creative_id]);
    }
    res.status(201).json({ response: row[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify a post belongs to whichever set the approval link authorises:
// - 'social_batch' scope: post must live inside link.scope_id batch
// - 'post_list' scope: post must appear in link.post_ids
// - 'ad_creative_batch' scope: no posts allowed at all
async function postIsInLinkScope(link, postId) {
  if (link.scope === 'social_batch') {
    const { rows } = await pool.query(
      `SELECT 1 FROM social_posts WHERE id = $1 AND batch_id = $2 LIMIT 1`,
      [postId, link.scope_id]
    );
    return rows.length > 0;
  }
  if (link.scope === 'post_list') {
    const ids = Array.isArray(link.post_ids) ? link.post_ids : [];
    return ids.includes(postId);
  }
  return false;
}

async function adCreativeIsInLinkScope(link, adCreativeId) {
  if (link.scope === 'ad_creative_batch') {
    const { rows } = await pool.query(
      `SELECT 1 FROM ad_creatives WHERE id = $1 AND batch_id = $2 LIMIT 1`,
      [adCreativeId, link.scope_id]
    );
    return rows.length > 0;
  }
  return false;
}

// ─── AM SIDE (auth required) ──────────────────────────────────────────────
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

router.get('/clients/:clientId/links', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.*,
              (SELECT COUNT(*)::int FROM approval_responses r WHERE r.link_id = l.id) AS response_count
       FROM approval_links l WHERE l.client_id = $1
       ORDER BY l.created_at DESC LIMIT 50`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clients/:clientId/links', async (req, res) => {
  const { scope, scope_id, post_ids, title, expires_days } = req.body || {};
  if (!['social_batch', 'ad_creative_batch', 'post_list'].includes(scope)) {
    return res.status(400).json({ error: 'invalid scope' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = expires_days ? new Date(Date.now() + parseInt(expires_days) * 86400_000) : null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO approval_links (client_id, token, scope, scope_id, post_ids, title, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.params.clientId, token, scope, scope_id || null, post_ids || [], title || null, req.user.id, expiresAt]
    );
    const baseUrl = (process.env.PLATFORM_URL || '').replace(/\/$/, '') || '';
    res.status(201).json({ link: rows[0], public_url: `${baseUrl}/approve/${token}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/links/:id/responses', authenticate, loadVisibleClientIds, async (req, res) => {
  try {
    const { rows: linkRows } = await pool.query('SELECT * FROM approval_links WHERE id = $1', [req.params.id]);
    if (!linkRows.length) return res.status(404).json({ error: 'Link not found' });
    if (!users.canAccessClient(req.visibleClientIds, linkRows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised' });
    }
    const { rows } = await pool.query(
      'SELECT * FROM approval_responses WHERE link_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/links/:id', authenticate, loadVisibleClientIds, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT client_id FROM approval_links WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(204).end();
    if (!users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised' });
    }
    await pool.query('DELETE FROM approval_links WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
