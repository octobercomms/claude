const express = require('express');
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
      'SELECT id, client_id, connector_type, store_label, status, last_checked, error_message, created_at FROM connectors WHERE client_id = $1 ORDER BY connector_type, store_label',
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
      'INSERT INTO connectors (client_id, connector_type, store_label) VALUES ($1, $2, $3) RETURNING id, client_id, connector_type, store_label, status',
      [req.params.clientId, connector_type, store_label || null]
    );
    res.status(201).json(rows[0]);
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

module.exports = router;
