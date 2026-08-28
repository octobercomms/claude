// Public opt-out for Selective Outreach — no auth, the token IS the credential
// (unguessable, per-prospect). Backs both the natural-language "don't email me
// again" link and Gmail/Yahoo one-click List-Unsubscribe (RFC 8058). Mounted
// before the auth middleware so a recipient can always get off the list.

const express = require('express');
const optout = require('../services/prospecting/optout');

const router = express.Router();

function escapeHtml(str) {
  return String(str ?? '').replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafafa; color: #1a1a1a; margin: 0; padding: 60px 20px; }
  .wrap { max-width: 540px; margin: 0 auto; background: #fff; border: 1px solid #eee; border-radius: 6px; padding: 36px 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }
  h1 { margin: 0 0 14px; font-size: 22px; }
  p { margin: 0; font-size: 15px; line-height: 1.6; color: #444; }
</style>
</head><body><div class="wrap"><h1>${escapeHtml(title)}</h1><p>${body}</p></div></body></html>`;
}

// GET — the human-facing link. Opting out on view is deliberate: the whole point
// is a frictionless "take me off", and the fail-safe direction is not-emailing.
router.get('/', async (req, res) => {
  const token = req.query.t;
  try {
    const out = await optout.optOut(token, { actor: 'recipient' });
    if (!out.ok) {
      return res.status(400).type('html').send(page('Link not recognised',
        'This link is not valid. If you would rather not be emailed, just reply to the message you received and we will remove you.'));
    }
    res.type('html').send(page('Done — you won\'t be emailed again',
      `${out.email ? `<strong>${escapeHtml(out.email)}</strong> has been` : 'You have been'} removed and won't be contacted again. Sorry for the interruption.`));
  } catch (err) {
    res.status(500).type('html').send(page('Something went wrong',
      'We hit an error. Please reply to the message you received and we will take you off by hand.'));
  }
});

// POST — Gmail/Yahoo one-click (List-Unsubscribe-Post). Same effect, no page.
router.post('/', async (req, res) => {
  try {
    const out = await optout.optOut(req.query.t, { actor: 'one-click' });
    return res.status(out.ok ? 200 : 400).end();
  } catch { return res.status(500).end(); }
});

module.exports = router;
