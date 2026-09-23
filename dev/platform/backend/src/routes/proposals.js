// Sales pipeline admin routes (docs/omi/sales-pipeline.md). Admin-only, same
// as Snapshot Studio: prospects are not clients.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/clientAccess');
const proposals = require('../services/proposals');

const router = express.Router();
router.use(authenticate, requireAdmin);

const wrap = (fn, code = 400) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out === null) return res.status(404).json({ error: 'Not found' });
    if (out !== undefined) res.json(out);
  } catch (err) { res.status(code).json({ error: err.message }); }
};

// ── Proof library ───────────────────────────────────────────────────────────
router.get('/proof', wrap(() => proposals.listProof({ includeInactive: true }), 500));
router.post('/proof', wrap((req) => proposals.saveProof(null, req.body || {})));
router.put('/proof/:id', wrap((req) => proposals.saveProof(req.params.id, req.body || {})));
router.delete('/proof/:id', wrap(async (req, res) => { await proposals.deleteProof(req.params.id); res.status(204).end(); }));

// ── Lead stage actions (call booked, pre-call brief) ────────────────────────
router.post('/lead/:leadId/call', wrap((req) => proposals.markCallBooked(req.params.leadId, req.body?.call_at)));
router.post('/lead/:leadId/brief', wrap((req) => proposals.callBrief(req.params.leadId), 502));
router.get('/lead/:leadId', wrap((req) => proposals.listForLead(req.params.leadId), 500));

// ── Proposals ───────────────────────────────────────────────────────────────
router.get('/', wrap(() => proposals.listProposals(), 500));

// Draft from a lead (Claude, ~30-60s): reads the site again, the snapshot and
// the call notes, then matches proof and prices it.
router.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.lead_id) throw new Error('lead_id required');
  const p = await proposals.generate(b.lead_id, {
    recipientNames: b.recipient_names, recipientEmail: b.recipient_email,
    callNotes: b.call_notes, angle: b.angle, currency: b.currency,
    setupFee: b.setup_fee === '' || b.setup_fee == null ? null : Number(b.setup_fee),
  });
  res.status(201).json(p);
}, 502));

router.get('/:id', wrap((req) => proposals.getProposal(req.params.id), 500));
router.get('/:id/preview', wrap(async (req) => {
  const p = await proposals.getProposal(req.params.id);
  return p ? proposals.publicPayload(p) : null;
}, 500));
router.patch('/:id', wrap((req) => proposals.update(req.params.id, req.body || {})));
router.post('/:id/refine', wrap((req) => {
  const m = String(req.body?.message || '').trim();
  if (!m) throw new Error('message required');
  return proposals.refine(req.params.id, m);
}, 502));
router.post('/:id/send', wrap((req) => proposals.send(req.params.id, req.body || {}), 502));
router.delete('/:id', wrap(async (req, res) => { await proposals.remove(req.params.id); res.status(204).end(); }));

module.exports = router;
