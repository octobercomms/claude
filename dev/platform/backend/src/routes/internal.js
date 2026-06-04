// Internal-facing endpoints used by the SPA itself (not by AMs hitting
// the public API). For now: frontend error reporting, called from the
// React ErrorBoundary + window-level error/rejection listeners.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const errorTracker = require('../services/errorTracker');

const router = express.Router();

// Accept frontend errors authenticated or not — an error during the
// login flow itself happens before a token exists, and refusing those
// would lose exactly the errors we most need to see. We DO still gate
// by IP rate limit (applied globally to /api at the app level) so a
// hostile crawler can't flood the log.
router.post('/log-frontend-error', express.json({ limit: '256kb' }), async (req, res) => {
  const body = req.body || {};
  // Optional auth — best-effort: if a token is present and valid,
  // attach the user id to context so the digest can pivot by user.
  let userId = null;
  if (req.headers.authorization) {
    try {
      await new Promise((resolve, reject) => authenticate(req, res, err => err ? reject(err) : resolve()));
      if (res.headersSent) return;
      userId = req.user?.id || null;
    } catch { /* unauthenticated reporters are still allowed */ }
  }
  try {
    await errorTracker.recordError({
      source: 'frontend',
      message: body.message,
      stack: body.stack,
      userAgent: body.user_agent,
      context: {
        url: body.url || null,
        component_stack: body.component_stack || null,
        user_id: userId,
        report_source: body.source || 'error-boundary',
      },
    });
    res.status(204).end();
  } catch {
    res.status(500).end();
  }
});

module.exports = router;
