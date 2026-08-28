// Selective Outreach ("Prospecting") — admin API. Agency-staff only (the
// read-only `client` role is blocked). The approval queue is the product:
// prospects and messages are proposed by AI, but a human approves every one and
// owns every send. See docs/platform/outreach/PLAN.md.
//
// Public opt-out lives in routes/prospectingOptout.js (no auth, token-gated).

const express = require('express');
const pool = require('../db');
const crypto = require('crypto');
const { authenticate, agencyOnly } = require('../middleware/auth');
const score = require('../services/prospecting/score');
const draft = require('../services/prospecting/draft');
const send = require('../services/prospecting/send');
const research = require('../services/prospecting/research');
const suppression = require('../services/prospecting/suppression');

const router = express.Router();
router.use(authenticate);
router.use(agencyOnly);

const actorOf = (req) => req.user?.username || 'staff';

async function audit(clientId, actor, action, entity, entityId, detail) {
  try {
    await pool.query(
      `INSERT INTO prospecting_audit (client_id, actor, action, entity, entity_id, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [clientId, actor, action, entity, entityId, detail ? JSON.stringify(detail) : null]
    );
  } catch (e) { console.warn('[prospecting] audit failed:', e.message); }
}

// Load a campaign + its client_id, or throw a 404-shaped error.
async function getCampaign(id) {
  const { rows } = await pool.query('SELECT * FROM prospecting_campaigns WHERE id = $1', [id]);
  if (!rows[0]) { const e = new Error('Campaign not found'); e.status = 404; throw e; }
  return rows[0];
}

// ── Campaigns ──────────────────────────────────────────────────────────────

router.get('/campaigns', async (req, res) => {
  const clientId = req.query.client_id || null;
  try {
    const { rows } = await pool.query(
      `SELECT c.*, i.from_name, i.from_email, i.auth_ok,
              (SELECT COUNT(*) FROM prospecting_prospects p WHERE p.campaign_id = c.id AND p.state = 'new') AS new_prospects,
              (SELECT COUNT(*) FROM prospecting_messages m JOIN prospecting_prospects p ON p.id = m.prospect_id
                 WHERE p.campaign_id = c.id AND m.state = 'pending') AS pending_messages
         FROM prospecting_campaigns c
         LEFT JOIN prospecting_identities i ON i.id = c.sender_identity_id
        ${clientId ? 'WHERE c.client_id = $1' : ''}
        ORDER BY c.created_at DESC`,
      clientId ? [clientId] : []
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns', async (req, res) => {
  const b = req.body || {};
  if (!b.client_id) return res.status(400).json({ error: 'client_id is required.' });
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'A campaign name is required.' });
  // Default two-step sequence — a first touch and one gentle follow-up.
  const sequence = Array.isArray(b.sequence) && b.sequence.length ? b.sequence : [
    { step: 1, wait_days: 0, angle: 'first touch — earn attention with the specific fact, offer a short call' },
    { step: 2, wait_days: 4, angle: 'gentle follow-up that adds one new reason, never nags' },
  ];
  try {
    const { rows } = await pool.query(
      `INSERT INTO prospecting_campaigns (client_id, name, status, icp, disqualifiers, sender_identity_id, booking_url, daily_cap, sequence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [b.client_id, b.name.trim(), b.status || 'draft', b.icp || null, b.disqualifiers || null,
       b.sender_identity_id || null, b.booking_url || null, b.daily_cap || 20, JSON.stringify(sequence)]
    );
    await audit(b.client_id, actorOf(req), 'create', 'campaign', rows[0].id, { name: rows[0].name });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/campaigns/:id', async (req, res) => {
  try {
    const c = await getCampaign(req.params.id);
    res.json(c);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.put('/campaigns/:id', async (req, res) => {
  const b = req.body || {};
  const fields = [];
  const params = [];
  const set = (col, val) => { params.push(val); fields.push(`${col} = $${params.length}`); };
  if (b.name !== undefined) set('name', b.name);
  if (b.status !== undefined) set('status', b.status);
  if (b.icp !== undefined) set('icp', b.icp);
  if (b.disqualifiers !== undefined) set('disqualifiers', b.disqualifiers);
  if (b.sender_identity_id !== undefined) set('sender_identity_id', b.sender_identity_id || null);
  if (b.booking_url !== undefined) set('booking_url', b.booking_url);
  if (b.daily_cap !== undefined) set('daily_cap', parseInt(b.daily_cap) || 20);
  if (b.sequence !== undefined) set('sequence', JSON.stringify(b.sequence));
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });
  params.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE prospecting_campaigns SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Campaign not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/campaigns/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM prospecting_campaigns WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sending identities ─────────────────────────────────────────────────────

router.get('/identities', async (req, res) => {
  const clientId = req.query.client_id || null;
  try {
    const { rows } = await pool.query(
      `SELECT id, client_id, from_name, from_email, postal_address, auth_ok, warmed, created_at,
              (smtp_json IS NOT NULL) AS has_smtp
         FROM prospecting_identities ${clientId ? 'WHERE client_id = $1' : ''} ORDER BY created_at DESC`,
      clientId ? [clientId] : []
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/identities', async (req, res) => {
  const b = req.body || {};
  if (!b.client_id) return res.status(400).json({ error: 'client_id is required.' });
  if (!b.from_name || !b.from_email) return res.status(400).json({ error: 'A real sender name and email are required.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.from_email)) return res.status(400).json({ error: 'That sender email looks invalid.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO prospecting_identities (client_id, from_name, from_email, postal_address, smtp_json, auth_ok, warmed)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, client_id, from_name, from_email, postal_address, auth_ok, warmed`,
      [b.client_id, b.from_name.trim(), b.from_email.trim().toLowerCase(), b.postal_address || null,
       b.smtp_json ? JSON.stringify(b.smtp_json) : null, !!b.auth_ok, !!b.warmed]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/identities/:id', async (req, res) => {
  const b = req.body || {};
  const fields = []; const params = [];
  const set = (col, val) => { params.push(val); fields.push(`${col} = $${params.length}`); };
  if (b.from_name !== undefined) set('from_name', b.from_name);
  if (b.from_email !== undefined) set('from_email', String(b.from_email).toLowerCase());
  if (b.postal_address !== undefined) set('postal_address', b.postal_address);
  if (b.smtp_json !== undefined) set('smtp_json', b.smtp_json ? JSON.stringify(b.smtp_json) : null);
  if (b.auth_ok !== undefined) set('auth_ok', !!b.auth_ok);
  if (b.warmed !== undefined) set('warmed', !!b.warmed);
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });
  params.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE prospecting_identities SET ${fields.join(', ')} WHERE id = $${params.length}
       RETURNING id, client_id, from_name, from_email, postal_address, auth_ok, warmed`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Identity not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/identities/:id', async (req, res) => {
  try { await pool.query('DELETE FROM prospecting_identities WHERE id = $1', [req.params.id]); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Prospects ──────────────────────────────────────────────────────────────

router.get('/campaigns/:id/prospects', async (req, res) => {
  const state = req.query.state; // new|approved|dismissed|sequenced|replied|opted_out|booked
  const params = [req.params.id];
  let clause = 'WHERE campaign_id = $1';
  if (state && state !== 'all') { params.push(state); clause += ` AND state = $${params.length}`; }
  try {
    const { rows } = await pool.query(
      `SELECT * FROM prospecting_prospects ${clause}
       ORDER BY (fit_verdict = 'fit') DESC NULLS LAST, fit_score DESC NULLS LAST, created_at DESC`,
      params
    );
    // Counts by state for the tab badges.
    const { rows: counts } = await pool.query(
      `SELECT state, COUNT(*)::int AS n FROM prospecting_prospects WHERE campaign_id = $1 GROUP BY state`,
      [req.params.id]
    );
    res.json({ prospects: rows, counts: Object.fromEntries(counts.map(c => [c.state, c.n])) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns/:id/prospects', async (req, res) => {
  const b = req.body || {};
  if (!b.company && !b.email) return res.status(400).json({ error: 'A company or an email is required.' });
  try {
    const campaign = await getCampaign(req.params.id);
    const { rows } = await pool.query(
      `INSERT INTO prospecting_prospects (campaign_id, company, contact_name, email, role, website, source, one_fact)
       VALUES ($1,$2,$3,$4,$5,$6,'manual',$7) RETURNING *`,
      [req.params.id, b.company || null, b.contact_name || null, (b.email || '').toLowerCase() || null,
       b.role || null, b.website || null, b.one_fact || null]
    );
    // Fit-score it straight away so it lands with a verdict.
    try {
      const s = await score.scoreProspect(rows[0], campaign, { clientId: campaign.client_id });
      await pool.query(
        `UPDATE prospecting_prospects SET fit_score=$1, fit_verdict=$2, fit_reasoning=$3, one_fact=COALESCE(one_fact,$4) WHERE id=$5`,
        [s.score, s.verdict, s.reasoning, s.one_fact, rows[0].id]
      );
    } catch (e) { console.warn('[prospecting] score on add failed:', e.message); }
    const { rows: fresh } = await pool.query('SELECT * FROM prospecting_prospects WHERE id = $1', [rows[0].id]);
    res.json(fresh[0]);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// CSV / paste import — one prospect per line: company,contact_name,email,role,website
// A header row is detected and skipped. Everything comes in as source = csv.
router.post('/campaigns/:id/prospects/import', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Paste some rows to import.' });
  try {
    await getCampaign(req.params.id);
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let imported = 0, skipped = 0;
    for (const line of lines) {
      const cols = line.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
      const [company, contact_name, email, role, website] = cols;
      if (/^(company|name|email)$/i.test(company || '')) { skipped++; continue; } // header
      if (!company && !email) { skipped++; continue; }
      await pool.query(
        `INSERT INTO prospecting_prospects (campaign_id, company, contact_name, email, role, website, source)
         VALUES ($1,$2,$3,$4,$5,$6,'csv')`,
        [req.params.id, company || null, contact_name || null, (email || '').toLowerCase() || null, role || null, website || null]
      );
      imported++;
    }
    res.json({ ok: true, imported, skipped });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Auto-source: run the AI research pass and drop candidates into the queue.
router.post('/campaigns/:id/source', async (req, res) => {
  try {
    const out = await research.sourceCampaign(req.params.id, {
      maxResults: Math.min(parseInt(req.body?.max) || 15, 30),
      log: (m) => console.log('[prospecting]', m),
    });
    res.json(out);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Score all not-yet-scored prospects in a campaign (bulk fit-gate).
router.post('/campaigns/:id/score-unscored', async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id);
    const { rows } = await pool.query(
      `SELECT * FROM prospecting_prospects WHERE campaign_id = $1 AND fit_verdict IS NULL AND state = 'new' LIMIT 40`,
      [req.params.id]
    );
    let scored = 0;
    for (const p of rows) {
      try {
        const s = await score.scoreProspect(p, campaign, { clientId: campaign.client_id });
        await pool.query(
          `UPDATE prospecting_prospects SET fit_score=$1, fit_verdict=$2, fit_reasoning=$3, one_fact=COALESCE(one_fact,$4) WHERE id=$5`,
          [s.score, s.verdict, s.reasoning, s.one_fact, p.id]
        );
        scored++;
      } catch (e) { console.warn('[prospecting] score failed:', e.message); }
    }
    const { rows: rem } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM prospecting_prospects WHERE campaign_id = $1 AND fit_verdict IS NULL AND state = 'new'`,
      [req.params.id]
    );
    res.json({ scored, remaining: rem[0].n });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Re-score one prospect.
router.post('/prospects/:id/score', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM prospecting_prospects WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Prospect not found' });
    const campaign = await getCampaign(rows[0].campaign_id);
    const s = await score.scoreProspect(rows[0], campaign, { clientId: campaign.client_id });
    const { rows: upd } = await pool.query(
      `UPDATE prospecting_prospects SET fit_score=$1, fit_verdict=$2, fit_reasoning=$3, one_fact=COALESCE($4,one_fact) WHERE id=$5 RETURNING *`,
      [s.score, s.verdict, s.reasoning, s.one_fact, req.params.id]
    );
    res.json(upd[0]);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Approve a prospect → draft step 1 of the sequence into the queue as a pending
// message for review. Nothing sends; the message still needs approval.
router.post('/prospects/:id/approve', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM prospecting_prospects WHERE id = $1', [req.params.id]);
    const prospect = rows[0];
    if (!prospect) return res.status(404).json({ error: 'Prospect not found' });
    if (!prospect.email) return res.status(400).json({ error: 'This prospect has no email address to send to. Add one first.' });
    const campaign = await getCampaign(prospect.campaign_id);
    if (await suppression.isSuppressed(campaign.client_id, prospect.email)) {
      return res.status(400).json({ error: 'That address is on the suppression list — it cannot be contacted.' });
    }
    let identity = null;
    if (campaign.sender_identity_id) {
      const { rows: ir } = await pool.query('SELECT * FROM prospecting_identities WHERE id = $1', [campaign.sender_identity_id]);
      identity = ir[0] || null;
    }
    const d = await draft.draftOutbound({ prospect, campaign, identity, step: 1 });
    const { rows: msg } = await pool.query(
      `INSERT INTO prospecting_messages (prospect_id, direction, step, subject, body, state, content_hash)
       VALUES ($1,'out',1,$2,$3,'pending',$4) RETURNING *`,
      [prospect.id, d.subject, d.body, crypto.createHash('sha1').update(`${d.subject}\n${d.body}`).digest('hex')]
    );
    await pool.query(`UPDATE prospecting_prospects SET state='approved', updated_at=NOW() WHERE id=$1`, [prospect.id]);
    await audit(campaign.client_id, actorOf(req), 'approve', 'prospect', prospect.id, {});
    res.json({ ok: true, prospect_id: prospect.id, message: msg[0] });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/prospects/:id/dismiss', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE prospecting_prospects SET state='dismissed', dismiss_reason=$2, updated_at=NOW() WHERE id=$1 RETURNING campaign_id`,
      [req.params.id, (req.body?.reason || '').slice(0, 300) || null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Prospect not found' });
    const c = await getCampaign(rows[0].campaign_id);
    await audit(c.client_id, actorOf(req), 'dismiss', 'prospect', req.params.id, { reason: req.body?.reason || null });
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Thread for a prospect (all messages, both directions) for the workspace view.
router.get('/prospects/:id/messages', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM prospecting_messages WHERE prospect_id = $1 ORDER BY created_at', [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Log an inbound reply (Phase 3 manual path — paste what they wrote). We record
// it, mark the prospect 'replied', and AI-draft a response into the queue for
// approval. No auto-send: the reply-draft is just another pending message.
router.post('/prospects/:id/reply', async (req, res) => {
  const incoming = String(req.body?.body || '').trim();
  if (!incoming) return res.status(400).json({ error: 'Paste the reply text.' });
  try {
    const { rows } = await pool.query('SELECT * FROM prospecting_prospects WHERE id = $1', [req.params.id]);
    const prospect = rows[0];
    if (!prospect) return res.status(404).json({ error: 'Prospect not found' });
    const campaign = await getCampaign(prospect.campaign_id);
    // Store the inbound message.
    await pool.query(
      `INSERT INTO prospecting_messages (prospect_id, direction, subject, body, state)
       VALUES ($1,'in',$2,$3,'received')`,
      [prospect.id, req.body?.subject || null, incoming]
    );
    await pool.query(`UPDATE prospecting_prospects SET state='replied', updated_at=NOW() WHERE id=$1`, [prospect.id]);
    // Cancel any still-queued follow-ups — the person replied, the sequence stops.
    await pool.query(
      `UPDATE prospecting_messages SET state='skipped' WHERE prospect_id=$1 AND direction='out' AND state IN ('pending','approved')`,
      [prospect.id]
    );
    // Draft a response into the queue.
    let identity = null;
    if (campaign.sender_identity_id) {
      const { rows: ir } = await pool.query('SELECT * FROM prospecting_identities WHERE id = $1', [campaign.sender_identity_id]);
      identity = ir[0] || null;
    }
    const { rows: thread } = await pool.query(
      `SELECT direction, body FROM prospecting_messages WHERE prospect_id=$1 AND state IN ('sent','received') ORDER BY created_at`,
      [prospect.id]
    );
    const d = await draft.draftReply({ prospect, campaign, identity, thread, incoming });
    const { rows: msg } = await pool.query(
      `INSERT INTO prospecting_messages (prospect_id, direction, subject, body, state, content_hash)
       VALUES ($1,'out',$2,$3,'pending',$4) RETURNING *`,
      [prospect.id, d.subject, d.body, crypto.createHash('sha1').update(`${d.subject}\n${d.body}`).digest('hex')]
    );
    await audit(campaign.client_id, actorOf(req), 'reply_logged', 'prospect', prospect.id, {});
    res.json({ ok: true, draft: msg[0] });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ── Messages (the approval queue) ──────────────────────────────────────────

router.get('/campaigns/:id/messages', async (req, res) => {
  const state = req.query.state || 'pending';
  const params = [req.params.id];
  let clause = 'WHERE p.campaign_id = $1';
  if (state !== 'all') { params.push(state); clause += ` AND m.state = $${params.length}`; }
  try {
    const { rows } = await pool.query(
      `SELECT m.*, p.company, p.contact_name, p.email, p.role, p.website, p.fit_score, p.fit_verdict,
              p.fit_reasoning, p.one_fact, p.source, p.source_url
         FROM prospecting_messages m
         JOIN prospecting_prospects p ON p.id = m.prospect_id
        ${clause}
        ORDER BY m.scheduled_at NULLS FIRST, m.created_at`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Edit a pending draft (subject/body) before approval — the human keeps control.
router.put('/messages/:id', async (req, res) => {
  const b = req.body || {};
  const fields = []; const params = [];
  const set = (c, v) => { params.push(v); fields.push(`${c} = $${params.length}`); };
  if (b.subject !== undefined) set('subject', b.subject);
  if (b.body !== undefined) set('body', b.body);
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });
  if (b.subject !== undefined || b.body !== undefined) {
    set('content_hash', crypto.createHash('sha1').update(`${b.subject || ''}\n${b.body || ''}`).digest('hex'));
  }
  params.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE prospecting_messages SET ${fields.join(', ')} WHERE id = $${params.length} AND state = 'pending' RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(400).json({ error: 'Only a pending draft can be edited.' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Approve a message → schedule it for the next dispatch tick (respects the cap).
router.post('/messages/:id/approve', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE prospecting_messages SET state='approved', approved_by=$2, scheduled_at=COALESCE(scheduled_at, NOW())
        WHERE id=$1 AND state='pending' RETURNING *`,
      [req.params.id, actorOf(req)]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Only a pending draft can be approved.' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Approve AND send immediately (bypasses the wait for the cron tick; still runs
// every compliance gate inside send.sendMessage).
router.post('/messages/:id/send', async (req, res) => {
  try {
    await pool.query(
      `UPDATE prospecting_messages SET state='approved', approved_by=$2, scheduled_at=COALESCE(scheduled_at, NOW())
        WHERE id=$1 AND state='pending'`,
      [req.params.id, actorOf(req)]
    );
    const out = await send.sendMessage(req.params.id, { actor: actorOf(req), ignoreCap: true });
    if (out.skipped) return res.status(400).json({ error: `Not sent: ${out.reason}` });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/messages/:id/skip', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE prospecting_messages SET state='skipped' WHERE id=$1 AND state IN ('pending','approved') RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Only a pending or approved message can be skipped.' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Dispatch due approved messages now (manual trigger; the cron does this too).
router.post('/dispatch', async (_req, res) => {
  try { res.json(await send.dispatchDue({ log: (m) => console.log('[prospecting]', m) })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Suppression ────────────────────────────────────────────────────────────

router.get('/suppression', async (req, res) => {
  if (!req.query.client_id) return res.status(400).json({ error: 'client_id required' });
  try { res.json(await suppression.list(req.query.client_id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/suppression', async (req, res) => {
  const b = req.body || {};
  if (!b.client_id || !b.value) return res.status(400).json({ error: 'client_id and value are required.' });
  try {
    await suppression.add(b.client_id, b.value, { kind: b.kind, reason: b.reason || 'manual' });
    await audit(b.client_id, actorOf(req), 'suppress', 'suppression', null, { value: b.value });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/suppression/:id', async (req, res) => {
  if (!req.query.client_id) return res.status(400).json({ error: 'client_id required' });
  try { await suppression.remove(req.query.client_id, req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Audit ──────────────────────────────────────────────────────────────────

router.get('/audit', async (req, res) => {
  if (!req.query.client_id) return res.status(400).json({ error: 'client_id required' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM prospecting_audit WHERE client_id = $1 ORDER BY created_at DESC LIMIT 200',
      [req.query.client_id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
