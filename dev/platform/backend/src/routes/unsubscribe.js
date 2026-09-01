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

// Parse form posts from the preference centre (and the RFC 8058 one-click body).
router.use(express.urlencoded({ extended: false, limit: '16kb' }));

function prefQuery(q) {
  const p = new URLSearchParams();
  for (const k of ['c', 's', 'cl', 'e', 'cm']) if (q[k]) p.set(k, q[k]);
  return `?${p.toString()}`;
}

// Update the journalist's own details — this feeds straight back into the media
// database (a contact correcting their own record is the best data we get).
async function updateDetails(contactId, body) {
  const sets = []; const params = [contactId];
  const add = (col, val) => { const v = (val || '').trim(); if (v) { params.push(col === 'email' ? v.toLowerCase() : v); sets.push(`${col} = $${params.length}`); } };
  add('name', body.name); add('email', body.email); add('company', body.company);
  if (!sets.length) return;
  await pool.query(`UPDATE outreach_contacts SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, params);
}

// Opt out of everything from October, permanently.
async function markGlobalDoNotContact(contactId) {
  await pool.query("UPDATE outreach_contacts SET status = 'do_not_contact' WHERE id = $1", [contactId]);
  await pool.query("UPDATE outreach_contact_clients SET unsubscribed_at = COALESCE(unsubscribed_at, NOW()) WHERE contact_id = $1", [contactId]);
  await pool.query("UPDATE outreach_sends SET status = 'cancelled' WHERE contact_id = $1 AND status = 'pending'", [contactId]);
}

// Opt out of just this one campaign/story.
async function unsubscribeCampaign(contactId, campaignId) {
  await pool.query("UPDATE outreach_sends SET status = 'cancelled' WHERE contact_id = $1 AND campaign_id = $2 AND status = 'pending'", [contactId, campaignId]);
}

// GET — the preference centre. A person, not a mass unsubscribe: update your
// details, or step out of this story / this sender / everything.
router.get('/', async (req, res) => {
  const { c, s, cl, e } = req.query;
  if (!verifySig(c, cl, s, e)) {
    return res.status(400).type('html').send(page('Link not recognised',
      'This link is not valid or has expired. If you\'d rather not be emailed, just reply to the message you received and we\'ll take you off.'));
  }
  try {
    const { rows } = await pool.query('SELECT name, email, company FROM outreach_contacts WHERE id = $1', [c]);
    if (!rows.length) return res.status(404).type('html').send(page('Not found', 'We couldn\'t find this contact — it may already have been removed.'));
    res.type('html').send(prefPage(rows[0], req.query));
  } catch (err) {
    res.status(500).type('html').send(page('Something went wrong', 'Please reply to the message you received and we\'ll sort it by hand.'));
  }
});

// POST — handles both the preference-centre form (with an `action`) and the
// Gmail/Yahoo one-click header POST (no action → treat as sender-scope opt-out,
// preserving RFC 8058 behaviour).
router.post('/', async (req, res) => {
  const { c, s, cl, e, cm } = req.query;
  const action = req.body?.action;
  if (!verifySig(c, cl, s, e)) {
    return action ? res.status(400).type('html').send(page('Link not recognised', 'This link is not valid or has expired.')) : res.status(400).end();
  }
  try {
    if (action === 'update') {
      await updateDetails(c, req.body || {});
      return res.type('html').send(page('Thanks — your details are updated', 'Your details have been corrected in our records. You can close this page.'));
    }
    if (action === 'all') {
      await markGlobalDoNotContact(c);
      return res.type('html').send(page('Done — you won\'t hear from us again', 'You\'ve been removed from all October Communications email. Sorry for the interruption.'));
    }
    if (action === 'campaign' && cm) {
      await unsubscribeCampaign(c, cm);
      return res.type('html').send(page('Done — removed from this story', 'You won\'t get further emails about this particular release.'));
    }
    // Default: sender-scope opt-out (the one-click path sends no action).
    await markUnsubscribed(c, cl);
    if (action) return res.type('html').send(page('Done — you\'ve been removed', 'You won\'t receive further emails from this sender. Reply to a past email if you change your mind.'));
    return res.status(200).end();
  } catch (err) {
    return action ? res.status(500).type('html').send(page('Something went wrong', 'Please reply to the message you received and we\'ll handle it by hand.')) : res.status(500).end();
  }
});

function escapeHtml(str) {
  return String(str ?? '').replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// The preference-centre form. Prefilled with what we hold; posts back to the
// same signed URL with an `action`.
function prefPage(contact, q) {
  const action = prefQuery(q);
  const campaignBtn = q.cm
    ? `<button type="submit" name="action" value="campaign" class="btn ghost">Just stop emails about this story</button>`
    : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your email preferences · October Communications</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafafa; color: #1a1a1a; margin: 0; padding: 48px 20px; }
  .wrap { max-width: 520px; margin: 0 auto; background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }
  .brand { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 16px; font-weight: 700; }
  h1 { margin: 0 0 6px; font-size: 20px; } p { color:#555; font-size:14px; line-height:1.6; margin:0 0 18px; }
  label { display:block; font-size:12px; color:#666; margin:10px 0 4px; font-weight:600; }
  input { width:100%; box-sizing:border-box; padding:9px 11px; border:1px solid #ddd; border-radius:6px; font-size:14px; }
  .btn { display:block; width:100%; box-sizing:border-box; margin-top:10px; padding:11px 16px; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; border:1px solid #111; background:#111; color:#fff; }
  .btn.ghost { background:#fff; color:#333; border-color:#ddd; font-weight:500; }
  .divider { border-top:1px solid #eee; margin:22px 0 4px; }
  .muted { font-size:12px; color:#999; margin-top:14px; }
</style></head><body><div class="wrap">
  <div class="brand">October Communications</div>
  <h1>Your email preferences</h1>
  <p>Update your details so we reach you properly — or choose how much you'd like to hear from us.</p>
  <form method="POST" action="${action}">
    <label>Name</label><input name="name" value="${escapeHtml(contact.name || '')}">
    <label>Email</label><input name="email" value="${escapeHtml(contact.email || '')}">
    <label>Publication / outlet</label><input name="company" value="${escapeHtml(contact.company || '')}">
    <button type="submit" name="action" value="update" class="btn">Save my details</button>
    <div class="divider"></div>
    <p class="muted">Or, if you'd rather not:</p>
    ${campaignBtn}
    <button type="submit" name="action" value="client" class="btn ghost">Don't email me about this client's work</button>
    <button type="submit" name="action" value="all" class="btn ghost">Don't email me again at all</button>
  </form>
  <p class="muted">Whatever you choose is honoured straight away.</p>
</div></body></html>`;
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
