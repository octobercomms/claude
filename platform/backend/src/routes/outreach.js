const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const hunter = require('../services/hunter');
const serper = require('../services/serper');
const icypeas = require('../services/icypeas');
const outreachAi = require('../services/outreachAi');
const outreachSender = require('../services/outreachSender');

// Public — open-tracking pixel, loaded directly by recipients' email clients.
const TRACK_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
router.get('/track/open/:sendId', async (req, res) => {
  try {
    await pool.query('UPDATE outreach_sends SET opened_at = NOW() WHERE id = $1 AND opened_at IS NULL', [req.params.sendId]);
  } catch { /* always return the pixel */ }
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store');
  res.send(TRACK_PIXEL);
});

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
         (SELECT COUNT(*) FROM outreach_campaign_contacts cc WHERE cc.campaign_id = c.id) AS contact_count,
         (SELECT COUNT(*) FROM outreach_sends s WHERE s.campaign_id = c.id AND s.status = 'sent') AS sent_count,
         (SELECT COUNT(*) FROM outreach_sends s WHERE s.campaign_id = c.id AND s.opened_at IS NOT NULL) AS opened_count
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

// ── Contact finding ────────────────────────────────────────────────────────

router.post('/find/hunter', async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });
  try {
    const result = await hunter.domainSearch(domain.trim());
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/find/serper', async (req, res) => {
  const { industry, location, specialisation } = req.body;
  try {
    const domains = await serper.findBusinessDomains({ industry, location, specialisation });
    res.json({ domains });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/find/icypeas', async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });
  try {
    const result = await icypeas.domainSearch(domain.trim());
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Email sequences ────────────────────────────────────────────────────────

router.get('/campaigns/:id/sequences', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM outreach_sequences WHERE campaign_id = $1 ORDER BY step_number',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/campaigns/:id/generate', async (req, res) => {
  try {
    const { rows: camps } = await pool.query('SELECT * FROM outreach_campaigns WHERE id = $1', [req.params.id]);
    if (!camps.length) return res.status(404).json({ error: 'Campaign not found' });
    const steps = await outreachAi.writeSequence(camps[0], req.body.instructions || '');
    await pool.query('DELETE FROM outreach_sequences WHERE campaign_id = $1', [req.params.id]);
    const saved = [];
    for (const s of steps) {
      const { rows } = await pool.query(
        `INSERT INTO outreach_sequences (campaign_id, step_number, subject, body, delay_days)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.params.id, s.step_number, s.subject, s.body, s.delay_days]
      );
      saved.push(rows[0]);
    }
    res.json(saved);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.put('/sequences/:id', async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM outreach_sequences WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: 'Sequence step not found' });
    const c = cur[0];
    const b = req.body;
    const { rows } = await pool.query(
      'UPDATE outreach_sequences SET subject = $1, body = $2, delay_days = $3 WHERE id = $4 RETURNING *',
      [b.subject ?? c.subject, b.body ?? c.body, b.delay_days ?? c.delay_days, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sending config ─────────────────────────────────────────────────────────

router.get('/sending/:clientId', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT outreach_sending FROM clients WHERE id = $1', [req.params.clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    res.json(rows[0].outreach_sending || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/sending/:clientId', async (req, res) => {
  const { from_name, from_email, reply_to } = req.body;
  try {
    const config = { from_name: from_name || null, from_email: from_email || null, reply_to: reply_to || null };
    await pool.query('UPDATE clients SET outreach_sending = $1 WHERE id = $2', [JSON.stringify(config), req.params.clientId]);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Campaign launch & control ──────────────────────────────────────────────

router.post('/campaigns/:id/launch', async (req, res) => {
  try {
    const { rows: camps } = await pool.query('SELECT * FROM outreach_campaigns WHERE id = $1', [req.params.id]);
    if (!camps.length) return res.status(404).json({ error: 'Campaign not found' });
    const campaign = camps[0];

    const { rows: steps } = await pool.query(
      'SELECT * FROM outreach_sequences WHERE campaign_id = $1 ORDER BY step_number', [req.params.id]
    );
    if (!steps.length) return res.status(400).json({ error: 'Generate an email sequence before launching.' });

    const { rows: contacts } = await pool.query(
      "SELECT * FROM outreach_contacts WHERE client_id = $1 AND email IS NOT NULL AND email <> ''",
      [campaign.client_id]
    );
    if (!contacts.length) return res.status(400).json({ error: 'No contacts with an email address to send to.' });

    const now = Date.now();
    let enrolled = 0;
    for (const contact of contacts) {
      const { rows: existing } = await pool.query(
        'SELECT 1 FROM outreach_campaign_contacts WHERE campaign_id = $1 AND contact_id = $2',
        [req.params.id, contact.id]
      );
      if (existing.length) continue;
      await pool.query(
        'INSERT INTO outreach_campaign_contacts (campaign_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.params.id, contact.id]
      );
      for (const step of steps) {
        const scheduledAt = new Date(now + (step.delay_days || 0) * 86400000);
        await pool.query(
          `INSERT INTO outreach_sends (campaign_id, contact_id, sequence_id, status, scheduled_at)
           VALUES ($1, $2, $3, 'pending', $4)`,
          [req.params.id, contact.id, step.id, scheduledAt]
        );
      }
      enrolled++;
    }
    await pool.query("UPDATE outreach_campaigns SET status = 'active', launched_at = NOW() WHERE id = $1", [req.params.id]);
    res.json({ enrolled, steps: steps.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/campaigns/:id/pause', async (req, res) => {
  try {
    await pool.query("UPDATE outreach_campaigns SET status = 'paused' WHERE id = $1", [req.params.id]);
    res.json({ status: 'paused' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/campaigns/:id/resume', async (req, res) => {
  try {
    await pool.query("UPDATE outreach_campaigns SET status = 'active' WHERE id = $1", [req.params.id]);
    res.json({ status: 'active' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/campaigns/:id/test', async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'A test recipient email is required.' });
  try {
    const { rows: camps } = await pool.query(
      `SELECT cam.*, cl.outreach_sending FROM outreach_campaigns cam
       JOIN clients cl ON cl.id = cam.client_id WHERE cam.id = $1`, [req.params.id]
    );
    if (!camps.length) return res.status(404).json({ error: 'Campaign not found' });
    const { rows: steps } = await pool.query(
      'SELECT * FROM outreach_sequences WHERE campaign_id = $1 ORDER BY step_number LIMIT 1', [req.params.id]
    );
    if (!steps.length) return res.status(400).json({ error: 'Generate an email sequence first.' });
    await outreachSender.sendTest(camps[0], steps[0], camps[0].outreach_sending, to.trim());
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
