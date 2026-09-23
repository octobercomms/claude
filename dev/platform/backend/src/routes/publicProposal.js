// Public proposal endpoints: token-gated, no login. The prospect's page
// (/p/:token in the SPA) reads the proposal, reports opens and section dwell,
// and accepts. Tight limiters: these are unauthenticated writes.

const express = require('express');
const rateLimit = require('express-rate-limit');
const proposals = require('../services/proposals');

const router = express.Router();
const readLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120 });
const pingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 400 });
const acceptLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.get('/:token', readLimiter, async (req, res) => {
  try {
    const p = await proposals.getByToken(req.params.token);
    if (!p || p.status === 'draft' || p.status === 'lost') return res.status(404).json({ error: 'Not found' });
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.json(await proposals.publicPayload(p));
  } catch (err) { res.status(500).json({ error: 'Something went wrong' }); }
});

router.post('/:token/open', readLimiter, express.json(), async (req, res) => {
  try {
    await proposals.recordOpen(req.params.token, req.body?.session, req.headers['user-agent']);
    res.status(204).end();
  } catch { res.status(204).end(); }
});

// Heartbeat: { session, sections: { situation: 10, pricing: 5 } } seconds since last ping.
// Also accepts text/plain from navigator.sendBeacon on tab close.
router.post('/:token/ping', pingLimiter, express.text({ type: 'text/plain' }), async (req, res) => {
  try {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
    await proposals.recordPing(req.params.token, b?.session, b?.sections);
    res.status(204).end();
  } catch { res.status(204).end(); }
});

router.post('/:token/accept', acceptLimiter, express.json(), async (req, res) => {
  try {
    const out = await proposals.accept(req.params.token, {
      name: req.body?.name, pkg: req.body?.package, agreed: !!req.body?.agreed,
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    res.json(out);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
