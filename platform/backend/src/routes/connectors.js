const express = require('express');
const axios = require('axios');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/encryption');
const connectorFactory = require('../connectors');

const router = express.Router();
router.use(authenticate);

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
    const { rows } = await pool.query(`
      SELECT c.id, c.client_id, cl.name as client_name, c.connector_type, c.store_label,
             c.status, c.last_checked, c.error_message
      FROM connectors c
      JOIN clients cl ON cl.id = c.client_id
      WHERE cl.active = true
      ORDER BY cl.name, c.connector_type
    `);
    res.json(rows);
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
    console.error('listAccounts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Save config (selected account/property) for a connector
router.put('/:id/config', async (req, res) => {
  try {
    await pool.query(
      'UPDATE connectors SET config = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(req.body), req.params.id]
    );
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

// Diagnose a Google connector — shows token owner, scopes, and a live GA4 test
router.get('/:id/diagnose', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM connectors WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Connector not found' });
    const row = rows[0];
    const creds = decrypt(row.credentials);
    if (!creds) return res.status(400).json({ error: 'No credentials stored' });

    const result = { connector_type: row.connector_type, config: row.config };

    // Check token validity and get account info
    try {
      const tokenInfoRes = await axios.get(
        `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${creds.access_token}`
      );
      result.token_info = {
        email: tokenInfoRes.data.email,
        scopes: tokenInfoRes.data.scope,
        expires_in: tokenInfoRes.data.exp ? `${Math.round((tokenInfoRes.data.exp * 1000 - Date.now()) / 60000)}m` : 'unknown',
      };
    } catch (tokenErr) {
      result.token_info = { error: tokenErr.response?.data || tokenErr.message };
      // Attempt token refresh and retry
      try {
        const googleConnector = require('../connectors/google');
        const refreshed = await googleConnector.refreshToken(creds);
        const retryRes = await axios.get(
          `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${refreshed.access_token}`
        );
        result.token_info = {
          email: retryRes.data.email,
          scopes: retryRes.data.scope,
          expires_in: retryRes.data.exp ? `${Math.round((retryRes.data.exp * 1000 - Date.now()) / 60000)}m` : 'unknown',
          note: 'Token was expired and has been refreshed',
        };
        // Persist the refreshed credentials
        const { encrypt } = require('../utils/encryption');
        await pool.query('UPDATE connectors SET credentials = $1 WHERE id = $2', [
          JSON.stringify(encrypt(refreshed)), row.id,
        ]);
      } catch {
        result.token_info.note = 'Token is expired — re-authorise this connector';
      }
    }

    // For GA4 connectors, test the Data API directly
    if (row.connector_type === 'ga4') {
      const propertyId = row.config?.value;
      result.property_id = propertyId || '(not set)';
      if (propertyId) {
        try {
          const testRes = await axios.post(
            `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
            {
              dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
              metrics: [{ name: 'sessions' }],
            },
            { headers: { Authorization: `Bearer ${creds.access_token}` } }
          );
          result.ga4_test = { status: 'ok', row_count: testRes.data.rowCount };
        } catch (ga4Err) {
          result.ga4_test = {
            status: 'error',
            http_status: ga4Err.response?.status,
            error: ga4Err.response?.data?.error || ga4Err.message,
          };
        }
      }
    }

    res.json(result);
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
