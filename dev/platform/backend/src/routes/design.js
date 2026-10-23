// Design studio — layered social posts made in OMI.
//
// A project is a set of posts at one size; a page is one post; a scene is the
// Fabric.js canvas JSON for that page. See migration 208 for why the scene is
// stored whole rather than modelled as layer rows.
//
// There is deliberately no template system. The way this work is actually done
// is: build the first post, duplicate it, swap the photo and the headline. So
// duplication is first-class — a page, or a whole project — and there is no
// library to curate and keep in step with anything.
//
// Assets are not stored here. brand_assets already holds a client's logos,
// images and fonts with upload and authenticated serving; a scene references
// them by URL.

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, assertClientAccess } = require('../middleware/clientAccess');

router.use(authenticate);
router.use(loadVisibleClientIds);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Thumbnails are PNG data URLs written by the editor. Cap them: a page strip
// needs a postage stamp, and an uncapped data URL in a JSON column is how a
// row grows to megabytes and the project list stops loading.
const MAX_THUMB_CHARS = 200_000;
// Three raster types only. A thumbnail is written by the editor, but it is
// stored verbatim and later served back with its own Content-Type, and
//'data:image/svg+xml' would make that a stored-XSS hole on the API origin.
const THUMB_RE = /^data:image\/(png|jpeg|webp);base64,/;
const cleanThumb = (t) => {
  if (typeof t !== 'string' || !THUMB_RE.test(t)) return null;
  return t.length > MAX_THUMB_CHARS ? null : t;
};

// A page row without its thumbnail. The blob is 26KB of base64 and no screen
// needs it inline: it is fetched as an image from the route below, so the
// browser caches it and a list of a hundred sets stays a list, not 2.6MB of
// JSON.
const PAGE_COLS = `id, project_id, sort_order, scene, created_at, updated_at,
                   (thumbnail IS NOT NULL) AS has_thumbnail`;

// Every route below works on a project, so resolve it once and check the
// caller may see its client. A project with no client is agency-level and
// visible to any signed-in staff member.
async function loadProject(req, projectId) {
  if (!UUID_RE.test(String(projectId || ''))) { const e = new Error('Project not found'); e.status = 404; throw e; }
  const { rows } = await pool.query('SELECT * FROM design_projects WHERE id = $1', [projectId]);
  if (!rows.length) { const e = new Error('Project not found'); e.status = 404; throw e; }
  if (rows[0].client_id) assertClientAccess(req, rows[0].client_id);
  return rows[0];
}

// ── Projects ─────────────────────────────────────────────────────────────────

router.get('/clients/:clientId/projects', async (req, res) => {
  try {
    assertClientAccess(req, req.params.clientId);
    const { rows } = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM design_pages dp WHERE dp.project_id = p.id)::int AS page_count,
              cover.id AS cover_page_id,
              cover.updated_at AS cover_updated_at
         FROM design_projects p
         LEFT JOIN LATERAL (
           SELECT dp.id, dp.updated_at FROM design_pages dp
            WHERE dp.project_id = p.id AND dp.thumbnail IS NOT NULL
            ORDER BY dp.sort_order LIMIT 1
         ) cover ON TRUE
        WHERE p.client_id = $1
        ORDER BY p.updated_at DESC`,
      [req.params.clientId]
    );
    res.json({ items: rows });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// A new project starts with one blank page, because a project with no pages is
// a dead end in the editor.
router.post('/clients/:clientId/projects', express.json(), async (req, res) => {
  try {
    assertClientAccess(req, req.params.clientId);
    const name = String(req.body?.name || 'Untitled').trim().slice(0, 200) || 'Untitled';
    const width = Math.min(8000, Math.max(50, parseInt(req.body?.width, 10) || 1080));
    const height = Math.min(8000, Math.max(50, parseInt(req.body?.height, 10) || 1350));
    const { rows } = await pool.query(
      `INSERT INTO design_projects (client_id, name, width, height, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.clientId, name, width, height, req.user?.id || null]
    );
    await pool.query('INSERT INTO design_pages (project_id, sort_order) VALUES ($1, 0)', [rows[0].id]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.get('/projects/:id', async (req, res) => {
  try {
    const project = await loadProject(req, req.params.id);
    const { rows } = await pool.query(
      `SELECT ${PAGE_COLS} FROM design_pages WHERE project_id = $1 ORDER BY sort_order, created_at`,
      [project.id]
    );
    res.json({ ...project, pages: rows });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.patch('/projects/:id', express.json(), async (req, res) => {
  try {
    const project = await loadProject(req, req.params.id);
    const name = req.body?.name !== undefined
      ? (String(req.body.name).trim().slice(0, 200) || project.name) : project.name;
    const width = req.body?.width !== undefined
      ? Math.min(8000, Math.max(50, parseInt(req.body.width, 10) || project.width)) : project.width;
    const height = req.body?.height !== undefined
      ? Math.min(8000, Math.max(50, parseInt(req.body.height, 10) || project.height)) : project.height;
    const { rows } = await pool.query(
      'UPDATE design_projects SET name = $1, width = $2, height = $3 WHERE id = $4 RETURNING *',
      [name, width, height, project.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    const project = await loadProject(req, req.params.id);
    await pool.query('DELETE FROM design_projects WHERE id = $1', [project.id]);
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Copy a whole campaign to start next month's from last month's.
router.post('/projects/:id/duplicate', express.json(), async (req, res) => {
  const client = await pool.connect();
  try {
    const project = await loadProject(req, req.params.id);
    const name = String(req.body?.name || `${project.name} copy`).trim().slice(0, 200);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO design_projects (client_id, name, width, height, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [project.client_id, name, project.width, project.height, req.user?.id || null]
    );
    // One statement rather than a read-then-write loop: a project with twenty
    // pages would otherwise be forty round trips, and a partial copy is worse
    // than no copy.
    await client.query(
      `INSERT INTO design_pages (project_id, sort_order, scene, thumbnail)
       SELECT $1, sort_order, scene, thumbnail FROM design_pages WHERE project_id = $2`,
      [rows[0].id, project.id]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(err.status || 500).json({ error: err.message });
  } finally { client.release(); }
});

// ── Pages ────────────────────────────────────────────────────────────────────

const nextOrder = async (projectId) => {
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM design_pages WHERE project_id = $1',
    [projectId]
  );
  return rows[0].n;
};

router.post('/projects/:id/pages', express.json(), async (req, res) => {
  try {
    const project = await loadProject(req, req.params.id);
    const { rows } = await pool.query(
      `INSERT INTO design_pages (project_id, sort_order) VALUES ($1, $2) RETURNING ${PAGE_COLS}`,
      [project.id, await nextOrder(project.id)]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// The one that matters. Build a post, duplicate it, swap the photo and the
// headline — the copy lands directly after its source rather than at the end,
// so the strip stays in the order the work was done.
router.post('/pages/:id/duplicate', async (req, res) => {
  const client = await pool.connect();
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Page not found' });
    // Named columns, not *: the thumbnail is read here only to copy it into
    // the new row, and it must never leak into a response payload.
    const { rows: src } = await pool.query(
      'SELECT project_id, sort_order, scene, thumbnail FROM design_pages WHERE id = $1', [req.params.id]);
    if (!src.length) return res.status(404).json({ error: 'Page not found' });
    await loadProject(req, src[0].project_id);

    await client.query('BEGIN');
    await client.query(
      'UPDATE design_pages SET sort_order = sort_order + 1 WHERE project_id = $1 AND sort_order > $2',
      [src[0].project_id, src[0].sort_order]
    );
    const { rows } = await client.query(
      `INSERT INTO design_pages (project_id, sort_order, scene, thumbnail)
       VALUES ($1, $2, $3, $4) RETURNING ${PAGE_COLS}`,
      [src[0].project_id, src[0].sort_order + 1, src[0].scene, src[0].thumbnail]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(err.status || 500).json({ error: err.message });
  } finally { client.release(); }
});

// Save a scene. Called on an interval and on leaving a page, so it has to be
// cheap and it has to be last-write-wins without complaint.
router.put('/pages/:id', express.json({ limit: '8mb' }), async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Page not found' });
    const { rows: src } = await pool.query('SELECT project_id FROM design_pages WHERE id = $1', [req.params.id]);
    if (!src.length) return res.status(404).json({ error: 'Page not found' });
    await loadProject(req, src[0].project_id);

    const scene = (req.body && typeof req.body.scene === 'object' && req.body.scene) || {};
    const thumb = cleanThumb(req.body?.thumbnail);
    const { rows } = await pool.query(
      `UPDATE design_pages SET scene = $1, thumbnail = COALESCE($2, thumbnail)
        WHERE id = $3 RETURNING ${PAGE_COLS}`,
      [scene, thumb, req.params.id]
    );
    // Touch the project so the list sorts by genuine last activity.
    await pool.query('UPDATE design_projects SET updated_at = NOW() WHERE id = $1', [src[0].project_id]);
    // Keeping the old thumbnail is right — a save must never fail over a
    // preview — but doing it silently let a stale card sit there for days.
    res.json({ ...rows[0], thumbnail_rejected: !!req.body?.thumbnail && !thumb });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Serve a thumbnail as an image rather than embedding it in JSON.
//
// The editor asks for it with ?v=<the page's updated_at>, so a given URL's
// bytes never change and the browser can hold it forever. Private, because it
// is one client's artwork and no shared cache has any business with it.
router.get('/pages/:id/thumbnail', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).end();
    const { rows } = await pool.query(
      'SELECT project_id, thumbnail, updated_at FROM design_pages WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).end();
    await loadProject(req, rows[0].project_id);   // throws 403/404 as usual
    const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(rows[0].thumbnail || '');
    if (!m) return res.status(404).end();

    const etag = `"${new Date(rows[0].updated_at).getTime()}"`;
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.setHeader('Content-Type', m[1]);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.end(Buffer.from(m[2], 'base64'));
  } catch (err) { res.status(err.status || 500).end(); }
});

router.delete('/pages/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Page not found' });
    const { rows: src } = await pool.query('SELECT project_id FROM design_pages WHERE id = $1', [req.params.id]);
    if (!src.length) return res.status(404).json({ error: 'Page not found' });
    await loadProject(req, src[0].project_id);
    const { rows: count } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM design_pages WHERE project_id = $1', [src[0].project_id]);
    if (count[0].n <= 1) return res.status(400).json({ error: 'A project needs at least one page.' });
    await pool.query('DELETE FROM design_pages WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Move a page into another set.
//
// Two refusals, both structural rather than fussy. A page's scene is drawn at
// its set's size, so moving it into a set of different dimensions would put
// the artwork somewhere other than where it was made. And a set must keep at
// least one page, the same rule delete follows, or the editor opens onto
// nothing.
router.put('/pages/:id/project', express.json(), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Page not found' });
    const { rows: src } = await pool.query(
      'SELECT project_id FROM design_pages WHERE id = $1', [req.params.id]);
    if (!src.length) return res.status(404).json({ error: 'Page not found' });

    const from = await loadProject(req, src[0].project_id);
    const to = await loadProject(req, req.body?.project_id);
    if (from.id === to.id) return res.json({ ok: true, project_id: to.id });
    // A scene points at brand assets served under its own client's path, so a
    // page moved to another client's set would render as broken images for
    // anyone who can only see that client.
    if (from.client_id !== to.client_id) {
      return res.status(400).json({ error: 'A page can only move between sets for the same client.' });
    }
    if (from.width !== to.width || from.height !== to.height) {
      return res.status(400).json({
        error: `“${to.name}” is ${to.width}×${to.height} and this page is ${from.width}×${from.height}.`,
      });
    }
    const { rows: count } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM design_pages WHERE project_id = $1', [from.id]);
    if (count[0].n <= 1) {
      return res.status(400).json({ error: 'A set needs at least one page, so its last one cannot be moved out.' });
    }

    await client.query('BEGIN');
    const { rows: next } = await client.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM design_pages WHERE project_id = $1', [to.id]);
    await client.query(
      'UPDATE design_pages SET project_id = $1, sort_order = $2 WHERE id = $3',
      [to.id, next[0].n, req.params.id]);
    // Both sets changed, so both should sort to the top of the list as
    // genuinely-just-worked-on.
    await client.query('UPDATE design_projects SET updated_at = NOW() WHERE id = ANY($1)', [[from.id, to.id]]);
    await client.query('COMMIT');
    res.json({ ok: true, project_id: to.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(err.status || 500).json({ error: err.message });
  } finally { client.release(); }
});

// Reorder by sending the page ids in their new order.
router.put('/projects/:id/page-order', express.json(), async (req, res) => {
  const client = await pool.connect();
  try {
    const project = await loadProject(req, req.params.id);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(i => UUID_RE.test(String(i))) : [];
    if (!ids.length) return res.status(400).json({ error: 'Send the page ids in their new order.' });
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i += 1) {
      await client.query(
        'UPDATE design_pages SET sort_order = $1 WHERE id = $2 AND project_id = $3',
        [i, ids[i], project.id]
      );
    }
    await client.query('COMMIT');
    const { rows } = await pool.query(
      'SELECT id, sort_order FROM design_pages WHERE project_id = $1 ORDER BY sort_order', [project.id]);
    res.json({ ok: true, pages: rows });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(err.status || 500).json({ error: err.message });
  } finally { client.release(); }
});

module.exports = router;
