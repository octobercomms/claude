/**
 * PR Gmail add-on API — externally authenticated (no platform session). The
 * Google Apps Script add-on calls these with an `X-OMI-Key` header matching the
 * key stored in Settings. Lets the team look up the sender's journalist profile,
 * log a thread to a client's editorial log, and capture an unknown sender as a
 * press or commercial contact — all from the Gmail sidebar.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const pr = require('../services/pr');
const { getSetting } = require('../utils/settings');

// Constant-time key check against the stored PR_ADDON_KEY.
async function requireAddonKey(req, res, next) {
  try {
    const provided = String(req.get('X-OMI-Key') || '');
    const stored = String((await getSetting('PR_ADDON_KEY')) || '');
    if (!stored) return res.status(503).json({ error: 'Add-on key not configured. Set one in Settings.' });
    const a = Buffer.from(provided);
    const b = Buffer.from(stored);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Invalid or missing API key.' });
    }
    next();
  } catch (err) { res.status(500).json({ error: err.message }); }
}
router.use(requireAddonKey);

const REAL_EMAIL = (e) => e && !/@import\.local$/i.test(e);

// Active clients, for the add-on's "log this thread" client picker.
async function activeClients() {
  const { rows } = await db.query("SELECT id, name FROM clients WHERE active = TRUE ORDER BY name ASC");
  return rows;
}

// Look up a journalist by email → profile + recent coverage, plus the client
// list so the add-on can populate its log-thread dropdown.
router.get('/lookup', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    const clients = await activeClients();
    if (!email) return res.json({ matched: false, clients });

    const c = (await db.query(
      `SELECT c.*, o.name AS outlet FROM outreach_contacts c
       LEFT JOIN pr_outlets o ON o.id = c.outlet_id
       WHERE lower(c.email) = $1 LIMIT 1`, [email]
    )).rows[0];
    if (!c) return res.json({ matched: false, email, clients });

    const agg = (await db.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('published','download')) AS published,
              MAX(CASE WHEN status IN ('published','download') THEN COALESCE(issue_date, request_date) END) AS last_featured
       FROM pr_editorial_log WHERE contact_id = $1`, [c.id]
    )).rows[0];
    const recent = (await db.query(
      `SELECT l.story_title, l.status, COALESCE(l.issue_date, l.request_date) AS date, cl.name AS client
       FROM pr_editorial_log l LEFT JOIN clients cl ON cl.id = l.client_id
       WHERE l.contact_id = $1 AND l.status NOT IN ('new','dismissed')
       ORDER BY COALESCE(l.issue_date, l.request_date) DESC NULLS LAST, l.created_at DESC LIMIT 5`, [c.id]
    )).rows;

    const ts = agg.last_featured ? new Date(agg.last_featured).getTime() : null;
    const str = pr.relationshipStrength(+agg.published || 0, ts);
    res.json({
      matched: true,
      clients,
      id: c.id,
      name: (`${c.first_name || ''} ${c.last_name || ''}`.trim()) || c.name || '',
      segment: c.kind === 'industry' ? 'commercial' : c.kind, // add-on speaks media/commercial
      outlet: c.outlet || '',
      beats: Array.isArray(c.beats) ? c.beats : [],
      availability: c.availability_status,
      photo_url: c.photo_url || '',
      published: +agg.published || 0,
      last_featured: agg.last_featured,
      strength: str.score,
      strength_label: str.label,
      recent: recent.map((r) => ({ client: r.client || '', title: r.story_title || '', status: pr.statusLabel(r.status), date: r.date })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Capture an unknown sender as a press (media) or commercial contact.
router.post('/contacts', async (req, res) => {
  try {
    const b = req.body || {};
    const segment = b.segment === 'media' ? 'media' : 'commercial';
    const kind = segment === 'media' ? 'media' : 'industry'; // unified contacts kind
    const email = String(b.email || '').trim().toLowerCase();
    const name = String(b.name || '').trim();
    const sp = name.split(/\s+/);
    const first = sp[0] || '';
    const last = sp.slice(1).join(' ');

    // Existing contact by real email → return it (idempotent).
    if (REAL_EMAIL(email)) {
      const found = (await db.query('SELECT id, kind FROM outreach_contacts WHERE lower(email) = $1 LIMIT 1', [email])).rows[0];
      if (found) return res.json({ id: found.id, segment: found.kind === 'industry' ? 'commercial' : found.kind, matched: true });
    }

    const outletId = segment === 'media' && b.publication ? await pr.resolveOutlet(b.publication) : null;
    const tags = String(b.tags || '').split(/[\s,;]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    const finalEmail = REAL_EMAIL(email) ? email : `noemail+${crypto.createHash('md5').update(name.toLowerCase() || String(Date.now())).digest('hex')}@import.local`;

    const { rows } = await db.query(
      `INSERT INTO outreach_contacts (first_name, last_name, name, email, outlet_id, kind, beats, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [first, last, name, finalEmail, outletId, kind, JSON.stringify(kind === 'media' ? tags : []),
       kind === 'industry' && tags.length ? `Tags: ${tags.join(', ')}` : '']
    );
    res.status(201).json({ id: rows[0].id, segment, created: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Log a Gmail thread to a client's editorial log.
router.post('/editorial-log', async (req, res) => {
  try {
    const b = req.body || {};
    const clientId = String(b.client_id || '').trim();
    if (!clientId) return res.status(400).json({ error: 'client_id required' });
    const client = (await db.query('SELECT id FROM clients WHERE id = $1', [clientId])).rows[0];
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const STATUSES = Object.keys(pr.STATUS_LABELS);
    const status = STATUSES.includes(b.status) ? b.status : 'pitched';
    const outletId = b.publication ? await pr.resolveOutlet(b.publication) : null;

    // Resolve the contact by email first, then by name.
    let contactId = null;
    const email = String(b.email || '').trim().toLowerCase();
    if (REAL_EMAIL(email)) {
      const found = (await db.query('SELECT id FROM outreach_contacts WHERE lower(email) = $1 LIMIT 1', [email])).rows[0];
      if (found) contactId = found.id;
    }
    if (!contactId && b.press_contact) contactId = await pr.resolveContact(b.press_contact, outletId);

    const { rows } = await db.query(
      `INSERT INTO pr_editorial_log (client_id, story_title, contact_id, outlet_id, status, story_url, notes_outcome, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'gmail') RETURNING id`,
      [clientId, b.story_title || '', contactId, outletId, status, b.story_url || '', b.notes_outcome || 'Logged from Gmail']
    );
    res.status(201).json({ id: rows[0].id, created: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
