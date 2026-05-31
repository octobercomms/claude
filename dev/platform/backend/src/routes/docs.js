// Serves in-repo docs that the UI links to. Today: the DataForSEO
// 1 July 2026 checklist. Auth-gated because it's internal plan
// content, not a public reference.
//
// Sunset note: once Phase E is in production, delete this whole file
// (and its mount in index.js). See docs/nvelope/dataforseo-july-2026.md §6
// for the cleanup checklist.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// Repo docs live at <repo-root>/docs/nvelope/. This file sits at
// dev/platform/backend/src/routes/, so five ../ reach the repo root.
const DOC_ROOT = path.resolve(__dirname, '../../../../../docs/nvelope');

const ALLOWED = new Set(['dataforseo-july-2026.md']);

router.get('/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!ALLOWED.has(filename)) {
    return res.status(404).json({ error: 'Document not found' });
  }
  const filePath = path.join(DOC_ROOT, filename);
  // Defence-in-depth: path.join already collapses traversal, but verify
  // the resolved path is still under DOC_ROOT before reading.
  if (!filePath.startsWith(DOC_ROOT + path.sep)) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  fs.readFile(filePath, 'utf-8', (err, body) => {
    if (err) return res.status(404).json({ error: 'Document not found' });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  });
});

module.exports = router;
