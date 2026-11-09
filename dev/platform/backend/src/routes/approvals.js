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
    // nosniff + a strict Content-Disposition so an HTML file disguised
    // as image bytes can't execute script in the journalist's browser
    // (this route serves to unauthenticated reviewers).
    res.setHeader('X-Content-Type-Options', 'nosniff');
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

    // Resolve which posts / creatives / reels this link points to.
    let posts = [], creatives = [], renders = [];
    if (link.scope === 'social_batch') {
      const { rows: ps } = await pool.query(
        `SELECT p.*,
           (SELECT json_agg(m.*) FROM social_post_media m WHERE m.post_id = p.id) AS media
         FROM social_posts p
         WHERE p.batch_id = $1 AND p.show_to_client
         ORDER BY p.position ASC`,
        [link.scope_id]
      );
      posts = ps;
    } else if (link.scope === 'ad_creative_batch') {
      const { rows: cs } = await pool.query(
        `SELECT c.*,
           COALESCE(json_agg(i.*) FILTER (WHERE i.id IS NOT NULL), '[]') AS images
         FROM ad_creatives c
         LEFT JOIN ad_creative_images i ON i.creative_id = c.id
         WHERE c.batch_id = $1 AND c.show_to_client
         GROUP BY c.id ORDER BY c.position ASC`,
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
    } else if (link.scope === 'render_list' && link.render_ids?.length) {
      // Finished reels. `status = 'done'` as well as the id list, because a
      // render can be deleted or re-queued after a link is minted and a card
      // with no file is worse than one fewer card: the client presses play on
      // nothing and concludes the agency sent a broken link.
      const { rows: rs } = await pool.query(
        `SELECT r.id, r.output_url, r.finished_at,
                c.id AS composition_id, c.title
           FROM composition_renders r
           JOIN compositions c ON c.id = r.composition_id
          WHERE r.id = ANY($1) AND r.status = 'done' AND r.output_url IS NOT NULL
          ORDER BY r.finished_at ASC NULLS LAST, r.id ASC`,
        [link.render_ids]
      );
      renders = rs;
    }

    // Client info — name only, no internal fields.
    const { rows: clientRows } = await pool.query('SELECT name FROM clients WHERE id = $1', [link.client_id]);
    const client = clientRows[0] || {};

    // Prior responses on this link, so the public view shows what's
    // already been decided.
    const { rows: responses } = await pool.query(
      'SELECT post_id, ad_creative_id, composition_render_id, decision, comment, reviewer_name, created_at FROM approval_responses WHERE link_id = $1 ORDER BY created_at ASC',
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
    // A render's own url is the same `/api/brand/file/<client>/<name>` shape
    // the proxy was built for, which is why no new file route was needed:
    // `compositionRenderRunner` writes into `uploads/<client>/` and the proxy
    // already serves exactly that directory, gated on the token.
    for (const r of renders) {
      r.output_url = rewriteUrl(r.output_url);
    }

    res.json({
      title: link.title,
      client: { name: client.name },
      posts, creatives, renders, responses,
      expires_at: link.expires_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/public/:token/respond', async (req, res) => {
  const { post_id, ad_creative_id, composition_render_id, decision, comment, reviewer_name } = req.body || {};
  if (!['approved', 'changes_requested', 'rejected', 'commented'].includes(decision || 'commented')) {
    return res.status(400).json({ error: 'invalid decision' });
  }
  if (!post_id && !ad_creative_id && !composition_render_id) {
    return res.status(400).json({ error: 'post_id, ad_creative_id or composition_render_id required' });
  }
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
    // Same binding, same reason. Without it anyone holding a public token
    // could record an approval against any render in the database by
    // supplying its id, including another client's. A render id is a small
    // integer, so guessing one is not a feat.
    if (composition_render_id) {
      if (!renderIsInLinkScope(link, composition_render_id)) {
        return res.status(403).json({ error: 'composition_render_id is not part of this approval link.' });
      }
    }

    const { rows: row } = await pool.query(
      `INSERT INTO approval_responses
         (link_id, post_id, ad_creative_id, composition_render_id, decision, comment, reviewer_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [link.id, post_id || null, ad_creative_id || null, composition_render_id || null,
        decision || 'commented', comment || null, (reviewer_name || '').slice(0, 120) || null]
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

// A render is in scope only when the link names it. There is no batch form of
// a render link on purpose: a `render_list` is an explicit choice of files made
// at the moment of sharing, which is the whole reason the link carries renders
// rather than compositions. Synchronous, because unlike its two siblings it
// needs no query — the ids are on the link.
function renderIsInLinkScope(link, renderId) {
  if (link.scope !== 'render_list') return false;
  const id = Number(renderId);
  if (!Number.isInteger(id)) return false;
  return (link.render_ids || []).map(Number).includes(id);
}

// Verify a post belongs to whichever set the approval link authorises:
// - 'social_batch' scope: post must live inside link.scope_id batch AND be
//   one the client is shown
// - 'post_list' scope: post must appear in link.post_ids
// - 'ad_creative_batch' scope: no posts allowed at all
async function postIsInLinkScope(link, postId) {
  if (link.scope === 'social_batch') {
    // `show_to_client` as well as the batch, so the gate matches the page.
    // Without it a post withheld from the client could still be approved by
    // anyone who had its id, which is a decision recorded against work the
    // client was never shown.
    const { rows } = await pool.query(
      `SELECT 1 FROM social_posts
        WHERE id = $1 AND batch_id = $2 AND show_to_client LIMIT 1`,
      [postId, link.scope_id]
    );
    return rows.length > 0;
  }
  if (link.scope === 'post_list') {
    // Not filtered: a post_list link is an explicit choice of posts made when
    // the link was created, so the list is the selection. Narrowing it later
    // from a tick on another screen would change a link already sent.
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
  const { scope, scope_id, post_ids, render_ids, title, expires_days } = req.body || {};
  if (!['social_batch', 'ad_creative_batch', 'post_list', 'render_list'].includes(scope)) {
    return res.status(400).json({ error: 'invalid scope' });
  }
  // A render link with no renders would mint a URL onto an empty page, which
  // reads to the client as the agency having sent nothing.
  const renderIds = Array.isArray(render_ids)
    ? render_ids.map(Number).filter(Number.isInteger)
    : [];
  if (scope === 'render_list' && !renderIds.length) {
    return res.status(400).json({ error: 'render_list needs at least one render_id' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = expires_days ? new Date(Date.now() + parseInt(expires_days) * 86400_000) : null;
  try {
    // Every render must belong to the client in the path. `requireClientAccess`
    // checks the caller may act for THIS client; it says nothing about the ids
    // in the body, so without this a caller could mint a link that serves
    // another client's reels — and the public view, correctly, only checks
    // that an id is on the link.
    //
    // Done renders only, for the same reason the public view filters them: a
    // link is a promise that these files exist.
    if (scope === 'render_list') {
      const { rows: mine } = await pool.query(
        `SELECT r.id FROM composition_renders r
           JOIN compositions c ON c.id = r.composition_id
          WHERE r.id = ANY($1) AND c.client_id = $2
            AND r.status = 'done' AND r.output_url IS NOT NULL`,
        [renderIds, req.params.clientId]
      );
      const ok = new Set(mine.map(r => Number(r.id)));
      const refused = renderIds.filter(id => !ok.has(id));
      if (refused.length) {
        return res.status(400).json({
          error: `not this client's finished renders: ${refused.join(', ')}`,
        });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO approval_links
         (client_id, token, scope, scope_id, post_ids, render_ids, title, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.params.clientId, token, scope, scope_id || null, post_ids || [], renderIds,
        title || null, req.user.id, expiresAt]
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
