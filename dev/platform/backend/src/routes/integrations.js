// Serves the downloadable integration artifacts referenced by the
// Integrations page. Currently the GTM container template — a parameterised
// JSON template with NO secrets (client-specific IDs are filled in inside GTM
// after import), so it's safe to serve unauthenticated. Mounted before the
// session-auth routes so a plain <a download> link works without a token.

const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Repo root, five levels up from this file (src/routes → src → backend →
// platform → dev → repo root). The GTM template lives in docs/, which the
// deploy checks out alongside the backend.
const GTM_CONTAINER = path.join(__dirname, '..', '..', '..', '..', '..', 'docs', 'october-mi-gtm', 'october-mi-v1.json');

router.get('/gtm-container', (req, res) => {
  if (!fs.existsSync(GTM_CONTAINER)) {
    return res.status(404).json({ error: 'GTM container template not found on the server.' });
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="october-mi-v1.json"');
  fs.createReadStream(GTM_CONTAINER).pipe(res);
});

module.exports = router;
