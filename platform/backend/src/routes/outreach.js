const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ── Contacts ───────────────────────────────────────────────────────────────

router.get('/contacts', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM outreach_contacts WHERE client_id = $1 ORDER BY created_at DESC',
      [client_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/contacts', async (req, res) => {
  const { client_id, name, email, company, role, website, status, notes } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO outreach_contacts (client_id, name, email, company, role, website, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [client_id, name || null, email || null, company || null, role || null,
       website || null, status || 'new', notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/contacts/bulk', async (req, res) => {
  const { client_id, contacts } = req.body;
  if (!client_id || !Array.isArray(contacts)) {
    return res.status(400).json({ error: 'client_id and contacts array required' });
  }
  try {
    const inserted = [];
    for (const c of contacts) {
      if (!c.email && !c.name) continue;
      const { rows } = await pool.query(
        `INSERT INTO outreach_contacts (client_id, name, email, company, role, website)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [client_id, c.name || null, c.email || null, c.company || null, c.role || null, c.website || null]
      );
      inserted.push(rows[0]);
    }
    res.json({ inserted: inserted.length, contacts: inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/contacts/:id', async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM outreach_contacts WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: 'Contact not found' });
    const c = cur[0];
    const b = req.body;
    const { rows } = await pool.query(
      `UPDATE outreach_contacts SET
         name = $1, email = $2, company = $3, role = $4, website = $5,
         status = $6, notes = $7, updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [b.name ?? c.name, b.email ?? c.email, b.company ?? c.company, b.role ?? c.role,
       b.website ?? c.website, b.status ?? c.status, b.notes ?? c.notes, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/contacts/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM outreach_contacts WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Campaigns ──────────────────────────────────────────────────────────────

router.get('/campaigns', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  try {
    const { rows } = await pool.query(
      `SELECT c.*,
         (SELECT COUNT(*) FROM outreach_campaign_contacts cc WHERE cc.campaign_id = c.id) AS contact_count
       FROM outreach_campaigns c
       WHERE c.client_id = $1
       ORDER BY c.created_at DESC`,
      [client_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/campaigns', async (req, res) => {
  const { client_id, name, audience_description } = req.body;
  if (!client_id || !name) return res.status(400).json({ error: 'client_id and name required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO outreach_campaigns (client_id, name, audience_description)
       VALUES ($1, $2, $3) RETURNING *`,
      [client_id, name, audience_description || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/campaigns/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM outreach_campaigns WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
