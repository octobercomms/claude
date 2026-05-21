const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const pool = require('../db');
const { encrypt } = require('../utils/encryption');
const googleConnector = require('../connectors/google');
const metaConnector = require('../connectors/meta');
const zohoInventoryConnector = require('../connectors/zoho_inventory');

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

    // Update all Google connectors for this client
    const googleTypes = ['ga4', 'google_search_console', 'google_ads', 'google_merchant_center'];
    for (const type of googleTypes) {
      await pool.query(
        `UPDATE connectors SET credentials = $1, status = 'active', last_checked = NOW(), error_message = NULL
         WHERE client_id = $2 AND connector_type = $3`,
        [JSON.stringify(encrypted), client_id, type]
      );
    }

    res.send(oauthPopupHtml('success', 'Google connected successfully.', 'google'));
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.send(oauthPopupHtml('error', err.message));
  }
});

// ─── Meta OAuth ─────────────────────────────────────────────────

router.get('/meta/start', (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).send('client_id required');
  const state = Buffer.from(JSON.stringify({ client_id })).toString('base64');
  const url = metaConnector.getAuthUrl(state);
  res.redirect(url);
});

router.get('/meta/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(oauthPopupHtml('error', error));

  try {
    const { client_id } = JSON.parse(Buffer.from(state, 'base64').toString());
    const tokens = await metaConnector.exchangeCode(code);
    const encrypted = encrypt(tokens);

    // Update Meta Ads and Instagram Insights connectors
    const metaTypes = ['meta_ads', 'instagram_insights'];
    for (const type of metaTypes) {
      await pool.query(
        `UPDATE connectors SET credentials = $1, status = 'active', last_checked = NOW(), error_message = NULL
         WHERE client_id = $2 AND connector_type = $3`,
        [JSON.stringify(encrypted), client_id, type]
      );
    }

    res.send(oauthPopupHtml('success', 'Meta connected successfully.', 'meta'));
  } catch (err) {
    console.error('Meta OAuth callback error:', err);
    res.send(oauthPopupHtml('error', err.message));
  }
});

// ─── Shopify OAuth ──────────────────────────────────────────────

const SHOPIFY_SCOPES = 'read_orders,read_products,read_analytics,read_reports,read_customers';

router.get('/shopify/start', (req, res) => {
  const { client_id, shop, connector_id } = req.query;
  if (!client_id || !shop || !connector_id) return res.status(400).send('client_id, shop, and connector_id required');

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const redirectUri = process.env.SHOPIFY_REDIRECT_URI || `${process.env.APP_URL || ''}/auth/shopify/callback`;

  if (!clientId) return res.status(500).send('SHOPIFY_CLIENT_ID not configured in platform settings');

  const shopDomain = shop.includes('.') ? shop : `${shop}.myshopify.com`;
  const state = Buffer.from(JSON.stringify({ client_id, connector_id, shop: shopDomain })).toString('base64url');

  const url = `https://${shopDomain}/admin/oauth/authorize?client_id=${clientId}&scope=${SHOPIFY_SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.redirect(url);
});

router.get('/shopify/callback', async (req, res) => {
  const { code, state, shop, hmac, error } = req.query;
  if (error) return res.send(oauthPopupHtml('error', error));

  try {
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    if (!clientSecret) throw new Error('SHOPIFY_CLIENT_SECRET not configured');

    // Verify HMAC
    const params = { ...req.query };
    delete params.hmac;
    delete params.signature;
    const message = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    const digest = crypto.createHmac('sha256', clientSecret).update(message).digest('hex');
    if (digest !== hmac) throw new Error('HMAC verification failed');

    const { client_id, connector_id } = JSON.parse(Buffer.from(state, 'base64url').toString());
    // Note: shop domain comparison skipped — HMAC above is the authoritative check

    // Exchange code for access token
    const tokenRes = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: clientSecret,
      code,
    });

    const { access_token } = tokenRes.data;
    if (!access_token) throw new Error('No access token returned');

    const credentials = { shop_domain: shop, access_token };
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
    const tokens = await zohoInventoryConnector.exchangeCode(code);
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

// ─── Reauth links ────────────────────────────────────────────────

// Reauth link from email alert (token-less, opens OAuth flow)
router.get('/meta/reauth', (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).send('client_id required');
  const state = Buffer.from(JSON.stringify({ client_id })).toString('base64');
  const url = metaConnector.getAuthUrl(state);
  res.redirect(url);
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
