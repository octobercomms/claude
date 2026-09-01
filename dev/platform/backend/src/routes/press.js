// Press-release outreach routes. Mounted under /api/press. Re-uses
// outreach_contacts + outreach_campaigns + outreach_sends so the
// journalist sends and follow-ups appear in the existing sending
// machinery (inbox replies, unsubscribe handling, dashboard counts).

const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, assertClientAccess } = require('../middleware/clientAccess');
const pressRelease = require('../services/pressRelease');
const outreachSender = require('../services/outreachSender');
const users = require('../services/users');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// Press release UUIDs resolve to a client; refuse cross-tenant access.
router.param('id', async (req, res, next, id) => {
  try {
    if (req.path.startsWith('/releases/')) {
      const { rows } = await pool.query('SELECT client_id FROM outreach_press_releases WHERE id = $1', [id]);
      if (rows.length && !users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
        return res.status(403).json({ error: 'Not authorised for this client' });
      }
    }
    next();
  } catch (err) { next(err); }
});

// Fetch a downloadfor.press URL (or any public press page) and return
// the parsed shape. Doesn't persist — the AM previews first, then
// clicks Save to write a row.
router.post('/parse', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const parsed = await pressRelease.fetchAndParse(url);
    res.json(parsed);
  } catch (err) {
    console.error('[press] parse failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Create both a press_release row AND its backing campaign in one shot.
// The campaign is what the AM sees in the Campaigns tab; the
// press_release row holds the parsed content. Status defaults to
// 'draft' so the release appears in the list but isn't sent yet.
router.post('/clients/:clientId/releases', async (req, res) => {
  const { source_url, title, dateline, body_html, images, contact_block, boilerplate, embargo_at, fetched_at } = req.body || {};
  if (!title || !body_html) return res.status(400).json({ error: 'title and body_html required' });
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const { rows: campaignRows } = await dbClient.query(
      `INSERT INTO outreach_campaigns (client_id, name, kind, status, audience_description)
       VALUES ($1, $2, 'press_release', 'draft', $3) RETURNING *`,
      [req.params.clientId, `Press: ${title}`.slice(0, 250), 'Press release distribution']
    );
    const campaign = campaignRows[0];

    const { rows } = await dbClient.query(
      `INSERT INTO outreach_press_releases
         (client_id, title, body, summary, source_url, dateline, body_html, images, contact_block, boilerplate, embargo_at, fetched_at, campaign_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        req.params.clientId, title,
        body_html.replace(/<[^>]+>/g, ' '),
        (body_html.replace(/<[^>]+>/g, ' ').slice(0, 280)),
        source_url || null, dateline || null, body_html,
        JSON.stringify(images || []),
        contact_block || null, boilerplate || null,
        embargo_at || null, fetched_at || new Date().toISOString(),
        campaign.id,
      ]
    );

    // Standard four-step sequence (release + 3 follow-ups). Sequence
    // body uses sentinels — the sender substitutes Claude's cached
    // pitch / follow-up at send time, keyed by recipient.
    const offsets = [0, 5, 10, 16];
    for (let i = 0; i < offsets.length; i++) {
      await dbClient.query(
        `INSERT INTO outreach_sequences (campaign_id, step_number, subject, body, delay_days)
         VALUES ($1, $2, $3, $4, $5)`,
        [campaign.id, i + 1,
         i === 0 ? title : `Follow-up ${i}: ${title}`.slice(0, 250),
         i === 0 ? '__press_release__' : `__press_followup_${i}__`,
         offsets[i]]
      );
    }
    await dbClient.query('COMMIT');
    res.status(201).json({ ...rows[0], campaign_id: campaign.id });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// Resolve a press release by its backing campaign id — used by the
// Campaigns tab when the AM clicks a press_release campaign.
router.get('/campaigns/:id/release', async (req, res) => {
  try {
    // Include the step-1 subject so the campaign detail UI can render it
    // in an editable input. Defaults to release.title at creation time.
    const { rows } = await pool.query(
      `SELECT pr.*, (
         SELECT subject FROM outreach_sequences
          WHERE campaign_id = pr.campaign_id AND step_number = 1
        ) AS subject
         FROM outreach_press_releases pr
         JOIN outreach_campaigns c ON c.id = pr.campaign_id
        WHERE pr.campaign_id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Press release not found for this campaign' });
    if (!users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
      return res.status(403).json({ error: 'Not authorised for this client' });
    }
    // Include every step (subject + timing) so the UI can render + edit all four.
    const { rows: steps } = await pool.query(
      'SELECT step_number, subject, delay_days FROM outreach_sequences WHERE campaign_id = $1 ORDER BY step_number',
      [req.params.id]
    );
    res.json({ ...rows[0], steps });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Paste-and-sort import — Claude extracts contacts from whatever's pasted,
// dedupes/merges into the media library, and attaches them to this client (and
// the campaign, if given). Returns a summary the UI can show + undo from.
router.post('/clients/:clientId/import-smart', async (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Paste some names to sort.' });
  try {
    const out = await require('../services/pressImport').smartImport({
      text, clientId: req.params.clientId, campaignId: req.body?.campaign_id || null,
    });
    res.json(out);
  } catch (err) {
    console.error('[press] smart import failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Global journalist search — draw the audience from the WHOLE media library, not
// just contacts already attached to this client (Daniel's #15). Filters: free
// text (name/outlet/email), tag, beat, location, outlet. Excludes suppressed /
// bounced / emailless. The send route auto-attaches whoever is picked.
router.get('/journalists', async (req, res) => {
  const { search, tag, beat, outlet, location } = req.query;
  const where = [
    `oc.kind IN ('media','industry')`,
    `oc.email IS NOT NULL AND oc.email <> ''`,
    `(oc.status IS NULL OR oc.status <> 'do_not_contact')`,
    `oc.bounced_at IS NULL`,
  ];
  const params = [];
  const like = (v) => { params.push(`%${v}%`); return `$${params.length}`; };
  if (search) { const p = like(search); where.push(`(oc.name ILIKE ${p} OR oc.email ILIKE ${p} OR oc.company ILIKE ${p})`); }
  if (tag) { params.push(tag); where.push(`$${params.length} = ANY(oc.tags)`); }
  if (beat) { where.push(`oc.contact_type ILIKE ${like(beat)}`); }
  if (location) { where.push(`oc.location ILIKE ${like(location)}`); }
  if (outlet) { where.push(`oc.company ILIKE ${like(outlet)}`); }
  try {
    const { rows } = await pool.query(
      `SELECT oc.id, oc.name, oc.email, oc.company, oc.contact_type, oc.title, oc.location, oc.tags
         FROM outreach_contacts oc
        WHERE ${where.join(' AND ')}
        ORDER BY oc.name LIMIT 300`,
      params
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/clients/:clientId/releases', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM outreach_press_releases WHERE client_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/releases/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM outreach_press_releases WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/releases/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM outreach_press_releases WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Per-client "what counts as warm" threshold (the slider). GET returns the
// effective config (defaults merged); PUT saves an override.
router.get('/clients/:clientId/warm-config', async (req, res) => {
  try {
    const pressInterest = require('../services/pressInterest');
    const cfg = await pressInterest.config(req.params.clientId);
    res.json(cfg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/clients/:clientId/warm-config', async (req, res) => {
  const b = req.body || {};
  const cfg = {};
  if (b.min_opens != null) cfg.min_opens = Math.max(1, parseInt(b.min_opens, 10) || 3);
  if (typeof b.any_click === 'boolean') cfg.any_click = b.any_click;
  try {
    await pool.query('UPDATE clients SET press_warm_config = $1 WHERE id = $2', [JSON.stringify(cfg), req.params.clientId]);
    res.json(cfg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Suppression lists for a client's press outreach: who has unsubscribed (per
// this client) and who is globally do-not-contact ("spam"/opted out everywhere).
router.get('/clients/:clientId/suppression', async (req, res) => {
  try {
    const { rows: unsub } = await pool.query(
      `SELECT oc.id, oc.name, oc.email, oc.company, occ.unsubscribed_at
         FROM outreach_contact_clients occ JOIN outreach_contacts oc ON oc.id = occ.contact_id
        WHERE occ.client_id = $1 AND occ.unsubscribed_at IS NOT NULL
        ORDER BY occ.unsubscribed_at DESC LIMIT 500`,
      [req.params.clientId]
    );
    const { rows: dnc } = await pool.query(
      `SELECT id, name, email, company FROM outreach_contacts
        WHERE status = 'do_not_contact' OR bounced_at IS NOT NULL
        ORDER BY name LIMIT 500`
    );
    res.json({ unsubscribed: unsub, do_not_contact: dnc });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Campaign analytics — opens/clicks per journalist (repeat-open counts, what they
// clicked, warm flag + interest score) plus rolled-up rates. The client sorts the
// table however they like. Powers the "24/7 watcher" view.
router.get('/releases/:id/analytics', async (req, res) => {
  try {
    const { rows: relRows } = await pool.query('SELECT * FROM outreach_press_releases WHERE id = $1', [req.params.id]);
    if (!relRows.length) return res.status(404).json({ error: 'Press release not found' });
    const release = relRows[0];
    assertClientAccess(req, release.client_id);
    if (!release.campaign_id) return res.json({ totals: { recipients: 0 }, recipients: [] });

    const { rows } = await pool.query(
      `SELECT oc.id AS contact_id, oc.name, oc.email, oc.company,
              COALESCE(SUM(s.open_count), 0)::int AS opens,
              BOOL_OR(s.opened_at IS NOT NULL) AS opened,
              MAX(s.last_opened_at) AS last_opened_at,
              COUNT(*) FILTER (WHERE s.status = 'sent')::int AS sent_count,
              BOOL_OR(s.replied_at IS NOT NULL) AS replied,
              BOOL_OR(s.bounced_at IS NOT NULL) AS bounced,
              (SELECT COUNT(*) FROM outreach_clicks cl JOIN outreach_sends s2 ON s2.id = cl.send_id
                WHERE s2.campaign_id = $1 AND s2.contact_id = oc.id)::int AS clicks,
              (SELECT array_agg(DISTINCT cl.url) FROM outreach_clicks cl JOIN outreach_sends s2 ON s2.id = cl.send_id
                WHERE s2.campaign_id = $1 AND s2.contact_id = oc.id) AS clicked_urls,
              occ.warm_at, occ.warm_reason, occ.interest_score
         FROM outreach_sends s
         JOIN outreach_contacts oc ON oc.id = s.contact_id
         LEFT JOIN outreach_contact_clients occ ON occ.contact_id = oc.id AND occ.client_id = $2
        WHERE s.campaign_id = $1
        GROUP BY oc.id, oc.name, oc.email, oc.company, occ.warm_at, occ.warm_reason, occ.interest_score
        ORDER BY occ.interest_score DESC NULLS LAST, opens DESC`,
      [release.campaign_id, release.client_id]
    );

    const recipients = rows.length;
    const opened = rows.filter(r => r.opened).length;
    const clicked = rows.filter(r => r.clicks > 0).length;
    const replied = rows.filter(r => r.replied).length;
    const warm = rows.filter(r => r.warm_at).length;
    const pct = (n) => (recipients ? Math.round((n / recipients) * 100) : 0);
    res.json({
      totals: {
        recipients, opened, clicked, replied, warm,
        open_rate: pct(opened), click_rate: pct(clicked), reply_rate: pct(replied),
      },
      recipients: rows,
    });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Phase E4b — workspace-wide PR-ROI leaderboard. Launched press campaigns
// across the caller's visible clients, ranked by referring domains earned
// per recipient. Scoped to visibleClientIds so it respects tenant access.
router.get('/attribution/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const rows = await require('../services/pressAttribution').leaderboard(req.visibleClientIds, { limit });
    res.json({ campaigns: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Phase E4 — backlink attribution for this release. Referring domains that
// first appeared in the 21-day window after the campaign launched, plus how
// many came from outlets we pitched. Cross-tenant guarded by router.param.
router.get('/releases/:id/backlink-attribution', async (req, res) => {
  try {
    const data = await require('../services/pressAttribution').attributionForRelease(req.params.id);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Preview the email a specific journalist will receive — generates (or
// reuses cached) intro + follow-ups, returns the rendered HTML.
router.post('/releases/:id/preview', async (req, res) => {
  const { contact_id, force } = req.body || {};
  if (!contact_id) return res.status(400).json({ error: 'contact_id required' });
  try {
    const { rows: contactRows } = await pool.query('SELECT * FROM outreach_contacts WHERE id = $1', [contact_id]);
    if (!contactRows.length) return res.status(404).json({ error: 'Contact not found' });

    const { rows: relRows } = await pool.query('SELECT * FROM outreach_press_releases WHERE id = $1', [req.params.id]);
    if (!relRows.length) return res.status(404).json({ error: 'Press release not found' });
    const release = relRows[0];
    assertClientAccess(req, release.client_id);

    const cached = await pressRelease.getOrGenerateEmails({
      pressReleaseId: req.params.id, contactId: contact_id, force: !!force,
    });

    // Hero image lives in release.images[0] (extracted at fetch time);
    // surface it as hero_image so buildEmailHtml can render it.
    const releaseWithHero = { ...release, hero_image: (release.images?.[0]?.src) || null };
    const sender = { name: req.user.username === 'daniel' ? 'Daniel Nelson' : req.user.username, first_name: (req.user.username || 'Daniel').split(' ')[0], company: 'October Communications' };
    const html = pressRelease.buildEmailHtml({
      release: releaseWithHero,
      pitch: cached.intro,
      sender,
      recipientName: contactRows[0].name,
      embedFull: release.embed_full_release !== false,
      contactId: contact_id,
      clientId: release.client_id,
    });
    res.json({
      html, pitch: cached.intro, follow_ups: cached.follow_ups, generated_at: cached.generated_at,
      contact: contactRows[0],
    });
  } catch (err) {
    console.error('[press] preview failed:', err.message);
    res.status(err.status || 502).json({ error: err.message });
  }
});

// Update editable bits of a press campaign — currently the step-1
// subject line (defaults to the release title but the AM can override)
// and the embed_full_release toggle.
router.patch('/releases/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM outreach_press_releases WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Press release not found' });
    const release = rows[0];
    assertClientAccess(req, release.client_id);

    const updates = [];
    const params = [];
    if (typeof req.body?.embed_full_release === 'boolean') {
      params.push(req.body.embed_full_release);
      updates.push(`embed_full_release = $${params.length}`);
    }
    if (updates.length) {
      params.push(req.params.id);
      await pool.query(`UPDATE outreach_press_releases SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
    }

    // Subject is on the sequence row, not the release row.
    if (typeof req.body?.subject === 'string' && req.body.subject.trim()) {
      await pool.query(
        `UPDATE outreach_sequences SET subject = $1
          WHERE campaign_id = $2 AND step_number = 1`,
        [req.body.subject.trim().slice(0, 250), release.campaign_id]
      );
    }

    // Edit ANY step's subject and/or timing. steps = [{ step_number, subject, delay_days }].
    // The release step (1) and each follow-up (2..4) are all editable now.
    if (Array.isArray(req.body?.steps)) {
      for (const s of req.body.steps) {
        const n = parseInt(s.step_number, 10);
        if (!n) continue;
        const sets = [];
        const params = [];
        if (typeof s.subject === 'string' && s.subject.trim()) { params.push(s.subject.trim().slice(0, 250)); sets.push(`subject = $${params.length}`); }
        if (s.delay_days != null && Number.isFinite(Number(s.delay_days))) { params.push(Math.max(0, Math.round(Number(s.delay_days)))); sets.push(`delay_days = $${params.length}`); }
        if (!sets.length) continue;
        params.push(release.campaign_id, n);
        await pool.query(`UPDATE outreach_sequences SET ${sets.join(', ')} WHERE campaign_id = $${params.length - 1} AND step_number = $${params.length}`, params);
      }
    }

    const { rows: out } = await pool.query(
      `SELECT r.*, (SELECT subject FROM outreach_sequences WHERE campaign_id = r.campaign_id AND step_number = 1) AS subject
         FROM outreach_press_releases r WHERE r.id = $1`,
      [req.params.id]
    );
    const { rows: steps } = await pool.query(
      'SELECT step_number, subject, delay_days FROM outreach_sequences WHERE campaign_id = $1 ORDER BY step_number',
      [release.campaign_id]
    );
    res.json({ ...out[0], steps });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Send ONE faithful test copy of the email to an address (defaults to the
// signed-in user). Renders the real press template + a real journalist's
// personalised pitch, marks the subject [TEST], and does NOT track or enqueue.
router.post('/releases/:id/test', async (req, res) => {
  const email = (req.body?.email || '').trim();
  const stepNumber = parseInt(req.body?.step_number, 10) || 1;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'A valid test email address is required.' });
  try {
    const { rows: relRows } = await pool.query('SELECT * FROM outreach_press_releases WHERE id = $1', [req.params.id]);
    if (!relRows.length) return res.status(404).json({ error: 'Press release not found' });
    const release = relRows[0];
    assertClientAccess(req, release.client_id);

    // Pick a journalist to personalise for: the one requested, else any contact
    // attached to this client (so the test shows real personalisation).
    let contactId = req.body?.contact_id || null;
    if (!contactId) {
      const { rows: c } = await pool.query(
        `SELECT oc.id FROM outreach_contacts oc
           JOIN outreach_contact_clients occ ON occ.contact_id = oc.id
          WHERE occ.client_id = $1 AND oc.email IS NOT NULL LIMIT 1`,
        [release.client_id]
      );
      contactId = c[0]?.id || null;
    }
    if (!contactId) return res.status(400).json({ error: 'Add at least one journalist to this client before sending a test, so the pitch can be personalised.' });
    const { rows: contactRows } = await pool.query('SELECT * FROM outreach_contacts WHERE id = $1', [contactId]);
    if (!contactRows.length) return res.status(404).json({ error: 'Contact not found' });

    const { rows: clientRows } = await pool.query('SELECT outreach_sending FROM clients WHERE id = $1', [release.client_id]);
    await outreachSender.sendPressTest({
      release, contact: contactRows[0], toAddress: email,
      sending: clientRows[0]?.outreach_sending || null, clientId: release.client_id, stepNumber,
    });
    res.json({ ok: true, sent_to: email });
  } catch (err) {
    console.error('[press] test send failed:', err.message);
    res.status(err.status || 502).json({ error: err.message });
  }
});

// Save an AM's manual edits to a specific journalist's generated email (the
// pitch intro and/or the follow-up array), so "edit all emails" works at the
// recipient level. Overwrites the cached copy the sender reads at send time.
router.put('/releases/:id/emails/:contactId', async (req, res) => {
  try {
    const { rows: relRows } = await pool.query('SELECT client_id FROM outreach_press_releases WHERE id = $1', [req.params.id]);
    if (!relRows.length) return res.status(404).json({ error: 'Press release not found' });
    assertClientAccess(req, relRows[0].client_id);
    const sets = [];
    const params = [req.params.id, req.params.contactId];
    if (typeof req.body?.intro === 'string') { params.push(req.body.intro); sets.push(`intro = $${params.length}`); }
    if (Array.isArray(req.body?.follow_ups)) { params.push(JSON.stringify(req.body.follow_ups)); sets.push(`follow_ups = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    const { rowCount } = await pool.query(
      `UPDATE press_release_emails SET ${sets.join(', ')}, generated_at = NOW()
        WHERE press_release_id = $1 AND contact_id = $2`, params
    );
    if (!rowCount) return res.status(404).json({ error: 'No generated email for this journalist yet — preview it first.' });
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Send the release to a list of journalists. Behind the scenes we
// create one outreach_campaign per release so the follow-ups + replies
// flow through the existing outreach_sends + scheduler pipeline.
router.post('/releases/:id/send', async (req, res) => {
  const { contact_ids } = req.body || {};
  if (!Array.isArray(contact_ids) || !contact_ids.length) return res.status(400).json({ error: 'contact_ids required' });
  try {
    const { rows: relRows } = await pool.query('SELECT * FROM outreach_press_releases WHERE id = $1', [req.params.id]);
    if (!relRows.length) return res.status(404).json({ error: 'Press release not found' });
    const release = relRows[0];

    // The campaign and its sequences already exist — created at release
    // save time. Just flip it to active on the first send.
    const campaignId = release.campaign_id;
    if (!campaignId) return res.status(400).json({ error: 'Release has no campaign — re-save the release.' });
    await pool.query("UPDATE outreach_campaigns SET status = 'active', launched_at = COALESCE(launched_at, NOW()) WHERE id = $1", [campaignId]);

    const { rows: seqRows } = await pool.query(
      'SELECT * FROM outreach_sequences WHERE campaign_id = $1 ORDER BY step_number ASC',
      [campaignId]
    );

    let queued = 0;
    for (const contactId of contact_ids) {
      const { rows: contactRows } = await pool.query('SELECT * FROM outreach_contacts WHERE id = $1', [contactId]);
      if (!contactRows.length) continue;

      // Contacts are workspace-wide now — make sure this one is attached
      // to the release's client (the AM explicitly picked them, so trust
      // the intent) so the unsubscribe + per-client lists stay consistent.
      await pool.query(
        `INSERT INTO outreach_contact_clients (contact_id, client_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [contactId, release.client_id]
      );

      // Make sure intro + follow-ups are cached (cheap if they already are).
      await pressRelease.getOrGenerateEmails({
        pressReleaseId: req.params.id, contactId, force: false,
      });

      await pool.query(
        'INSERT INTO outreach_campaign_contacts (campaign_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [campaignId, contactId]
      );

      const now = Date.now();
      for (const seq of seqRows) {
        const sendAt = new Date(now + seq.delay_days * 86400_000);
        await pool.query(
          `INSERT INTO outreach_sends (campaign_id, contact_id, sequence_id, status, scheduled_at)
           VALUES ($1, $2, $3, 'pending', $4)`,
          [campaignId, contactId, seq.id, sendAt]
        );
        queued++;
      }
    }

    // Step 1 sends become due immediately (delay_days 0) and are dispatched by
    // the outreach-send cron on its next tick (≤3 min), which also applies the
    // per-mailbox caps, warm-up and pacing. There is no synchronous blast here
    // by design — that's what keeps large sends paced and deliverable.
    res.json({ campaign_id: campaignId, queued });
  } catch (err) {
    console.error('[press] send failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
