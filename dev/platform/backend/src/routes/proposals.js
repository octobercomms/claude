// Sales pipeline admin routes (docs/omi/sales-pipeline.md). Admin-only, same
// as Snapshot Studio: prospects are not clients.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/clientAccess');
const proposals = require('../services/proposals');
const methods = require('../services/proposalMethods');

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

// ── Methods: the offer, as data ─────────────────────────────────────────────
router.get('/methods', wrap(async () => ({
  methods: await methods.listMethods({ includeInactive: true }),
  currencies: methods.CURRENCY_CODES.map(c => methods.CURRENCIES[c]),
}), 500));
router.post('/methods', wrap((req) => methods.saveMethod(null, req.body || {})));
router.put('/methods/:id', wrap((req) => methods.saveMethod(req.params.id, req.body || {})));
router.delete('/methods/:id', wrap((req) => methods.deleteMethod(req.params.id)));

// ── Reading the call notes (pass one) ───────────────────────────────────────
// Separate from drafting on purpose: Daniel sees the facts, and the list of what
// the call never established, before a word is written. Nothing said in
// confidence on a call should reach a document the prospect can forward.
router.post('/extract', wrap(async (req) => {
  const out = await proposals.extractFacts(req.body?.notes);
  if (!out) throw new Error('Paste the call notes or the transcript first.');
  return out;
}, 502));

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
    callNotes: b.call_notes, angle: b.angle,
    methodId: b.method_id, currency: b.currency,
    // An extraction the draft screen already ran and Daniel has looked at,
    // so drafting does not read the transcript a second time.
    extraction: b.extraction,
  });
  res.status(201).json(p);
}, 502));

router.get('/:id', wrap((req) => proposals.getProposal(req.params.id), 500));
router.get('/:id/preview', wrap(async (req) => {
  const p = await proposals.getProposal(req.params.id);
  return p ? proposals.publicPayload(p) : null;
}, 500));
router.patch('/:id', wrap((req) => proposals.update(req.params.id, req.body || {})));
// Reprice or change the level without a redraft: Daniel picks the method from
// the call, and changing his mind must not cost another generation.
router.post('/:id/method', wrap((req) => proposals.setMethod(req.params.id, {
  methodId: req.body?.method_id, currency: req.body?.currency,
})));
router.post('/:id/refine', wrap((req) => {
  const m = String(req.body?.message || '').trim();
  if (!m) throw new Error('message required');
  return proposals.refine(req.params.id, m);
}, 502));
router.post('/:id/send', wrap((req) => proposals.send(req.params.id, req.body || {}), 502));
router.delete('/:id', wrap(async (req, res) => { await proposals.remove(req.params.id); res.status(204).end(); }));

module.exports = router;
