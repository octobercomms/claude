// Snapshot Studio routes — October's own lead-gen. Admin-only: prospects are
// not clients, and this exposes an unauthenticated-origin fetch, so it stays
// behind the agency login.

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/clientAccess');
const studio = require('../services/snapshotStudio');
const { renderReportHtml } = require('../services/snapshotReport');
const pdfService = require('../services/pdfService');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads', 'leads');
const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

const router = express.Router();
router.use(authenticate, requireAdmin);

// Resolve a lead's featured images for the renderer. Uploaded files are inlined
// as data URIs so both the preview and the server-side PDF render can load them
// with no auth round-trip; site images pass through as their remote URL.
function resolveFeatured(lead) {
  const featured = (lead.images || []).filter(i => i.featured);
  return featured.map(i => {
    if (i.kind === 'site') return i.url;
    try {
      const fp = path.join(UPLOAD_ROOT, lead.id, i.filename || '');
      if (fp.startsWith(path.join(UPLOAD_ROOT, lead.id) + path.sep) && fs.existsSync(fp)) {
        const ext = (path.extname(fp).slice(1) || 'png').toLowerCase();
        return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(fp).toString('base64')}`;
      }
    } catch { /* skip */ }
    return null;
  }).filter(Boolean);
}

function buildHtml(lead, opts = {}) {
  return renderReportHtml(lead.draft || {}, resolveFeatured(lead), {
    contactEmail: 'hello@octobercomms.com',
    bookUrl: process.env.SNAPSHOT_BOOK_URL || '',
    ...opts,
  });
}

router.get('/', async (req, res) => {
  try { res.json(await studio.listLeads()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const lead = await studio.createLead({ url: req.body?.url, source: 'manual' });
    res.status(201).json(lead);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const lead = await studio.getLead(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Not found' });
    res.json(lead);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fetch the site + draft the report (Claude). Slow (~10-20s) — awaited.
router.post('/:id/gather', async (req, res) => {
  try { res.json(await studio.gather(req.params.id)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

router.post('/:id/refine', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'message required' });
  try { res.json(await studio.refine(req.params.id, message)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try { res.json(await studio.updateLead(req.params.id, req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await studio.deleteLead(req.params.id);
    fs.promises.rm(path.join(UPLOAD_ROOT, req.params.id), { recursive: true, force: true }).catch(() => {});
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload an image (e.g. a screen-grab of their Instagram) to feature.
router.post('/:id/images', uploadMem.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const dir = path.join(UPLOAD_ROOT, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(req.file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.png';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.writeFileSync(path.join(dir, filename), req.file.buffer);
    const img = await studio.addImage(req.params.id, {
      url: `/api/leads/${req.params.id}/file/${filename}`,
      kind: 'upload', filename,
    });
    res.status(201).json(img);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/images/:imageId', async (req, res) => {
  try { res.json(await studio.setImageFeatured(req.params.imageId, !!req.body?.featured)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/images/:imageId', async (req, res) => {
  try {
    const gone = await studio.deleteImage(req.params.imageId);
    if (gone?.filename && gone.lead_id) {
      const fp = path.join(UPLOAD_ROOT, gone.lead_id, gone.filename);
      if (fp.startsWith(UPLOAD_ROOT + path.sep)) fs.promises.unlink(fp).catch(() => {});
    }
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Serve an uploaded image (for the Studio asset tray thumbnails).
router.get('/:id/file/:filename', (req, res) => {
  if (req.params.filename.includes('..') || req.params.filename.includes('/')) return res.status(400).end();
  const fp = path.join(UPLOAD_ROOT, req.params.id, req.params.filename);
  if (!fp.startsWith(UPLOAD_ROOT + path.sep) || !fs.existsSync(fp)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(fp);
});

// Live preview HTML (rendered in an iframe by the Studio).
router.get('/:id/preview.html', async (req, res) => {
  try {
    const lead = await studio.getLead(req.params.id);
    if (!lead) return res.status(404).end();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildHtml(lead));
  } catch (err) { res.status(500).send(err.message); }
});

// Download the PDF.
router.get('/:id/pdf', async (req, res) => {
  try {
    const lead = await studio.getLead(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Not found' });
    const buffer = await pdfService.generatePDFBuffer(buildHtml(lead));
    const name = `october-growth-snapshot-${(lead.company_name || 'prospect').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
