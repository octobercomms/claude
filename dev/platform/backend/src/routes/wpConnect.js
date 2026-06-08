// Platform-side ingest for the October MI WordPress plugin.
//
// The plugin pushes signed events to these routes (server-initiated egress is
// never WAF-challenged, which is the whole point). This router is mounted
// WITHOUT the platform's session auth — every request authenticates with an
// HMAC-SHA256 signature over the raw body, keyed by the per-site refresh
// secret issued at pairing. The contract is docs/october-mi-wp/API.md.

const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { encrypt, decrypt } = require('../utils/encryption');
const { withDbRetry } = require('../utils/dbRetry');

const router = express.Router();

// Reject replays: timestamps must be within ±5 minutes of now.
const TS_WINDOW_SECONDS = 5 * 60;

// ─── PAIRING ───────────────────────────────────────────────────────────────
// The one unsigned call. Exchanges a one-time pairing token for the client_id
// and a refresh_secret, and activates the wordpress_plugin connector.
router.post('/pair', async (req, res) => {
  try {
    const { token, site_url, site_name } = req.body || {};
    if (!token) return res.status(400).json({ message: 'Missing pairing token.' });

    const { rows } = await pool.query(
      `SELECT t.client_id, t.used_at, t.expires_at, c.name AS client_name
         FROM wp_pairing_tokens t
         JOIN clients c ON c.id = t.client_id
        WHERE t.token = $1`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ message: 'Unknown pairing token. Generate a new one in the dashboard.' });

    const row = rows[0];
    if (row.used_at) return res.status(409).json({ message: 'This pairing token has already been used.' });
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ message: 'This pairing token has expired — generate a new one.' });
    }

    const clientId = row.client_id;
    const refreshSecret = crypto.randomBytes(32).toString('hex');
    const creds = {
      client_id: clientId,
      refresh_secret: refreshSecret,
      site_url: site_url || null,
      site_name: site_name || null,
    };

    // Upsert the single wordpress_plugin connector for this client.
    const existing = await pool.query(
      `SELECT id FROM connectors WHERE client_id = $1 AND connector_type = 'wordpress_plugin' LIMIT 1`,
      [clientId]
    );
    if (existing.rows.length) {
      await pool.query(
        `UPDATE connectors SET credentials = $1, status = 'active', error_message = NULL, last_checked = NOW(), updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(encrypt(creds)), existing.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO connectors (client_id, connector_type, credentials, status, store_label, last_checked)
         VALUES ($1, 'wordpress_plugin', $2, 'active', $3, NOW())`,
        [clientId, JSON.stringify(encrypt(creds)), site_name || null]
      );
    }

    // Burn the token.
    await pool.query(`UPDATE wp_pairing_tokens SET used_at = NOW() WHERE token = $1`, [token]);

    return res.json({ client_id: clientId, refresh_secret: refreshSecret, client_name: row.client_name });
  } catch (err) {
    console.error('[wp-connect] pair failed:', err.message);
    return res.status(500).json({ message: 'Pairing failed — please try again.' });
  }
});

// ─── SIGNATURE VERIFICATION ──────────────────────────────────────────────────
async function verifySignature(req, res, next) {
  try {
    const clientId = req.get('X-OMI-Client');
    const signature = req.get('X-Signature');
    const timestamp = req.get('X-Timestamp');
    if (!clientId || !signature || !timestamp) {
      return res.status(401).json({ message: 'Missing signature headers.' });
    }

    const skew = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));
    if (!Number.isFinite(skew) || skew > TS_WINDOW_SECONDS) {
      return res.status(401).json({ message: 'Timestamp outside the acceptable window.' });
    }

    const { rows } = await pool.query(
      `SELECT id, credentials FROM connectors WHERE client_id = $1 AND connector_type = 'wordpress_plugin' LIMIT 1`,
      [clientId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Site not paired.' });

    const creds = (rows[0].credentials && decrypt(rows[0].credentials)) || {};
    if (!creds.refresh_secret) return res.status(403).json({ message: 'Site not paired.' });

    // HMAC must be computed over the exact raw body bytes the plugin signed.
    const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), 'utf8');
    const expected = crypto.createHmac('sha256', creds.refresh_secret).update(raw).digest('hex');

    let ok = false;
    try {
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      ok = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
      ok = false;
    }
    if (!ok) return res.status(401).json({ message: 'Invalid signature.' });

    req.omiClientId = clientId;
    req.omiConnectorId = rows[0].id;
    next();
  } catch (err) {
    console.error('[wp-connect] signature check failed:', err.message);
    return res.status(500).json({ message: 'Signature verification failed.' });
  }
}

// ─── EVENT INGEST ────────────────────────────────────────────────────────────
// Store the raw event; the wordpress_plugin connector aggregates on read. The
// plugin sends non-blocking and only logs failures, so a simple 2xx/5xx is all
// it consumes.
function ingest(fallbackType) {
  return async (req, res) => {
    try {
      const body = req.body || {};
      const eventType = body.event || fallbackType;
      // The raw event is the durable record — retry past a momentary DB blip
      // so we don't drop a webhook the plugin won't re-send.
      await withDbRetry(() => pool.query(
        `INSERT INTO wp_connect_events (client_id, event_type, payload) VALUES ($1, $2, $3)`,
        [req.omiClientId, eventType, JSON.stringify(body)]
      ));
      // A live event means the connector is healthy — clear any stale error.
      pool.query(
        `UPDATE connectors SET status = 'active', error_message = NULL, last_checked = NOW() WHERE id = $1`,
        [req.omiConnectorId]
      ).catch(() => {});
      return res.json({ ok: true });
    } catch (err) {
      console.error('[wp-connect] ingest failed:', err.message);
      return res.status(500).json({ message: 'Failed to record event.' });
    }
  };
}

router.post('/orders', verifySignature, ingest('order'));
router.post('/customers', verifySignature, ingest('customer'));
router.post('/products', verifySignature, ingest('product'));
router.post('/inventory', verifySignature, ingest('inventory'));
router.post('/content', verifySignature, ingest('content'));
router.post('/seo', verifySignature, ingest('seo'));
router.post('/form-submission', verifySignature, ingest('form.submitted'));

module.exports = router;
