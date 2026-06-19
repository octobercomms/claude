// Instagram DM webhook — Meta calls this (no platform session). GET verifies
// the subscription (echoes hub.challenge when the verify token matches); POST
// receives messaging/comment events, HMAC-verified against META_APP_SECRET via
// the raw body captured by express.json. Mounted BEFORE auth and the global
// limiter so Meta can reach it. See services/metaMessaging.js.

const express = require('express');
const meta = require('../services/metaMessaging');

const router = express.Router();

// Subscription verification handshake.
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === meta.verifyToken()) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Event delivery. Ack fast (Meta retries on non-200), process async.
router.post('/', async (req, res) => {
  const ok = await meta.verifySignature(req.rawBody, req.get('X-Hub-Signature-256')).catch(() => false);
  if (!ok) return res.sendStatus(403);
  res.sendStatus(200);
  meta.handleWebhook(req.body).catch(err => console.error('[dm-webhook] handler:', err.message));
});

module.exports = router;
