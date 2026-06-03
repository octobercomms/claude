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
    res.json(rows[0]);
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

    const { rows: out } = await pool.query(
      `SELECT r.*, (SELECT subject FROM outreach_sequences WHERE campaign_id = r.campaign_id AND step_number = 1) AS subject
         FROM outreach_press_releases r WHERE r.id = $1`,
      [req.params.id]
    );
    res.json(out[0]);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
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

    // Kick the sender so step 1 goes out immediately rather than
    // waiting for the next cron tick.
    outreachSender.processPending?.().catch(err => console.error('[press] kick failed:', err.message));

    res.json({ campaign_id: campaignId, queued });
  } catch (err) {
    console.error('[press] send failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
