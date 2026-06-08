// Platform-side ingest for the October MI Shopify app.
//
// The public Shopify app verifies Shopify's own webhook HMAC on the incoming
// side, then forwards a normalised envelope here. Both endpoints are
// authenticated by a shared-secret HMAC (OMI_FORWARD_SECRET) over the raw body
// — independent of Shopify's HMAC. No platform session auth. Contract:
// docs/october-mi-shopify/API.md.

const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { encrypt, decrypt } = require('../utils/encryption');

const router = express.Router();

// Topics that map to commerce data we aggregate for reporting.
const ORDER_TOPICS = new Set(['ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDERS_FULFILLED', 'REFUNDS_CREATE']);
const CANCEL_TOPICS = new Set(['ORDERS_CANCELLED']);
const GDPR_TOPICS = new Set(['CUSTOMERS_DATA_REQUEST', 'CUSTOMERS_REDACT', 'SHOP_REDACT']);

// Verify the shared-secret HMAC over the raw body. The app signs with
// OMI_FORWARD_SECRET; we recompute and compare in constant time.
function verifyForwardSignature(req, res, next) {
  const secret = process.env.OMI_FORWARD_SECRET;
  if (!secret) {
    console.error('[shopify-app] OMI_FORWARD_SECRET not configured');
    return res.status(503).json({ message: 'Integration not configured.' });
  }
  const signature = req.get('X-OMI-Signature');
  if (!signature) return res.status(401).json({ message: 'Missing signature.' });
  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), 'utf8');
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  let ok = false;
  try {
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    ok = false;
  }
  if (!ok) return res.status(401).json({ message: 'Invalid signature.' });
  next();
}

// Resolve the client_id paired to a shop domain (active shopify_app connector).
async function clientForShop(shopDomain) {
  if (!shopDomain) return null;
  const { rows } = await pool.query(
    `SELECT id, client_id, credentials FROM connectors WHERE connector_type = 'shopify_app' LIMIT 200`
  );
  for (const row of rows) {
    const creds = (row.credentials && decrypt(row.credentials)) || {};
    if (creds.shop_domain === shopDomain) return { connectorId: row.id, clientId: row.client_id };
  }
  return null;
}

// ─── INSTALL / PAIRING ───────────────────────────────────────────────────────
router.post('/install', verifyForwardSignature, async (req, res) => {
  try {
    const { shop_domain, access_token, pairing_token } = req.body || {};
    if (!shop_domain || !pairing_token) {
      return res.status(422).json({ ok: false, message: 'Missing shop domain or pairing token.' });
    }

    const { rows } = await pool.query(
      `SELECT t.client_id, t.used_at, t.expires_at, c.name AS client_name
         FROM pairing_tokens t
         JOIN clients c ON c.id = t.client_id
        WHERE t.token = $1 AND t.surface = 'shopify'`,
      [pairing_token]
    );
    if (!rows.length || rows[0].used_at || (rows[0].expires_at && new Date(rows[0].expires_at) < new Date())) {
      return res.status(422).json({ ok: false, message: 'Unknown or expired pairing token.' });
    }

    const clientId = rows[0].client_id;
    const creds = { shop_domain, access_token: access_token || null };

    // Upsert the shopify_app connector for this client + shop. store_label is
    // the shop domain so a client with multiple stores gets one row each.
    const existing = await pool.query(
      `SELECT id FROM connectors WHERE client_id = $1 AND connector_type = 'shopify_app' AND store_label = $2 LIMIT 1`,
      [clientId, shop_domain]
    );
    if (existing.rows.length) {
      await pool.query(
        `UPDATE connectors SET credentials = $1, status = 'active', error_message = NULL, last_checked = NOW(), updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(encrypt(creds)), existing.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO connectors (client_id, connector_type, credentials, status, store_label, last_checked)
         VALUES ($1, 'shopify_app', $2, 'active', $3, NOW())`,
        [clientId, JSON.stringify(encrypt(creds)), shop_domain]
      );
    }

    await pool.query(`UPDATE pairing_tokens SET used_at = NOW() WHERE token = $1`, [pairing_token]);
    return res.json({ ok: true, client_id: clientId, client_name: rows[0].client_name });
  } catch (err) {
    console.error('[shopify-app] install failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Install failed — please try again.' });
  }
});

// ─── WEBHOOK FORWARDER ───────────────────────────────────────────────────────
router.post('/webhook', verifyForwardSignature, async (req, res) => {
  try {
    const { shop_domain, topic, payload } = req.body || {};
    if (!shop_domain || !topic) return res.status(400).json({ message: 'Missing shop_domain or topic.' });

    // GDPR topics are handled specially and are audited even before pairing
    // lookup (shop/redact may arrive after the connector is gone).
    if (GDPR_TOPICS.has(topic)) {
      await handleGdpr(shop_domain, topic, payload || {});
      return res.json({ ok: true });
    }

    const pairing = await clientForShop(shop_domain);
    if (!pairing) {
      // Not paired (or uninstalled) — acknowledge so the app doesn't retry.
      return res.json({ ok: true, ignored: 'shop not paired' });
    }

    if (topic === 'APP_UNINSTALLED') {
      await pool.query(
        `UPDATE connectors SET status = 'disconnected', error_message = 'App uninstalled in Shopify', updated_at = NOW() WHERE id = $1`,
        [pairing.connectorId]
      );
      return res.json({ ok: true });
    }

    await pool.query(
      `INSERT INTO shopify_app_events (client_id, shop_domain, topic, payload) VALUES ($1, $2, $3, $4)`,
      [pairing.clientId, shop_domain, topic, JSON.stringify(payload || {})]
    );
    pool.query(
      `UPDATE connectors SET status = 'active', error_message = NULL, last_checked = NOW() WHERE id = $1`,
      [pairing.connectorId]
    ).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error('[shopify-app] webhook failed:', err.message);
    return res.status(500).json({ message: 'Failed to record event.' });
  }
});

// GDPR: audit every request, and act on the ones that delete data.
async function handleGdpr(shopDomain, topic, payload) {
  await pool.query(
    `INSERT INTO shopify_gdpr_requests (shop_domain, topic, payload) VALUES ($1, $2, $3)`,
    [shopDomain, topic, JSON.stringify(payload)]
  );
  if (topic === 'SHOP_REDACT') {
    // Purge the shop's stored events and disconnect its connector.
    const pairing = await clientForShop(shopDomain);
    await pool.query(`DELETE FROM shopify_app_events WHERE shop_domain = $1`, [shopDomain]);
    if (pairing) {
      await pool.query(
        `UPDATE connectors SET status = 'disconnected', credentials = '{}'::jsonb, error_message = 'Shop data redacted (GDPR)', updated_at = NOW() WHERE id = $1`,
        [pairing.connectorId]
      );
    }
  } else if (topic === 'CUSTOMERS_REDACT') {
    // Best-effort: drop stored order/customer events for the named customer.
    const customerId = payload?.customer?.id != null ? String(payload.customer.id) : null;
    if (customerId) {
      await pool.query(
        `DELETE FROM shopify_app_events
          WHERE shop_domain = $1
            AND (payload->'customer'->>'id' = $2 OR payload->>'customer_id' = $2)`,
        [shopDomain, customerId]
      );
    }
  }
  // CUSTOMERS_DATA_REQUEST: audited above; the platform is the system of record
  // and fulfils the request out of band.
  await pool.query(
    `UPDATE shopify_gdpr_requests SET handled_at = NOW() WHERE shop_domain = $1 AND topic = $2 AND handled_at IS NULL`,
    [shopDomain, topic]
  );
}

module.exports = router;
