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

const router = express.Router();

// ─── Google OAuth ───────────────────────────────────────────────

router.get('/google/start', (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).send('client_id required');
  const state = Buffer.from(JSON.stringify({ client_id })).toString('base64');
  const url = googleConnector.getAuthUrl(state);
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(oauthPopupHtml('error', error));

  try {
    const { client_id } = JSON.parse(Buffer.from(state, 'base64').toString());
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
    console.error('Google OAuth callback error:', err);
    res.send(oauthPopupHtml('error', err.message));
  }
});

// ─── Meta OAuth ─────────────────────────────────────────────────

router.get('/meta/start', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).send('client_id required');
  const state = Buffer.from(JSON.stringify({ client_id })).toString('base64');
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
    const { client_id } = JSON.parse(Buffer.from(state, 'base64').toString());
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
    console.error('Meta OAuth callback error:', err);
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
  const state = Buffer.from(JSON.stringify({ client_id, connector_id, shop: shopDomain })).toString('base64url');

  const url = `https://${shopDomain}/admin/oauth/authorize?client_id=${shopifyClientId}&scope=${SHOPIFY_SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.redirect(url);
});

router.get('/shopify/callback', async (req, res) => {
  const { code, state, shop, hmac, error } = req.query;
  if (error) return res.send(oauthPopupHtml('error', error));

  try {
    const { client_id, connector_id } = JSON.parse(Buffer.from(state, 'base64url').toString());

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
  const state = Buffer.from(JSON.stringify({ client_id })).toString('base64');
  const url = zohoInventoryConnector.getAuthUrl(state);
  res.redirect(url);
});

router.get('/zoho/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(oauthPopupHtml('error', error));

  try {
    const { client_id } = JSON.parse(Buffer.from(state, 'base64').toString());
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
    console.error('Zoho OAuth callback error:', err);
    res.send(oauthPopupHtml('error', err.message));
  }
});

// ─── Amazon SP-API OAuth ─────────────────────────────────────────

router.get('/amazon/start', (req, res) => {
  const { client_id, connector_id } = req.query;
  if (!client_id) return res.status(400).send('client_id required');
  if (!process.env.AMAZON_CLIENT_ID) return res.status(400).send('AMAZON_CLIENT_ID not configured in Settings');
  const state = Buffer.from(JSON.stringify({ client_id, connector_id })).toString('base64');
  const url = amazonConnector.getAuthUrl(state);
  res.redirect(url);
});

router.get('/amazon/callback', async (req, res) => {
  const { spapi_oauth_code, selling_partner_id, state, error } = req.query;
  if (error) return res.send(oauthPopupHtml('error', error));
  if (!spapi_oauth_code) return res.send(oauthPopupHtml('error', 'No OAuth code received from Amazon'));
  try {
    const { client_id, connector_id } = JSON.parse(Buffer.from(state, 'base64').toString());
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
    console.error('Amazon OAuth callback error:', err);
    res.send(oauthPopupHtml('error', err.message));
  }
});

// ─── Reauth links ────────────────────────────────────────────────

// Reauth link from email alert (token-less, opens OAuth flow)
router.get('/meta/reauth', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).send('client_id required');
  const state = Buffer.from(JSON.stringify({ client_id })).toString('base64');
  try {
    const url = await metaConnector.getAuthUrl(state);
    res.redirect(url);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

function oauthPopupHtml(status, message, provider = 'unknown') {
  const isSuccess = status === 'success';
  const safeMessage = String(message).replace(/'/g, "\\'").replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:${isSuccess ? '#f0fdf4' : '#fff0f0'}">
  <div style="text-align:center;padding:40px">
    <div style="font-size:48px;margin-bottom:16px">${isSuccess ? '✓' : '✗'}</div>
    <h2 style="margin:0 0 8px;color:${isSuccess ? '#2e7d32' : '#c62828'}">${isSuccess ? 'Connected' : 'Error'}</h2>
    <p style="color:#666;margin:0 0 24px">${safeMessage}</p>
    <button onclick="window.close()" style="background:#000;color:#fff;border:none;padding:10px 24px;border-radius:4px;cursor:pointer;font-size:14px">Close Window</button>
  </div>
  <script>
    try { window.opener.postMessage({type:'${isSuccess ? 'oauth_success' : 'oauth_error'}',${isSuccess ? `provider:'${provider}'` : `error:'${safeMessage}'`}},'*'); } catch(e){}
    setTimeout(function(){ window.close(); }, 800);
  </script>
</body></html>`;
}

module.exports = router;
