// Paid pillar — the one place without a dedicated router. This exists to serve
// the Paid Overview PDF (performance flows through /api/connectors and audiences
// through /api/audiences; neither is the natural home for a whole-pillar export).
// Same authenticated-per-tenant stack as the other pillars.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const overviewReport = require('../services/overviewReport');
const paidOverviewReport = require('../services/paidOverviewReport');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// Branded, client-facing PDF of the whole Paid (Ads) Overview.
router.get('/clients/:clientId/overview-report.pdf', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    await overviewReport.sendReport(res, {
      clientId: req.params.clientId, report: paidOverviewReport, days,
      slugPrefix: 'paid-overview', feature: 'paid_overview_report',
      emptyMsg: 'No paid data yet — connect an ad account or map an audience first, then export.',
    });
  } catch (err) {
    console.error('[paid-overview] report failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
