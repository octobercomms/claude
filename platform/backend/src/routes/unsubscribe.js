// Public unsubscribe route. No auth — the URL is HMAC-signed so the
// signature itself is the credential. Lives at /api/unsubscribe and is
// mounted before any auth middleware so journalists can hit it directly
// from the email footer or via Gmail's one-click List-Unsubscribe-Post.

const express = require('express');
const crypto = require('crypto');
const pool = require('../db');

const router = express.Router();

function verifySig(contactId, sig) {
  if (!contactId || !sig || !process.env.JWT_SECRET) return false;
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(`unsub:${contactId}`).digest('hex').slice(0, 32);
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)); }
  catch { return false; }
}

async function markUnsubscribed(contactId) {
  await pool.query(
    `UPDATE outreach_contacts
       SET status = 'unsubscribed', unsubscribed_at = COALESCE(unsubscribed_at, NOW())
     WHERE id = $1`,
    [contactId]
  );
  // Cancel any pending sends to this contact so they don't receive the
  // queued follow-ups after clicking unsubscribe.
  await pool.query(
    `UPDATE outreach_sends SET status = 'cancelled'
     WHERE contact_id = $1 AND status = 'pending'`,
    [contactId]
  );
}

// GET — public landing page. Lightweight HTML, no dependencies.
router.get('/', async (req, res) => {
  const { c, s } = req.query;
  if (!verifySig(c, s)) {
    return res.status(400).type('html').send(page('Invalid link',
      'This unsubscribe link is not valid or has been tampered with. If you wanted to unsubscribe, please reply to the email you received and we\'ll remove you manually.'));
  }
  try {
    const { rows } = await pool.query('SELECT email, status FROM outreach_contacts WHERE id = $1', [c]);
    if (!rows.length) {
      return res.status(404).type('html').send(page('Contact not found',
        'We couldn\'t find this contact in our records — it may have already been removed.'));
    }
    await markUnsubscribed(c);
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
  const { c, s } = req.query;
  if (!verifySig(c, s)) return res.status(400).end();
  try {
    await markUnsubscribed(c);
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
