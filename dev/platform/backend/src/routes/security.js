// Security audit API — backs Settings → Security. Admin-only: the audit
// describes the platform's own security posture, so it's not something a
// viewer (or a client) should see. The heavy lifting is in services/securityAudit.

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/clientAccess');
const securityAudit = require('../services/securityAudit');

router.use(authenticate);
router.use(requireAdmin);

// Latest stored run + lightweight history for the dashboard. If nothing has
// run yet (fresh deploy before the first cron), kick one off so the page is
// never empty.
router.get('/audit', async (req, res) => {
  try {
    let latest = await securityAudit.getLatest();
    if (!latest) latest = await securityAudit.runAndStore('manual');
    const history = await securityAudit.getHistory(30);
    res.json({ latest, history, check_count: securityAudit.CHECK_COUNT });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run the audit on demand (the "Run now" button).
router.post('/audit/run', async (req, res) => {
  try {
    const run = await securityAudit.runAndStore('manual');
    res.status(201).json(run);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
