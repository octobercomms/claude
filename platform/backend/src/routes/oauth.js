const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const pool = require('../db');
const { encrypt, decrypt } = require('../utils/encryption');
const googleConnector = require('../connectors/google');
const metaConnector = require('../connectors/meta');
const zohoInventoryConnector = require('../connectors/zoho_inventory');
const amazonConnector = require('../connectors/amazon');
const shopifyConnector = require('../connectors/shopify');
const { authenticate } = require('../middleware/auth');
const users = require('../services/users');

const router = express.Router();

// Safe summary of an Axios / generic error for logs. axios.error.toJSON()
// includes request body + headers — that's where the OAuth client_secret
// and code land on token-exchange failures. We never want those in
// stdout / journalctl / forwarded log pipelines.
function safeErrSummary(err) {
  return {
    message: err.message,
    status: err.response?.status || null,
    upstream_status: err.response?.data?.error || err.response?.data?.error_description || null,
  };
}

// OAuth state is HMAC-signed so an attacker can't forge ?client_id=<victim>
// into a /start URL or replay an old one. Signature binds the payload to
// JWT_SECRET; callbacks verify it before trusting the client_id (and
// connector_id) inside.
function signOAuthState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, ts: Math.floor(Date.now() / 1000) })).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyOAuthState(state) {
  if (!state || typeof state !== 'string') return null;
  const dot = state.lastIndexOf('.');
  if (dot < 0) return null;
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch { return null; }
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); }
  catch { return null; }
  // 30-minute lifetime — bounds replay risk.
  if (!payload.ts || Math.floor(Date.now() / 1000) - payload.ts > 1800) return null;
  return payload;
}

// Visibility check before initiating any OAuth — caller must be allowed
// to attach connectors to the targeted client.
async function gateOAuthStart(req, res, next) {
  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).send('client_id required');
  try {
    const visible = await users.getVisibleClientIds(req.user);
    if (!users.canAccessClient(visible, clientId)) {
      return res.status(403).send('Not authorised for this client');
    }
    next();
  } catch (err) {
    res.status(500).send(err.message);
  }
}
router.use(['/google/start', '/meta/start', '/shopify/start', '/zoho/start', '/amazon/start', '/meta/reauth'],
  authenticate, gateOAuthStart);

// ─── Google OAuth ───────────────────────────────────────────────

router.get('/google/start', (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).send('client_id required');
  const state = signOAuthState({ client_id });
  const url = googleConnector.getAuthUrl(state);
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(oauthPopupHtml('error', error));

  try {
    const { client_id } = (verifyOAuthState(state) || (() => { throw new Error('Invalid or expired OAuth state'); })());
    const tokens = await googleConnector.exchangeCode(code);
    const encrypted = encrypt(tokens);

    // Update every Google connector this client already has, AND ensure all
    // four Google types exist — one OAuth should unlock GA4, Search Console,
    // Google Ads and Merchant Center together rather than making the user
    // run the consent flow four times.
    const googleTypes = ['ga4', 'google_search_console', 'google_ads', 'google_merchant_center'];
    for (const type of googleTypes) {
      const { rowCount } = await pool.query(
        `UPDATE connectors SET credentials = $1, status = 'active', last_checked = NOW(), error_message = NULL
         WHERE client_id = $2 AND connector_type = $3`,
        [JSON.stringify(encrypted), client_id, type]
      );
      if (rowCount === 0) {
        await pool.query(
          `INSERT INTO connectors (client_id, connector_type, credentials, status, last_checked)
           VALUES ($1, $2, $3, 'active', NOW())`,
          [client_id, type, JSON.stringify(encrypted)]
        );
      }
    }

    res.send(oauthPopupHtml('success', 'Google connected successfully.', 'google'));
  } catch (err) {
    console.error('Google OAuth callback error:', safeErrSummary(err));
    res.send(oauthPopupHtml('error', err.message));
  }
});

// ─── Meta OAuth ─────────────────────────────────────────────────

router.get('/meta/start', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).send('client_id required');
  const state = signOAuthState({ client_id });
  try {
    const url = await metaConnector.getAuthUrl(state);
    res.redirect(url);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.get('/meta/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(oauthPopupHtml('error', error));

  try {
    const { client_id } = (verifyOAuthState(state) || (() => { throw new Error('Invalid or expired OAuth state'); })());
    const tokens = await metaConnector.exchangeCode(code);
    const encrypted = encrypt(tokens);

    // Same pattern as Google — one Meta OAuth covers Meta Ads and Instagram
    // Insights, so ensure both rows exist for this client.
    const metaTypes = ['meta_ads', 'instagram_insights'];
    for (const type of metaTypes) {
      const { rowCount } = await pool.query(
        `UPDATE connectors SET credentials = $1, status = 'active', last_checked = NOW(), error_message = NULL
         WHERE client_id = $2 AND connector_type = $3`,
        [JSON.stringify(encrypted), client_id, type]
      );
      if (rowCount === 0) {
        await pool.query(
          `INSERT INTO connectors (client_id, connector_type, credentials, status, last_checked)
           VALUES ($1, $2, $3, 'active', NOW())`,
          [client_id, type, JSON.stringify(encrypted)]
        );
      }
    }

    res.send(oauthPopupHtml('success', 'Meta connected successfully.', 'meta'));
  } catch (err) {
    console.error('Meta OAuth callback error:', safeErrSummary(err));
    res.send(oauthPopupHtml('error', err.message));
  }
});

// ─── Shopify OAuth ──────────────────────────────────────────────

const SHOPIFY_SCOPES = shopifyConnector.REQUIRED_SCOPES.join(',');

router.get('/shopify/start', async (req, res) => {
  const { client_id, shop, connector_id } = req.query;
  if (!client_id || !shop || !connector_id) return res.status(400).send('client_id, shop, and connector_id required');

  // Per-connector app credentials take precedence over global platform settings.
  let shopifyClientId = process.env.SHOPIFY_CLIENT_ID;
  try {
    const { rows } = await pool.query('SELECT credentials FROM connectors WHERE id = $1', [connector_id]);
    if (rows.length && rows[0].credentials) {
      const creds = decrypt(rows[0].credentials);
      if (creds?.shopify_client_id) shopifyClientId = creds.shopify_client_id;
    }
  } catch {}

  const redirectUri = process.env.SHOPIFY_REDIRECT_URI || `${process.env.APP_URL || ''}/auth/shopify/callback`;
  if (!shopifyClientId) return res.status(500).send('No Shopify API Key configured — set one in platform Settings or enter per-client app credentials in the connector modal.');

  const shopDomain = shop.includes('.') ? shop : `${shop}.myshopify.com`;
  const state = signOAuthState({ client_id, connector_id, shop: shopDomain });

  const url = `https://${shopDomain}/admin/oauth/authorize?client_id=${shopifyClientId}&scope=${SHOPIFY_SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.redirect(url);
});

router.get('/shopify/callback', async (req, res) => {
  const { code, state, shop, hmac, error } = req.query;
  if (error) return res.send(oauthPopupHtml('error', error));

  try {
    const { client_id, connector_id } = (verifyOAuthState(state) || (() => { throw new Error('Invalid or expired OAuth state'); })());

    // Load existing connector credentials — per-connector app credentials take
    // precedence over global platform settings, and we preserve them when
    // saving the new access_token so they aren't wiped on reconnect.
    const { rows } = await pool.query('SELECT credentials FROM connectors WHERE id = $1', [connector_id]);
    const existingCreds = rows[0]?.credentials ? decrypt(rows[0].credentials) || {} : {};
    const shopifyClientId = existingCreds.shopify_client_id || process.env.SHOPIFY_CLIENT_ID;
    const shopifyClientSecret = existingCreds.shopify_client_secret || process.env.SHOPIFY_CLIENT_SECRET;
    if (!shopifyClientSecret) throw new Error('SHOPIFY_CLIENT_SECRET not configured');

    // Verify HMAC
    const params = { ...req.query };
    delete params.hmac;
    delete params.signature;
    const message = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    const digest = crypto.createHmac('sha256', shopifyClientSecret).update(message).digest('hex');
    if (digest !== hmac) throw new Error('HMAC verification failed');

    // Exchange code for access token
    const tokenRes = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: shopifyClientId,
      client_secret: shopifyClientSecret,
      code,
    });

    const { access_token } = tokenRes.data;
    if (!access_token) throw new Error('No access token returned');

    // Merge with existing credentials to preserve shopify_client_id/secret
    const credentials = { ...existingCreds, shop_domain: shop, access_token };
    const encrypted = encrypt(credentials);

    await pool.query(
      `UPDATE connectors SET credentials = $1, status = 'active', last_checked = NOW(), error_message = NULL WHERE id = $2`,
      [JSON.stringify(encrypted), connector_id]
    );

    res.send(oauthPopupHtml('success', `Shopify connected: ${shop}`));
  } catch (err) {
    console.error('Shopify OAuth callback error:', err.message);
    res.send(oauthPopupHtml('error', err.message));
  }
});

// ─── Zoho Inventory OAuth ────────────────────────────────────────

router.get('/zoho/start', (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).send('client_id required');
  const state = signOAuthState({ client_id });
  const url = zohoInventoryConnector.getAuthUrl(state);
  res.redirect(url);
});

router.get('/zoho/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(oauthPopupHtml('error', error));

  try {
    const { client_id } = (verifyOAuthState(state) || (() => { throw new Error('Invalid or expired OAuth state'); })());
    // Zoho returns the issuing data centre as `accounts-server` — the code
    // is only redeemable there.
    const tokens = await zohoInventoryConnector.exchangeCode(code, req.query['accounts-server']);
    const encrypted = encrypt(tokens);

    await pool.query(
      `UPDATE connectors SET credentials = $1, status = 'active', last_checked = NOW(), error_message = NULL
       WHERE client_id = $2 AND connector_type = 'zoho_inventory'`,
      [JSON.stringify(encrypted), client_id]
    );

    res.send(oauthPopupHtml('success', 'Zoho Inventory connected successfully.', 'zoho'));
  } catch (err) {
    console.error('Zoho OAuth callback error:', safeErrSummary(err));
    res.send(oauthPopupHtml('error', err.message));
  }
});

// ─── Amazon SP-API OAuth ─────────────────────────────────────────

router.get('/amazon/start', (req, res) => {
  const { client_id, connector_id } = req.query;
  if (!client_id) return res.status(400).send('client_id required');
  if (!process.env.AMAZON_CLIENT_ID) return res.status(400).send('AMAZON_CLIENT_ID not configured in Settings');
  const state = signOAuthState({ client_id, connector_id });
  const url = amazonConnector.getAuthUrl(state);
  res.redirect(url);
});

router.get('/amazon/callback', async (req, res) => {
  const { spapi_oauth_code, selling_partner_id, state, error } = req.query;
  if (error) return res.send(oauthPopupHtml('error', error));
  if (!spapi_oauth_code) return res.send(oauthPopupHtml('error', 'No OAuth code received from Amazon'));
  try {
    const { client_id, connector_id } = (verifyOAuthState(state) || (() => { throw new Error('Invalid or expired OAuth state'); })());
    const tokens = await amazonConnector.exchangeCode(spapi_oauth_code);
    const creds = encrypt({ ...tokens, seller_id: selling_partner_id });

    // Find connector: use specific connector_id if provided, otherwise latest disconnected amazon_seller
    let connectorRow;
    if (connector_id) {
      const { rows } = await pool.query('SELECT * FROM connectors WHERE id = $1', [connector_id]);
      connectorRow = rows[0];
    }
    if (!connectorRow) {
      const { rows } = await pool.query(
        "SELECT * FROM connectors WHERE client_id = $1 AND connector_type = 'amazon_seller' AND status != 'active' ORDER BY created_at DESC LIMIT 1",
        [client_id]
      );
      connectorRow = rows[0];
    }
    if (!connectorRow) {
      // Create a new connector
      const { rows } = await pool.query(
        "INSERT INTO connectors (client_id, connector_type, store_label) VALUES ($1, 'amazon_seller', $2) RETURNING *",
        [client_id, selling_partner_id || null]
      );
      connectorRow = rows[0];
    }

    await pool.query(
      "UPDATE connectors SET credentials = $1, status = 'active', last_checked = NOW(), error_message = NULL WHERE id = $2",
      [JSON.stringify(creds), connectorRow.id]
    );
    res.send(oauthPopupHtml('success', `Amazon Seller ${selling_partner_id || ''} connected successfully.`, 'amazon'));
  } catch (err) {
    console.error('Amazon OAuth callback error:', safeErrSummary(err));
    res.send(oauthPopupHtml('error', err.message));
  }
});

// ─── Reauth links ────────────────────────────────────────────────

// Reauth link from email alert (token-less, opens OAuth flow)
router.get('/meta/reauth', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).send('client_id required');
  const state = signOAuthState({ client_id });
  try {
    const url = await metaConnector.getAuthUrl(state);
    res.redirect(url);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// HTML escape that covers all attribute and body contexts.
function htmlEscape(s) {
  return String(s ?? '').replace(/[&<>"'/]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#47;' }[c]));
}

function oauthPopupHtml(status, message, provider = 'unknown') {
  const isSuccess = status === 'success';
  const bodyMessage = htmlEscape(message);
  // For the script context, encode the entire postMessage payload as JSON
  // and embed it inside a JSON-safe string. Avoids the prior approach which
  // built the object literal by string concatenation and was vulnerable to
  // breakout via quotes / </script> in the message.
  const payload = isSuccess
    ? { type: 'oauth_success', provider }
    : { type: 'oauth_error', error: String(message) };
  // Encode as JSON then escape </script> sequences which could otherwise
  // terminate the script tag mid-string.
  const safePayload = JSON.stringify(payload).replace(/</g, '\\u003c');
  const targetOrigin = (process.env.PLATFORM_URL || '').replace(/\/$/, '') || '*';
  const safeOrigin = JSON.stringify(targetOrigin);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:${isSuccess ? '#f0fdf4' : '#fff0f0'}">
  <div style="text-align:center;padding:40px">
    <div style="font-size:48px;margin-bottom:16px">${isSuccess ? '✓' : '✗'}</div>
    <h2 style="margin:0 0 8px;color:${isSuccess ? '#2e7d32' : '#c62828'}">${isSuccess ? 'Connected' : 'Error'}</h2>
    <p style="color:#666;margin:0 0 24px">${bodyMessage}</p>
    <button onclick="window.close()" style="background:#000;color:#fff;border:none;padding:10px 24px;border-radius:4px;cursor:pointer;font-size:14px">Close Window</button>
  </div>
  <script>
    try { window.opener.postMessage(${safePayload}, ${safeOrigin}); } catch(e){}
    setTimeout(function(){ window.close(); }, 800);
  </script>
</body></html>`;
}

module.exports = router;
