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
const cleanThumb = (t) => {
  if (typeof t !== 'string' || !t.startsWith('data:image/')) return null;
  return t.length > MAX_THUMB_CHARS ? null : t;
};

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
              (SELECT dp.thumbnail FROM design_pages dp
                WHERE dp.project_id = p.id ORDER BY dp.sort_order LIMIT 1) AS cover
         FROM design_projects p
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
      'SELECT * FROM design_pages WHERE project_id = $1 ORDER BY sort_order, created_at',
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
      'INSERT INTO design_pages (project_id, sort_order) VALUES ($1, $2) RETURNING *',
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
    const { rows: src } = await pool.query('SELECT * FROM design_pages WHERE id = $1', [req.params.id]);
    if (!src.length) return res.status(404).json({ error: 'Page not found' });
    await loadProject(req, src[0].project_id);

    await client.query('BEGIN');
    await client.query(
      'UPDATE design_pages SET sort_order = sort_order + 1 WHERE project_id = $1 AND sort_order > $2',
      [src[0].project_id, src[0].sort_order]
    );
    const { rows } = await client.query(
      `INSERT INTO design_pages (project_id, sort_order, scene, thumbnail)
       VALUES ($1, $2, $3, $4) RETURNING *`,
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
      'UPDATE design_pages SET scene = $1, thumbnail = COALESCE($2, thumbnail) WHERE id = $3 RETURNING *',
      [scene, thumb, req.params.id]
    );
    // Touch the project so the list sorts by genuine last activity.
    await pool.query('UPDATE design_projects SET updated_at = NOW() WHERE id = $1', [src[0].project_id]);
    // Keeping the old thumbnail is right — a save must never fail over a
    // preview — but doing it silently let a stale card sit there for days.
    res.json({ ...rows[0], thumbnail_rejected: !!req.body?.thumbnail && !thumb });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
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
