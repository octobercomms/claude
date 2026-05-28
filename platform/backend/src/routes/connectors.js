const express = require('express');
const axios = require('axios');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, checkClientIdFromBodyOrQuery } = require('../middleware/clientAccess');
const { encrypt, decrypt } = require('../utils/encryption');
const connectorFactory = require('../connectors');
const users = require('../services/users');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(checkClientIdFromBodyOrQuery);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// :id can be a connector UUID — verify the caller can see its client.
router.param('id', async (req, res, next, id) => {
  try {
    const { rows } = await pool.query('SELECT client_id FROM connectors WHERE id = $1', [id]);
    if (rows.length && !users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised for this client' });
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Known provider limits for connectors without programmatic scope introspection.
const KNOWN_LIMITATIONS = {
  google_search_console: ['Search Console retains roughly 16 months of history — older periods return no data.'],
  amazon_seller: ['SP-API access depends on the Selling Partner Insights role being approved in Amazon Seller Central. A 403 means the role or marketplace is not authorised.'],
  klaviyo: ['Klaviyo API keys can be scoped — a restricted key may block campaign reporting. Per-campaign revenue needs a "Placed Order" conversion metric configured in Klaviyo.'],
  brevo: ['Brevo v3 API keys have full account access — there are no per-scope restrictions.'],
  zoho_inventory: ['Zoho access depends on the OAuth scopes on the token — ZohoInventory.items.READ and ZohoInventory.salesorders.READ are required.'],
  cin7: ['Cin7 access is controlled by the API account permissions configured in Cin7.'],
  dataforseo: ['DataForSEO uses account-level API access — there are no scopes; usage is limited by account credits.'],
};

// Get connectors for a client
router.get('/client/:clientId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, client_id, connector_type, store_label, status, last_checked, error_message, config, created_at FROM connectors WHERE client_id = $1 ORDER BY connector_type, store_label',
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all connectors with status summary
router.get('/status', async (req, res) => {
  try {
    // Filter by the caller's visible clients — admins see everything,
    // viewers see only their assigned clients.
    let result;
    if (req.visibleClientIds === null) {
      result = await pool.query(`
        SELECT c.id, c.client_id, cl.name as client_name, c.connector_type, c.store_label,
               c.status, c.last_checked, c.error_message
        FROM connectors c
        JOIN clients cl ON cl.id = c.client_id
        WHERE cl.active = true
        ORDER BY cl.name, c.connector_type
      `);
    } else if (!req.visibleClientIds.length) {
      result = { rows: [] };
    } else {
      result = await pool.query(`
        SELECT c.id, c.client_id, cl.name as client_name, c.connector_type, c.store_label,
               c.status, c.last_checked, c.error_message
        FROM connectors c
        JOIN clients cl ON cl.id = c.client_id
        WHERE cl.active = true AND c.client_id = ANY($1)
        ORDER BY cl.name, c.connector_type
      `, [req.visibleClientIds]);
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save credentials for a connector (API key type)
router.put('/:id/credentials', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM connectors WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Connector not found' });

    const encrypted = encrypt(req.body.credentials);
    await pool.query(
      'UPDATE connectors SET credentials = $1, status = $2 WHERE id = $3',
      [JSON.stringify(encrypted), 'active', req.params.id]
    );

    // Verify connection
    try {
      const connector = connectorFactory.get(rows[0].connector_type);
      const creds = decrypt(encrypted);
      await connector.checkTokenValidity(creds);
      await pool.query(
        'UPDATE connectors SET status = $1, last_checked = NOW(), error_message = NULL WHERE id = $2',
        ['active', req.params.id]
      );
    } catch (checkErr) {
      await pool.query(
        'UPDATE connectors SET status = $1, error_message = $2 WHERE id = $3',
        ['error', checkErr.message, req.params.id]
      );
    }

    const updated = await pool.query(
      'SELECT id, client_id, connector_type, store_label, status, last_checked, error_message FROM connectors WHERE id = $1',
      [req.params.id]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List available accounts for an OAuth connector
router.get('/:id/accounts', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM connectors WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Connector not found' });
    const row = rows[0];
    if (!row.credentials || row.credentials === '{}') return res.json([]);
    const creds = decrypt(row.credentials);
    const connector = connectorFactory.get(row.connector_type);
    if (!connector.listAccounts) return res.json([]);
    const accounts = await connector.listAccounts(creds, row.connector_type);
    res.json(accounts);
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.response?.data?.error || err.message;
    const status = err.response?.status;
    console.error('listAccounts error:', status, detail);
    res.status(200).json({ fetchError: `${status ? `(${status}) ` : ''}${typeof detail === 'string' ? detail : JSON.stringify(detail)}` });
  }
});

// Save config (selected account/property) for a connector
router.put('/:id/config', async (req, res) => {
  try {
    const body = req.body;
    if (body.label !== undefined) {
      await pool.query(
        'UPDATE connectors SET config = $1, store_label = $2, updated_at = NOW() WHERE id = $3',
        [JSON.stringify(body), body.label || null, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE connectors SET config = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(body), req.params.id]
      );
    }
    const { rows } = await pool.query(
      'SELECT id, client_id, connector_type, store_label, status, last_checked, error_message, config FROM connectors WHERE id = $1',
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check connector validity
router.post('/:id/check', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM connectors WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Connector not found' });
    const row = rows[0];

    const connector = connectorFactory.get(row.connector_type);
    const creds = decrypt(row.credentials);

    let status = 'active';
    let errorMsg = null;
    try {
      await connector.checkTokenValidity(creds);
    } catch (err) {
      status = 'error';
      errorMsg = err.message;
    }

    await pool.query(
      'UPDATE connectors SET status = $1, last_checked = NOW(), error_message = $2 WHERE id = $3',
      [status, errorMsg, req.params.id]
    );

    res.json({ status, error_message: errorMsg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new connector for a client
router.post('/client/:clientId', async (req, res) => {
  const { connector_type, store_label } = req.body;
  if (!connector_type) return res.status(400).json({ error: 'connector_type required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO connectors (client_id, connector_type, store_label) VALUES ($1, $2, $3) RETURNING id, client_id, connector_type, store_label, status, config',
      [req.params.clientId, connector_type, store_label || null]
    );
    const newConn = { ...rows[0] };

    // Auto-copy OAuth credentials from an existing active connector of the same type
    const { rows: existing } = await pool.query(
      `SELECT credentials FROM connectors WHERE client_id = $1 AND connector_type = $2 AND status = 'active' AND id != $3 LIMIT 1`,
      [req.params.clientId, connector_type, newConn.id]
    );
    if (existing.length && existing[0].credentials && Object.keys(existing[0].credentials).length > 0) {
      await pool.query(
        `UPDATE connectors SET credentials = $1, status = 'active' WHERE id = $2`,
        [JSON.stringify(existing[0].credentials), newConn.id]
      );
      newConn.status = 'active';
    }

    res.status(201).json(newConn);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Diagnose any connector — credential check, config summary, live API test
router.get('/:id/diagnose', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM connectors WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Connector not found' });
    const row = rows[0];

    const result = {
      connector_type: row.connector_type,
      store_label: row.store_label || null,
      status: row.status,
      last_checked: row.last_checked,
      config: row.config || null,
    };

    // Check if credentials are stored at all
    const creds = decrypt(row.credentials);
    if (!creds || Object.keys(creds).length === 0) {
      result.credentials = 'none stored';
      return res.json(result);
    }

    // Report which credential fields are present (not values)
    result.credentials = Object.keys(creds).join(', ');

    const GOOGLE_TYPES = ['ga4', 'google_search_console', 'google_ads', 'google_merchant_center'];
    const isGoogle = GOOGLE_TYPES.includes(row.connector_type);

    if (isGoogle) {
      // Google: check OAuth token info
      let tokenOk = false;
      try {
        const tokenInfoRes = await axios.get(
          `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${creds.access_token}`
        );
        result.token_info = {
          email: tokenInfoRes.data.email,
          scopes: tokenInfoRes.data.scope,
          expires_in: tokenInfoRes.data.exp ? `${Math.round((tokenInfoRes.data.exp * 1000 - Date.now()) / 60000)}m` : 'unknown',
        };
        tokenOk = true;
      } catch (tokenErr) {
        result.token_info = { error: tokenErr.response?.data || tokenErr.message };
        try {
          const googleConnector = require('../connectors/google');
          const refreshed = await googleConnector.refreshToken(creds);
          const retryRes = await axios.get(
            `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${refreshed.access_token}`
          );
          // Refresh succeeded — Google rotates access tokens every 60 minutes,
          // this is the normal path. No note: nothing for the AM to action.
          result.token_info = {
            email: retryRes.data.email,
            scopes: retryRes.data.scope,
            expires_in: retryRes.data.exp ? `${Math.round((retryRes.data.exp * 1000 - Date.now()) / 60000)}m` : 'unknown',
          };
          const { encrypt } = require('../utils/encryption');
          await pool.query('UPDATE connectors SET credentials = $1 WHERE id = $2', [
            JSON.stringify(encrypt(refreshed)), row.id,
          ]);
          tokenOk = true;
        } catch {
          result.token_info.note = 'Token is expired and refresh failed — re-authorise this connector.';
          result.token_info.note_kind = 'error';
        }
      }

      // Clear stale status/error_message rows when the diagnostic confirms
      // the connector is now healthy. Without this, a transient failure from
      // a previous fetch leaves the badge stuck on "error" forever, even
      // though the next diagnose run shows everything fine.
      if (tokenOk) {
        await pool.query(
          'UPDATE connectors SET status = $1, last_checked = NOW(), error_message = NULL WHERE id = $2',
          ['active', row.id]
        );
        result.status = 'active';
      }

      if (row.connector_type === 'ga4') {
        const propertyId = row.config?.value;
        result.property_id = propertyId || '(not set)';
        if (propertyId) {
          try {
            const testRes = await axios.post(
              `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
              { dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }], metrics: [{ name: 'sessions' }] },
              { headers: { Authorization: `Bearer ${creds.access_token}` } }
            );
            result.live_test = { status: 'ok', detail: `${testRes.data.rowCount} rows returned` };
          } catch (ga4Err) {
            result.live_test = { status: 'error', http_status: ga4Err.response?.status, error: ga4Err.response?.data?.error || ga4Err.message };
          }
        }
      }
    } else {
      // Non-Google: call checkTokenValidity and report result
      try {
        const connector = connectorFactory.get(row.connector_type);
        await connector.checkTokenValidity(creds);
        result.check = { status: 'ok', detail: 'Credentials are valid' };
        await pool.query('UPDATE connectors SET status = $1, last_checked = NOW(), error_message = NULL WHERE id = $2', ['active', row.id]);
      } catch (checkErr) {
        result.check = { status: 'error', detail: checkErr.message };
        await pool.query('UPDATE connectors SET status = $1, error_message = $2 WHERE id = $3', ['error', checkErr.message, row.id]);
      }
    }

    // Access report — which scopes/permissions this connector actually holds,
    // and the known limits of what it cannot see.
    const connectorModule = connectorFactory.get(row.connector_type);
    if (typeof connectorModule.getAccessReport === 'function') {
      try {
        result.access = await connectorModule.getAccessReport(creds);
      } catch (accessErr) {
        const detail = accessErr.response?.data?.error?.message || accessErr.response?.data?.errors || accessErr.message;
        result.access = { error: typeof detail === 'string' ? detail : JSON.stringify(detail) };
      }
    } else if (KNOWN_LIMITATIONS[row.connector_type]) {
      result.access = { limitations: KNOWN_LIMITATIONS[row.connector_type] };
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch live ads data for the Ads Performance page
router.get('/client/:clientId/ads-data', async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90);
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd - days * 86400000);
  const fmt = d => d.toISOString().split('T')[0];
  const startDate = fmt(periodStart);
  const endDate = fmt(periodEnd);

  async function fetchOne(row) {
    const creds = decrypt(row.credentials);
    const config = row.config || {};
    const connModule = connectorFactory.get(row.connector_type);
    const raw = await connModule.fetchData(creds, {
      ...config,
      connectorType: row.connector_type,
      customerId: config.value,
      adAccountId: config.value,
      startDate,
      endDate,
    });
    return raw;
  }

  try {
    // Try any connector that still has stored credentials — don't filter on
    // status='active'. A connector marked 'error' from a previous transient
    // failure (token expired between scheduled fetches, network blip) might
    // still work fine now, and skipping it makes Google Ads silently invisible
    // on the Paid page. Per-row errors are surfaced to the caller below.
    const [googleRows, metaRows] = await Promise.all([
      pool.query("SELECT * FROM connectors WHERE client_id = $1 AND connector_type = 'google_ads' AND status <> 'disconnected'", [req.params.clientId]),
      pool.query("SELECT * FROM connectors WHERE client_id = $1 AND connector_type = 'meta_ads' AND status <> 'disconnected'", [req.params.clientId]),
    ]);

    const mapRows = (rows) => Promise.all(rows.map(async row => {
      try {
        const raw = await fetchOne(row);
        // A successful fetch means the connector is healthy — clear any
        // stale error state so the badge in Setup → Connectors reflects
        // reality without the AM having to click Diagnose by hand.
        if (row.status !== 'active') {
          await pool.query(
            "UPDATE connectors SET status = 'active', error_message = NULL, last_checked = NOW() WHERE id = $1",
            [row.id]
          ).catch(() => {});
        }
        return { connector_id: row.id, store_label: row.store_label, data: raw };
      } catch (err) {
        return { connector_id: row.id, store_label: row.store_label, error: err.message };
      }
    }));

    const [googleResults, metaResults] = await Promise.all([
      mapRows(googleRows.rows),
      mapRows(metaRows.rows),
    ]);

    res.json({ google_ads: googleResults, meta_ads: metaResults, days, startDate, endDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete connector
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM connectors WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Store per-connector Shopify app credentials (API Key + Secret) without
// triggering a token check. Merges with existing credentials so a previously
// OAuth'd access_token is preserved if present.
router.put('/:id/shopify-app', async (req, res) => {
  try {
    const { shopify_client_id, shopify_client_secret } = req.body;
    if (!shopify_client_id || !shopify_client_secret) {
      return res.status(400).json({ error: 'shopify_client_id and shopify_client_secret required' });
    }
    const { rows } = await pool.query('SELECT credentials, connector_type FROM connectors WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Connector not found' });
    if (!['shopify', 'shopify_email'].includes(rows[0].connector_type)) {
      return res.status(400).json({ error: 'Not a Shopify connector' });
    }
    const existing = rows[0].credentials ? decrypt(rows[0].credentials) || {} : {};
    const merged = { ...existing, shopify_client_id, shopify_client_secret };
    await pool.query('UPDATE connectors SET credentials = $1 WHERE id = $2', [JSON.stringify(encrypt(merged)), req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset credentials — clears stored token and marks disconnected without deleting the connector row
router.post('/:id/reset', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE connectors SET credentials = '{}'::jsonb, status = 'disconnected', error_message = NULL, last_checked = NULL WHERE id = $1 RETURNING id, client_id, connector_type, store_label, status, config",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Connector not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
