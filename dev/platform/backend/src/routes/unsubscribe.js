// Public unsubscribe route. No auth — the URL is HMAC-signed so the
// signature itself is the credential. Lives at /api/unsubscribe and is
// mounted before any auth middleware so journalists can hit it directly
// from the email footer or via Gmail's one-click List-Unsubscribe-Post.
//
// Unsubscribe is per-client: a journalist who unsubscribes from LOLO's
// emails stays subscribed to Universal's. The link encodes both the
// contact_id and the client_id; we only mark the matching membership row.
// Legacy links without a client_id fall back to marking every membership.

const express = require('express');
const crypto = require('crypto');
const pool = require('../db');

const router = express.Router();

function sign(payload) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('hex').slice(0, 32);
}

// Accept the new timestamped form (preferred) AND the legacy
// deterministic form so unsubscribe links in emails already in the wild
// keep working through the rollout. Once the legacy footprint expires
// (campaigns are mostly < 30 days active), the fallback can be removed.
function verifySig(contactId, clientId, sig, exp) {
  if (!contactId || !sig || !process.env.JWT_SECRET) return false;
  // New form: includes an `e=<epoch>` query param + signs over it.
  if (exp) {
    const expNum = parseInt(exp, 10);
    if (!expNum || expNum < Math.floor(Date.now() / 1000)) return false;
    const payload = clientId
      ? `unsub:${contactId}:${clientId}:${expNum}`
      : `unsub:${contactId}::${expNum}`;
    const expected = sign(payload);
    try {
      if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return true;
    } catch { /* fall through to legacy check */ }
  }
  // Legacy form: deterministic HMAC, no expiry. Accepted until rollover.
  const legacyPayload = clientId ? `unsub:${contactId}:${clientId}` : `unsub:${contactId}`;
  const legacyExpected = sign(legacyPayload);
  try { return crypto.timingSafeEqual(Buffer.from(legacyExpected), Buffer.from(sig)); }
  catch { return false; }
}

async function markUnsubscribed(contactId, clientId) {
  if (clientId) {
    // Per-client unsubscribe — flip the membership timestamp and cancel
    // only the pending sends queued for this client's campaigns.
    await pool.query(
      `INSERT INTO outreach_contact_clients (contact_id, client_id, unsubscribed_at)
         VALUES ($1, $2, NOW())
       ON CONFLICT (contact_id, client_id)
         DO UPDATE SET unsubscribed_at = COALESCE(outreach_contact_clients.unsubscribed_at, NOW())`,
      [contactId, clientId]
    );
    await pool.query(
      `UPDATE outreach_sends s SET status = 'cancelled'
         FROM outreach_campaigns c
        WHERE s.campaign_id = c.id
          AND c.client_id = $1
          AND s.contact_id = $2
          AND s.status = 'pending'`,
      [clientId, contactId]
    );
    return;
  }
  // Legacy link (no client_id encoded) — unsubscribe from every client
  // the contact is attached to and cancel all pending sends globally.
  await pool.query(
    `UPDATE outreach_contact_clients
        SET unsubscribed_at = COALESCE(unsubscribed_at, NOW())
      WHERE contact_id = $1`,
    [contactId]
  );
  await pool.query(
    `UPDATE outreach_sends SET status = 'cancelled'
     WHERE contact_id = $1 AND status = 'pending'`,
    [contactId]
  );
}

// GET — public landing page. Lightweight HTML, no dependencies.
router.get('/', async (req, res) => {
  const { c, s, cl, e } = req.query;
  if (!verifySig(c, cl, s, e)) {
    return res.status(400).type('html').send(page('Invalid link',
      'This unsubscribe link is not valid or has been tampered with. If you wanted to unsubscribe, please reply to the email you received and we\'ll remove you manually.'));
  }
  try {
    const { rows } = await pool.query('SELECT email FROM outreach_contacts WHERE id = $1', [c]);
    if (!rows.length) {
      return res.status(404).type('html').send(page('Contact not found',
        'We couldn\'t find this contact in our records — it may have already been removed.'));
    }
    await markUnsubscribed(c, cl);
    res.type('html').send(page('You\'ve been unsubscribed',
      `<strong>${escapeHtml(rows[0].email)}</strong> has been removed from our list. You won't receive any further emails about press releases or campaigns from October Communications. If this was a mistake or you change your mind, just reply to a past email — we'll re-add you.`));
  } catch (err) {
    res.status(500).type('html').send(page('Something went wrong',
      `We hit an error processing your unsubscribe. Please reply to the email you received and we'll handle it manually. (Reference: ${escapeHtml(err.message)})`));
  }
});

// POST — Gmail / Yahoo one-click (RFC 8058). Same logic, just no
// rendered page; respond 200 to signal success.
router.post('/', async (req, res) => {
  const { c, s, cl, e } = req.query;
  if (!verifySig(c, cl, s, e)) return res.status(400).end();
  try {
    await markUnsubscribed(c, cl);
    res.status(200).end();
  } catch (err) {
    res.status(500).end();
  }
});

function escapeHtml(str) {
  return String(str ?? '').replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · October Communications</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafafa; color: #1a1a1a; margin: 0; padding: 60px 20px; }
  .wrap { max-width: 540px; margin: 0 auto; background: #fff; border: 1px solid #eee; border-radius: 6px; padding: 36px 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }
  h1 { margin: 0 0 14px; font-size: 22px; }
  p { margin: 0; font-size: 15px; line-height: 1.6; color: #444; }
  .brand { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 18px; font-weight: 700; }
</style>
</head><body><div class="wrap">
  <div class="brand">October Communications</div>
  <h1>${escapeHtml(title)}</h1>
  <p>${body}</p>
</div></body></html>`;
}

module.exports = router;
