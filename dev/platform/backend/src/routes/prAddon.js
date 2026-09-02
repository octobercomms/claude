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
const Anthropic = require('@anthropic-ai/sdk');
const costLog = require('../services/costLog');

const EXTRACT_MODEL = 'claude-haiku-4-5-20251001';

// Pull publication, issue date and the actual story being discussed out of a
// journalist's email so the Gmail add-on logs a row that's actually useful —
// not just the email subject (often "Re: …") and a blank everything else.
//
// The add-on already knows who sent the email and the thread subject; here we
// read the body and try to spot the magazine the piece is for, the issue/date
// the AM should expect to see it land, and the project being covered (which is
// almost always more specific than the subject line). Anything we're not
// confident about, we leave null and let the AM fill in via the Edit modal.
async function extractFromEmail({ subject, body, senderName, senderEmail }) {
  if (!body || !process.env.CLAUDE_API_KEY) return null;
  const sdk = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const today = new Date().toISOString().slice(0, 10);
  const system = `You read PR/journalist emails and extract structured coverage metadata.
Today is ${today}. Always return ONLY a single JSON object — no prose, no markdown fence.
Fields:
  publication  — the magazine/outlet the piece is for (e.g. "Homes & Gardens"). null if not clearly named.
  issue_date   — best-guess publication date as YYYY-MM-DD. If the email only mentions a month/issue ("September's issue"), pick the 1st of that month in the most plausible year (use today's date to choose). null if no date is implied.
  story_title  — the actual project / subject of the piece (e.g. "House of Blue Lias"), NOT the email subject line. null if unclear.
  country      — country name in English ("UK", "USA", "Australia") if implied by the outlet or sender. null if unsure.
Only emit a value when you're reasonably confident. When in doubt, return null for that field.`;
  const userMsg = `Sender: ${senderName || ''} <${senderEmail || ''}>
Subject: ${subject || ''}

Body:
${String(body).slice(0, 8000)}`;
  try {
    const message = await sdk.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: userMsg }],
    });
    costLog.recordClaudeCost({ model: EXTRACT_MODEL, response: message, feature: 'gmail_addon_extract' });
    const text = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < 0) return null;
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    // Normalise: trim strings, drop empties, validate the date.
    const out = {};
    if (parsed.publication && String(parsed.publication).trim()) out.publication = String(parsed.publication).trim();
    if (parsed.story_title && String(parsed.story_title).trim()) out.story_title = String(parsed.story_title).trim();
    if (parsed.country && String(parsed.country).trim()) out.country = String(parsed.country).trim();
    if (parsed.issue_date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.issue_date)) out.issue_date = parsed.issue_date;
    return out;
  } catch (err) {
    // Never block a manual log on a Claude hiccup — silently fall back to the
    // raw subject/sender insert.
    console.warn('[pr-addon] extractFromEmail failed:', err.message);
    return null;
  }
}

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

// Capture an unknown sender from the Gmail add-on. This is a PR tool, so
// everyone it captures joins the shared press list (kind='media'). A
// 'commercial' pick is preserved as a tag — not the 'industry' kind, which
// is now a client's private business contact, not press.
router.post('/contacts', async (req, res) => {
  try {
    const b = req.body || {};
    const kind = 'media'; // add-on always captures into the press list
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

    const outletId = b.publication ? await pr.resolveOutlet(b.publication) : null;
    const tags = String(b.tags || '').split(/[\s,;]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    // Keep the commercial/press distinction as a tag so nothing's lost.
    if (b.segment !== 'media' && !tags.includes('commercial')) tags.push('commercial');
    const finalEmail = REAL_EMAIL(email) ? email : `noemail+${crypto.createHash('md5').update(name.toLowerCase() || String(Date.now())).digest('hex')}@import.local`;

    const { rows } = await db.query(
      `INSERT INTO outreach_contacts (first_name, last_name, name, email, outlet_id, kind, beats, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [first, last, name, finalEmail, outletId, kind, JSON.stringify(tags), '']
    );
    res.status(201).json({ id: rows[0].id, segment: 'media', created: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Log a Gmail thread to a client's editorial log.
//
// When the add-on includes `email_body`, Claude reads the thread to fill in
// publication, issue date and the actual story being discussed — so the row
// lands with usable context instead of just the email subject. Add-on-supplied
// fields always win over extracted ones, so an explicit override stays intact.
router.post('/editorial-log', async (req, res) => {
  try {
    const b = req.body || {};
    const clientId = String(b.client_id || '').trim();
    if (!clientId) return res.status(400).json({ error: 'client_id required' });
    const client = (await db.query('SELECT id FROM clients WHERE id = $1', [clientId])).rows[0];
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const STATUSES = Object.keys(pr.STATUS_LABELS);
    const status = STATUSES.includes(b.status) ? b.status : 'pitched';

    const extracted = await extractFromEmail({
      subject: b.email_subject || b.story_title || '',
      body: b.email_body || '',
      senderName: b.press_contact || '',
      senderEmail: b.email || '',
    }) || {};

    const publication = b.publication || extracted.publication || '';
    const storyTitle = b.story_title_override || extracted.story_title || b.story_title || '';
    const country = b.country || extracted.country || '';
    const issueDate = b.issue_date || extracted.issue_date || null;

    const outletId = publication ? await pr.resolveOutlet(publication) : null;

    // Resolve the contact by email first, then by name.
    let contactId = null;
    const email = String(b.email || '').trim().toLowerCase();
    if (REAL_EMAIL(email)) {
      const found = (await db.query('SELECT id FROM outreach_contacts WHERE lower(email) = $1 LIMIT 1', [email])).rows[0];
      if (found) contactId = found.id;
    }
    if (!contactId && b.press_contact) contactId = await pr.resolveContact(b.press_contact, outletId);

    const { rows } = await db.query(
      `INSERT INTO pr_editorial_log
         (client_id, story_title, contact_id, outlet_id, country, status, issue_date, story_url, notes_outcome, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'gmail') RETURNING id`,
      [clientId, storyTitle, contactId, outletId, country, status, issueDate, b.story_url || '', b.notes_outcome || 'Logged from Gmail']
    );
    res.status(201).json({
      id: rows[0].id,
      created: true,
      extracted: Object.keys(extracted).length ? extracted : null,
    });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
