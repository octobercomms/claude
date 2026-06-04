// Per-client brand asset library — logos, product photos, colour palette,
// fonts, free-form guideline notes. Used as reference input by the Social
// and Ad Creative generators so output looks on-brand rather than generic.
//
// Uploads land on local disk under <BACKEND_ROOT>/uploads/<client_id>/.
// They're served back through this same router behind the existing auth
// middleware so credentials apply.

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const users = require('../services/users');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const router = express.Router();

// Public-style file fetch — requires auth + visibility, but no client_id
// in the URL (it's encoded in the path). We resolve the owning client
// from the file path's first segment.
router.get('/file/:clientId/:filename', authenticate, loadVisibleClientIds, async (req, res) => {
  if (!users.canAccessClient(req.visibleClientIds, req.params.clientId)) {
    return res.status(403).send('Not authorised');
  }
  // Block path traversal — only allow plain filenames.
  if (req.params.filename.includes('..') || req.params.filename.includes('/')) {
    return res.status(400).send('Invalid filename');
  }
  const filePath = path.join(UPLOAD_ROOT, req.params.clientId, req.params.filename);
  if (!filePath.startsWith(UPLOAD_ROOT + path.sep)) return res.status(400).send('Invalid path');
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  // nosniff forbids the browser from guessing a different Content-Type
  // than the server sends — without it an uploaded file whose stored
  // mime is "image/png" but whose first bytes look like HTML can still
  // render as HTML and execute script. With nosniff, the browser
  // refuses to render mismatched content.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath);
});

router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// Multer storage — one folder per client, uuid filename to avoid collisions.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, req.params.clientId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
// Mime allowlist. SVG is deliberately omitted — SVG files can carry
// <script> tags that execute when the file is rendered inline through
// the asset-serve route, giving an authenticated AM stored XSS on
// other AMs viewing the brand library. PNG/JPEG/WebP cover everything
// the brand kit actually needs.
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },    // 100MB — B-roll clips are bigger
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/svg+xml') {
      return cb(new Error('SVG uploads are blocked — convert to PNG/JPEG. SVG can carry inline scripts.'));
    }
    const allowed = ['image/png', 'image/jpeg', 'image/webp',
                     'video/mp4', 'video/quicktime', 'video/webm',
                     'font/woff', 'font/woff2', 'font/ttf', 'application/font-woff',
                     'application/octet-stream', 'application/pdf'];
    // The startsWith fallback for image/* and video/* deliberately
    // re-applies the SVG exclusion above; anything matching image/*
    // that isn't image/svg+xml is fine.
    if (allowed.includes(file.mimetype) || (file.mimetype.startsWith('image/') && file.mimetype !== 'image/svg+xml') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

router.get('/clients/:clientId/assets', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM brand_assets WHERE client_id = $1 ORDER BY kind, created_at DESC',
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// File-uploaded assets (logo / product_image / font / guideline doc /
// b_roll_clip / prop_image). Single-file path.
router.post('/clients/:clientId/assets', upload.single('file'), async (req, res) => {
  try {
    const { kind, name } = req.body;
    if (!kind) return res.status(400).json({ error: 'kind required' });
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const url = `/api/brand/file/${req.params.clientId}/${req.file.filename}`;
    const { rows } = await pool.query(
      `INSERT INTO brand_assets (client_id, kind, name, url, metadata)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        req.params.clientId, kind,
        name || req.file.originalname,
        url,
        JSON.stringify({ size: req.file.size, mimetype: req.file.mimetype, originalname: req.file.originalname }),
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk upload — for B-roll banks and prop libraries where the AM uploads
// 30+ files in one go. Same multer pipeline but processes the array.
router.post('/clients/:clientId/assets/bulk', upload.array('files', 50), async (req, res) => {
  try {
    const { kind } = req.body;
    if (!kind) return res.status(400).json({ error: 'kind required' });
    if (!req.files?.length) return res.status(400).json({ error: 'files required' });
    const inserted = [];
    for (const file of req.files) {
      const url = `/api/brand/file/${req.params.clientId}/${file.filename}`;
      const { rows } = await pool.query(
        `INSERT INTO brand_assets (client_id, kind, name, url, metadata)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          req.params.clientId, kind, file.originalname, url,
          JSON.stringify({ size: file.size, mimetype: file.mimetype, originalname: file.originalname }),
        ]
      );
      inserted.push(rows[0]);
    }
    res.status(201).json({ inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Metadata-only assets (palette colours, guideline notes — no file).
router.post('/clients/:clientId/assets/meta', async (req, res) => {
  const { kind, name, metadata } = req.body || {};
  if (!kind || !name) return res.status(400).json({ error: 'kind and name required' });
  if (!['palette', 'guideline'].includes(kind)) {
    return res.status(400).json({ error: 'this endpoint is for palette/guideline only' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO brand_assets (client_id, kind, name, metadata)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.clientId, kind, name, JSON.stringify(metadata || {})]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/assets/:id', authenticate, loadVisibleClientIds, async (req, res) => {
  try {
    const lookup = await pool.query('SELECT client_id FROM brand_assets WHERE id = $1', [req.params.id]);
    if (!lookup.rows.length) return res.status(404).json({ error: 'Asset not found' });
    if (!users.canAccessClient(req.visibleClientIds, lookup.rows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised for this client' });
    }
    const { name, metadata } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE brand_assets SET
         name = COALESCE($1, name),
         metadata = COALESCE($2::jsonb, metadata)
       WHERE id = $3 RETURNING *`,
      [name ?? null, metadata === undefined ? null : JSON.stringify(metadata), req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/assets/:id', authenticate, loadVisibleClientIds, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT client_id, url FROM brand_assets WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(204).end();
    if (!users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised for this client' });
    }
    // Best-effort delete the underlying file too.
    if (rows[0].url?.startsWith('/api/brand/file/')) {
      const m = rows[0].url.match(/^\/api\/brand\/file\/([^/]+)\/(.+)$/);
      if (m) {
        const candidate = path.join(UPLOAD_ROOT, m[1], m[2]);
        if (candidate.startsWith(UPLOAD_ROOT + path.sep)) fs.promises.unlink(candidate).catch(() => {});
      }
    }
    await pool.query('DELETE FROM brand_assets WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
