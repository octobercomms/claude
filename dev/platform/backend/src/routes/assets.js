/**
 * The client asset library, over HTTP.
 *
 * Read-heavy on purpose. Assets are created by whichever tool produced them,
 * never by posting here: a row in this table is a claim that something exists,
 * and the only thing entitled to make that claim is the thing that made it.
 * What this surface offers is finding, filtering and archiving.
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, assertClientAccess } = require('../middleware/clientAccess');
const assets = require('../services/assets');
const pool = require('../db');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);

router.get('/clients/:clientId/assets',
  requireClientAccess({ paramNames: ['clientId'] }), async (req, res) => {
    try {
      const { kind, source, search, limit, offset, archived } = req.query;
      const rows = await assets.list(req.params.clientId, {
        kind: kind || null,
        source: source || null,
        search: search || null,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
        includeArchived: archived === '1',
      });
      res.json({
        assets: rows,
        counts: await assets.counts(req.params.clientId),
        // The sources present for THIS client, so the filter offers only what
        // exists rather than a list of eight mostly-empty options.
        sources: [...new Set(rows.map((r) => r.source))].sort(),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

/** Resolve one asset, with its access checked through the client that owns it. */
async function assetAccess(req, res, next) {
  try {
    const row = await assets.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'No such asset' });
    assertClientAccess(req, row.client_id);
    req.asset = row;
    next();
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
}

router.get('/assets/:id', assetAccess, (req, res) => res.json(req.asset));

// Archive, never delete. A scheduled post holding this id must still be able to
// resolve it, and "we made this and dropped it" is worth knowing when the same
// idea comes round again.
router.put('/assets/:id/archived', assetAccess, async (req, res) => {
  try {
    res.json(await assets.archive(req.params.id, req.body?.archived !== false));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/assets/:id/title', assetAccess, async (req, res) => {
  try {
    const title = String(req.body?.title ?? '').slice(0, 300);
    const { rows } = await pool.query(
      'UPDATE client_assets SET title = $1 WHERE id = $2 RETURNING *', [title, req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
