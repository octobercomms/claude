// Public ingest for MailFlow's out-of-office contact-change suggestions.
// Mounted at /api/ooo BEFORE the session-auth routes: MailFlow authenticates
// with a shared bearer token (no user credentials cross the boundary), not a
// logged-in session. The token is configured at both ends — here it comes from
// the MAILFLOW_INGEST_TOKEN platform setting (env var of the same name as a
// fallback). The review/apply side lives under the authenticated
// /api/outreach/ooo/* routes.

const express = require('express');
const crypto = require('crypto');
const { getSetting } = require('../utils/settings');
const ooo = require('../services/oooSuggestions');

const router = express.Router();
router.use(express.json({ limit: '4mb' })); // sized for a few hundred items, not thousands

// Constant-time bearer check against the configured shared token.
async function tokenOk(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  let configured = null;
  try { configured = await getSetting('MAILFLOW_INGEST_TOKEN'); } catch { /* fall through */ }
  configured = configured || process.env.MAILFLOW_INGEST_TOKEN || null;
  if (!configured) return null; // not set up
  const a = Buffer.from(m[1]);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

// POST /api/ooo/suggestions — accept a batch, upsert idempotently on each id,
// and return per-item status so MailFlow can mark its own rows pushed.
router.post('/suggestions', async (req, res) => {
  const ok = await tokenOk(req);
  if (ok === null) return res.status(503).json({ error: 'Ingest not configured (MAILFLOW_INGEST_TOKEN unset).' });
  if (!ok) return res.status(401).json({ error: 'Unauthorized' });

  const body = req.body || {};
  const suggestions = Array.isArray(body.suggestions) ? body.suggestions : null;
  if (!suggestions) return res.status(400).json({ error: 'suggestions array required' });
  if (suggestions.length > 1000) return res.status(413).json({ error: 'Batch too large (max 1000).' });

  const results = [];
  for (const item of suggestions) {
    try {
      results.push(await ooo.upsertSuggestion(item, body.user));
    } catch (err) {
      results.push({ id: item?.id || null, accepted: false, error: err.message });
    }
  }
  res.json({ results });
});

module.exports = router;
