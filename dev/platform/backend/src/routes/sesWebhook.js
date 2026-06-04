// SES bounce + complaint notification ingress. SES doesn't push directly to
// HTTP — you wire an SES Configuration Set to publish Bounce / Complaint /
// Delivery events to an SNS topic, then subscribe this URL as the topic's
// HTTPS endpoint. Lives at /api/ses/webhook and is mounted before auth so
// SNS (which never carries a session) can post to it.
//
// Setup (one-off):
//   1. Create an SNS topic, e.g. october-ses-events
//   2. Create an HTTPS subscription with this endpoint as the URL
//   3. In SES → Configuration Sets, create or pick a configuration set and
//      add an event destination targeting the SNS topic for Bounce + Complaint
//   4. Tell outreachSender to send via that configuration set
//
// First POST from SNS will be a SubscriptionConfirmation — we GET the
// SubscribeURL to confirm. Subsequent posts are Notification messages whose
// Message field is a JSON string containing the bounce details.

const express = require('express');
const axios = require('axios');
const bounceHandler = require('../services/bounceHandler');
const { verifySnsMessage, isTrustedSnsUrl } = require('../utils/snsVerify');

const router = express.Router();

router.post('/webhook', express.json({ type: '*/*', limit: '256kb' }), async (req, res) => {
  try {
    const body = req.body || {};
    const type = body.Type || req.get('x-amz-sns-message-type');

    // Reject any message that doesn't carry a valid AWS SNS signature.
    // Without this, an attacker can POST a fabricated Notification to
    // mass-mark contacts as bounced (suppressing every future campaign
    // email to them) or POST a fabricated SubscriptionConfirmation to
    // make the server fetch an attacker-controlled URL. Verification
    // also guards SubscribeURL so a forged confirmation can't redirect
    // outbound traffic at internal infrastructure.
    try {
      await verifySnsMessage(body);
    } catch (verr) {
      console.warn('[SES webhook] rejecting unsigned/forged message:', verr.message);
      return res.status(403).end();
    }

    // Subscription handshake — visit the URL SNS handed us so the topic
    // marks the subscription as confirmed. Even with a valid SNS
    // signature we re-check the URL host before fetching: a signature
    // proves AWS sent the message, but we want the SubscribeURL itself
    // to point at the SNS API (not at some other AWS-signed surface).
    if (type === 'SubscriptionConfirmation' && body.SubscribeURL) {
      if (!isTrustedSnsUrl(body.SubscribeURL)) {
        console.warn('[SES webhook] refusing untrusted SubscribeURL host:', body.SubscribeURL);
        return res.status(400).end();
      }
      try {
        await axios.get(body.SubscribeURL, { timeout: 8000, maxRedirects: 0 });
        console.log('[SES webhook] subscription confirmed:', body.TopicArn);
      } catch (err) {
        console.error('[SES webhook] subscription confirm failed:', err.message);
      }
      return res.status(200).end();
    }

    if (type === 'UnsubscribeConfirmation') {
      console.warn('[SES webhook] received UnsubscribeConfirmation for topic', body.TopicArn);
      return res.status(200).end();
    }

    if (type === 'Notification') {
      // The Bounce/Complaint payload is itself a JSON string inside Message.
      let payload;
      try { payload = JSON.parse(body.Message); }
      catch { return res.status(400).end(); }
      const result = await bounceHandler.handleSesEvent(payload);
      if (result.kind) console.log('[SES webhook]', result.kind, 'for', payload.mail?.messageId);
      return res.status(200).json(result);
    }

    res.status(200).end();
  } catch (err) {
    console.error('[SES webhook] failed:', err.message);
    res.status(500).end();
  }
});

module.exports = router;
