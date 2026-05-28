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

// Persist a release row. Body is the parsed shape returned from /parse,
// optionally edited by the AM in the preview UI.
router.post('/clients/:clientId/releases', async (req, res) => {
  const { source_url, title, dateline, body_html, images, contact_block, boilerplate, embargo_at, fetched_at } = req.body || {};
  if (!title || !body_html) return res.status(400).json({ error: 'title and body_html required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO outreach_press_releases
         (client_id, title, body, summary, source_url, dateline, body_html, images, contact_block, boilerplate, embargo_at, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        req.params.clientId,
        title,
        body_html.replace(/<[^>]+>/g, ' '),     // plain-text body for legacy column
        (body_html.replace(/<[^>]+>/g, ' ').slice(0, 280)),
        source_url || null,
        dateline || null,
        body_html,
        JSON.stringify(images || []),
        contact_block || null,
        boilerplate || null,
        embargo_at || null,
        fetched_at || new Date().toISOString(),
      ]
    );
    res.status(201).json(rows[0]);
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
    assertClientAccess(req, contactRows[0].client_id);

    const { rows: relRows } = await pool.query('SELECT * FROM outreach_press_releases WHERE id = $1', [req.params.id]);
    if (!relRows.length) return res.status(404).json({ error: 'Press release not found' });
    const release = relRows[0];

    const cached = await pressRelease.getOrGenerateEmails({
      pressReleaseId: req.params.id, contactId: contact_id, force: !!force,
    });

    // Hero image lives in release.images[0] (extracted at fetch time);
    // surface it as hero_image so buildEmailHtml can render it.
    const releaseWithHero = { ...release, hero_image: (release.images?.[0]?.src) || null };
    const sender = { name: req.user.username === 'daniel' ? 'Daniel Nelson' : req.user.username, first_name: (req.user.username || 'Daniel').split(' ')[0], company: 'October Communications' };
    const html = pressRelease.buildEmailHtml({ release: releaseWithHero, pitch: cached.intro, sender, recipientName: contactRows[0].name });
    res.json({
      html, pitch: cached.intro, follow_ups: cached.follow_ups, generated_at: cached.generated_at,
      contact: contactRows[0],
    });
  } catch (err) {
    console.error('[press] preview failed:', err.message);
    res.status(err.status || 502).json({ error: err.message });
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

    // Create or reuse a campaign for this release so follow-ups attach
    // to one consistent thread the scheduler can chase.
    let campaignId = release.campaign_id;
    if (!campaignId) {
      const { rows: cRows } = await pool.query(
        `INSERT INTO outreach_campaigns (client_id, name, status, audience_description)
         VALUES ($1, $2, 'active', $3) RETURNING *`,
        [release.client_id, `Press: ${release.title}`.slice(0, 250), 'Press release sends']
      );
      campaignId = cRows[0].id;
      await pool.query('UPDATE outreach_press_releases SET campaign_id = $1 WHERE id = $2', [campaignId, req.params.id]);

      // Step 1 is the release itself; steps 2-4 are the chase emails.
      // Step bodies are filled in per-contact at send time (Claude
      // already wrote them and they sit in press_release_emails).
      const offsets = [0, 5, 10, 16];
      for (let i = 0; i < offsets.length; i++) {
        await pool.query(
          `INSERT INTO outreach_sequences (campaign_id, step_number, subject, body, delay_days)
           VALUES ($1, $2, $3, $4, $5)`,
          [campaignId, i + 1,
           i === 0 ? release.title : `Follow-up ${i}: ${release.title}`.slice(0, 250),
           i === 0 ? '__press_release__' : `__press_followup_${i}__`,
           offsets[i]]
        );
      }
    }

    const { rows: seqRows } = await pool.query(
      'SELECT * FROM outreach_sequences WHERE campaign_id = $1 ORDER BY step_number ASC',
      [campaignId]
    );

    let queued = 0;
    for (const contactId of contact_ids) {
      const { rows: contactRows } = await pool.query('SELECT * FROM outreach_contacts WHERE id = $1', [contactId]);
      if (!contactRows.length || contactRows[0].client_id !== release.client_id) continue;

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
