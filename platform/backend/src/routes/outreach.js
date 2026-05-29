const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess, checkClientIdFromBodyOrQuery, assertClientAccess } = require('../middleware/clientAccess');
const { getSetting } = require('../utils/settings');
const hunter = require('../services/hunter');
const serper = require('../services/serper');
const icypeas = require('../services/icypeas');
const outreachAi = require('../services/outreachAi');
const outreachSender = require('../services/outreachSender');

// Public — open-tracking pixel, loaded directly by recipients' email
// clients. Per-IP rate-limited so the endpoint can't be brute-forced
// against UUIDs to mark sends as opened en masse.
const pixelLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, skipSuccessfulRequests: false });
const TRACK_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
router.get('/track/open/:sendId', pixelLimiter, async (req, res) => {
  try {
    await pool.query('UPDATE outreach_sends SET opened_at = NOW() WHERE id = $1 AND opened_at IS NULL', [req.params.sendId]);
  } catch { /* always return the pixel */ }
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store');
  res.send(TRACK_PIXEL);
});

// Public — click tracking. The sender rewrites every <a href> in outbound
// emails to point here; we log + 302 to the original URL. base64url-encoded
// destination so awkward query strings survive the round trip. Rate-limited
// per-IP for the same reasons as the open pixel.
const clickLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, skipSuccessfulRequests: false });
router.get('/track/click/:sendId', clickLimiter, async (req, res) => {
  const raw = String(req.query.u || '');
  let url = '';
  try {
    // base64url → utf8
    const norm = raw.replace(/-/g, '+').replace(/_/g, '/');
    url = Buffer.from(norm, 'base64').toString('utf8');
  } catch { /* fall through to safety redirect */ }
  // Only allow http(s) destinations — never let an attacker forge a
  // tracking link that 302s to javascript: or data:.
  if (!/^https?:\/\//i.test(url)) {
    return res.redirect(302, process.env.PLATFORM_URL || '/');
  }
  try {
    await pool.query(
      `INSERT INTO outreach_clicks (send_id, url, user_agent, ip)
       VALUES ($1, $2, $3, $4)`,
      [req.params.sendId, url, (req.get('user-agent') || '').slice(0, 500), (req.ip || '').slice(0, 64)]
    );
    // A click also implies an open — handy when the recipient's client
    // blocks remote images but they followed a link anyway.
    await pool.query(
      'UPDATE outreach_sends SET opened_at = COALESCE(opened_at, NOW()) WHERE id = $1',
      [req.params.sendId]
    );
  } catch { /* always redirect regardless */ }
  res.redirect(302, url);
});

const users = require('../services/users');
router.use(authenticate);
router.use(loadVisibleClientIds);
// Most outreach endpoints take client_id via query or body; this catches
// both. URL endpoints that take :clientId are covered by
// requireClientAccess; endpoints that take :id (contact / campaign /
// send UUID) are resolved through the router.param hook below.
router.use(checkClientIdFromBodyOrQuery);
router.use(requireClientAccess({ paramNames: ['clientId'] }));

// :id can be a contact, campaign, or send UUID depending on the path —
// look it up and refuse if it belongs to another tenant. Contacts now
// live in a workspace-wide library, so we check that at least one of
// their attached clients is visible to the caller (or the contact has
// no attachments yet, e.g. a freshly created library row).
router.param('id', async (req, res, next, id) => {
  try {
    const path = req.path;
    if (path.startsWith('/contacts/')) {
      const { rows } = await pool.query(
        `SELECT ARRAY(
           SELECT client_id FROM outreach_contact_clients WHERE contact_id = $1
         ) AS client_ids,
         (SELECT client_id FROM outreach_contacts WHERE id = $1) AS origin_client_id`,
        [id]
      );
      if (rows.length) {
        const all = [...(rows[0].client_ids || [])];
        if (rows[0].origin_client_id) all.push(rows[0].origin_client_id);
        if (all.length && !all.some(cid => users.canAccessClient(req.visibleClientIds, cid))) {
          return res.status(403).json({ error: 'Not authorised for this contact' });
        }
      }
    } else if (path.startsWith('/campaigns/')) {
      const { rows } = await pool.query('SELECT client_id FROM outreach_campaigns WHERE id = $1', [id]);
      if (rows.length && !users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
        return res.status(403).json({ error: 'Not authorised for this client' });
      }
    } else if (path.startsWith('/sends/')) {
      const { rows } = await pool.query(
        `SELECT c.client_id FROM outreach_sends s JOIN outreach_campaigns c ON c.id = s.campaign_id WHERE s.id = $1`,
        [id]
      );
      if (rows.length && !users.canAccessClient(req.visibleClientIds, rows[0].client_id)) {
        return res.status(403).json({ error: 'Not authorised for this client' });
      }
    }
    next();
  } catch (err) {
    next(err);
  }
});

// ── Deliverability ─────────────────────────────────────────────────────────

// Live SPF + DMARC DNS check for the outreach sending domain. Returns the
// found records (if any) and a found/missing status, so the dashboard System
// Status panel can flag a misconfigured sender before campaigns go out.
router.get('/dns-check', async (req, res) => {
  let domain = (req.query.domain || '').trim().toLowerCase();
  // Whitelist the domain to the configured sending domain (or the
  // SES_FROM_EMAIL host). Without this any authenticated user could
  // turn the endpoint into a DNS recon probe for arbitrary domains.
  const configured = ((await getSetting('OUTREACH_SENDING_DOMAIN'))
    || ((await getSetting('SES_FROM_EMAIL')) || '').split('@')[1]
    || '').toLowerCase();
  if (!domain) domain = configured;
  else if (configured && domain !== configured) {
    return res.status(403).json({ error: 'dns-check only inspects the configured outreach sending domain' });
  }
  if (!domain) return res.json({ domain: null, spf: 'missing', dmarc: 'missing' });

  const dns = require('dns').promises;
  const lookup = async (host) => {
    try { return await dns.resolveTxt(host); }
    catch { return []; }
  };
  const flatten = (records) => records.map(parts => parts.join(''));

  const [base, dmarc] = await Promise.all([lookup(domain), lookup(`_dmarc.${domain}`)]);
  const spfRecord = flatten(base).find(r => /^v=spf1\b/i.test(r));
  const dmarcRecord = flatten(dmarc).find(r => /^v=DMARC1\b/i.test(r));
  res.json({
    domain,
    spf: spfRecord ? 'found' : 'missing',
    spf_record: spfRecord || null,
    dmarc: dmarcRecord ? 'found' : 'missing',
    dmarc_record: dmarcRecord || null,
  });
});

// ── Dashboard ──────────────────────────────────────────────────────────────

// Aggregate counts shown on the Outreach dashboard for a client.
router.get('/stats', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  try {
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM outreach_contact_clients
            WHERE client_id = $1 AND unsubscribed_at IS NULL) AS active_contacts,
         (SELECT COUNT(*)::int FROM outreach_campaigns WHERE client_id = $1 AND status = 'active') AS active_campaigns,
         (SELECT COUNT(*)::int FROM outreach_sends s JOIN outreach_campaigns c ON c.id = s.campaign_id
           WHERE c.client_id = $1 AND s.status = 'sent') AS emails_sent,
         (SELECT COUNT(*)::int FROM outreach_sends s JOIN outreach_campaigns c ON c.id = s.campaign_id
           WHERE c.client_id = $1 AND s.replied_at IS NOT NULL) AS replies`,
      [client_id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Which outreach integrations are configured on the platform.
router.get('/system-status', async (_req, res) => {
  // Required keys per integration; ANY-of arrays count as configured if any
  // value is present (used for the email transport, which can be Gmail or SES).
  const groups = [
    ['Claude AI', ['CLAUDE_API_KEY']],
    ['Hunter.io', ['HUNTER_API_KEY']],
    ['Icypeas', ['ICYPEAS_API_KEY', 'ICYPEAS_API_SECRET', 'ICYPEAS_USER_ID']],
    ['Serper (Web Search)', ['SERPER_API_KEY']],
    ['Email Sending', [['GMAIL_USER', 'GMAIL_APP_PASSWORD'], ['SES_SMTP_USER', 'SES_SMTP_PASS']]],
    ['Reply Polling (IMAP)', ['OUTREACH_IMAP_HOST', 'OUTREACH_IMAP_USER', 'OUTREACH_IMAP_PASSWORD']],
  ];
  try {
    const results = await Promise.all(groups.map(async ([name, keys]) => {
      let configured;
      if (Array.isArray(keys[0])) {
        // ANY group of all-set keys counts (e.g. either Gmail OR SES creds)
        const groupChecks = await Promise.all(keys.map(async group => {
          const values = await Promise.all(group.map(getSetting));
          return values.every(v => v && String(v).trim());
        }));
        configured = groupChecks.some(Boolean);
      } else {
        const values = await Promise.all(keys.map(getSetting));
        configured = values.every(v => v && String(v).trim());
      }
      return { name, status: configured ? 'connected' : 'missing' };
    }));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Contacts ───────────────────────────────────────────────────────────────

// Per-client contact list. Joins through outreach_contact_clients so this
// only returns contacts the AM has explicitly attached to the client.
router.get('/contacts', async (req, res) => {
  const { client_id, contact_type, location, search, exclude_campaign, tag, tags_all, tags_any } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  try {
    const where = ['m.client_id = $1'];
    const params = [client_id];
    if (contact_type) { params.push(contact_type); where.push(`c.contact_type = $${params.length}`); }
    if (location) { params.push(`%${location.toLowerCase()}%`); where.push(`LOWER(COALESCE(c.location, '')) LIKE $${params.length}`); }
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      where.push(`(LOWER(COALESCE(c.name, '')) LIKE $${params.length} OR LOWER(COALESCE(c.email, '')) LIKE $${params.length} OR LOWER(COALESCE(c.company, '')) LIKE $${params.length})`);
    }
    // Tag filters: ?tag=foo (single), ?tags_any=foo,bar (OR), ?tags_all=foo,bar (AND).
    if (tag) { params.push([tag]); where.push(`c.tags && $${params.length}::text[]`); }
    if (tags_any) { params.push(String(tags_any).split(',').map(t => t.trim()).filter(Boolean)); where.push(`c.tags && $${params.length}::text[]`); }
    if (tags_all) { params.push(String(tags_all).split(',').map(t => t.trim()).filter(Boolean)); where.push(`c.tags @> $${params.length}::text[]`); }
    if (exclude_campaign) {
      params.push(exclude_campaign);
      where.push(`c.id NOT IN (SELECT contact_id FROM outreach_campaign_contacts WHERE campaign_id = $${params.length})`);
    }
    // Surface unsubscribe state from the membership row (not the contact);
    // a journalist who unsubscribed from another client should look active here.
    const { rows } = await pool.query(
      `SELECT c.*, m.unsubscribed_at AS membership_unsubscribed_at, m.notes AS membership_notes,
              m.added_at AS attached_at,
              CASE WHEN m.unsubscribed_at IS NOT NULL THEN 'unsubscribed' ELSE c.status END AS status
         FROM outreach_contacts c
         JOIN outreach_contact_clients m ON m.contact_id = c.id
        WHERE ${where.join(' AND ')}
        ORDER BY c.created_at DESC
        LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Shared filter builder for the workspace-wide library — the list
// endpoint, the count and the "delete all matching" endpoint all use
// the same set of querystring params so AMs can preview exactly what's
// about to be deleted.
function buildLibraryFilter(req, q) {
  const where = [];
  const params = [];
  if (req.visibleClientIds !== null) {
    params.push(req.visibleClientIds);
    where.push(`(
      c.client_id = ANY($${params.length}::uuid[])
      OR EXISTS (
        SELECT 1 FROM outreach_contact_clients m
         WHERE m.contact_id = c.id AND m.client_id = ANY($${params.length}::uuid[])
      )
    )`);
  }
  if (q.contact_type) { params.push(q.contact_type); where.push(`c.contact_type = $${params.length}`); }
  if (q.search) {
    params.push(`%${String(q.search).toLowerCase()}%`);
    where.push(`(LOWER(COALESCE(c.name, '')) LIKE $${params.length} OR LOWER(COALESCE(c.email, '')) LIKE $${params.length} OR LOWER(COALESCE(c.company, '')) LIKE $${params.length})`);
  }
  if (q.tag) { params.push([q.tag]); where.push(`c.tags && $${params.length}::text[]`); }
  if (q.tags_any) {
    const arr = Array.isArray(q.tags_any) ? q.tags_any : String(q.tags_any).split(',').map(t => t.trim()).filter(Boolean);
    params.push(arr); where.push(`c.tags && $${params.length}::text[]`);
  }
  if (q.tags_all) {
    const arr = Array.isArray(q.tags_all) ? q.tags_all : String(q.tags_all).split(',').map(t => t.trim()).filter(Boolean);
    params.push(arr); where.push(`c.tags @> $${params.length}::text[]`);
  }
  if (q.attached_to) {
    params.push(q.attached_to);
    where.push(`EXISTS (SELECT 1 FROM outreach_contact_clients m WHERE m.contact_id = c.id AND m.client_id = $${params.length})`);
  }
  if (q.not_attached_to) {
    params.push(q.not_attached_to);
    where.push(`NOT EXISTS (SELECT 1 FROM outreach_contact_clients m WHERE m.contact_id = c.id AND m.client_id = $${params.length})`);
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// Workspace-wide library. Lists every contact across all clients the caller
// can see, with the list of clients each contact is currently attached to.
// Used by the Settings → Contacts library tab and the per-client "Add from
// library" picker.
//
// Response shape:
//   default: array of rows (backwards-compat for the picker)
//   ?include_count=1: { rows, total } — total is the unbounded match
//      count, useful when the list is capped (1000) but the user might
//      want to "delete all 21,000".
router.get('/contacts/library', async (req, res) => {
  const { include_totals, include_count } = req.query;
  try {
    const { whereSql, params } = buildLibraryFilter(req, req.query);
    // Engagement totals are computed via correlated counts so the hover
    // tooltip + sortable columns work without a second roundtrip. Keep
    // opt-in via ?include_totals=1 so the cheap multi-select picker
    // ("Add from library") doesn't pay for them.
    const totalsCols = include_totals === '1' || include_totals === 'true'
      ? `,
              (SELECT COUNT(*)::int FROM outreach_sends s WHERE s.contact_id = c.id AND s.sent_at IS NOT NULL) AS total_sent,
              (SELECT COUNT(*)::int FROM outreach_sends s WHERE s.contact_id = c.id AND s.opened_at IS NOT NULL) AS total_opened,
              (SELECT COUNT(*)::int FROM outreach_sends s WHERE s.contact_id = c.id AND s.replied_at IS NOT NULL) AS total_replied,
              (SELECT COUNT(*)::int FROM outreach_clicks ck JOIN outreach_sends s ON s.id = ck.send_id WHERE s.contact_id = c.id) AS total_clicked,
              (SELECT MAX(s.sent_at) FROM outreach_sends s WHERE s.contact_id = c.id) AS last_sent_at`
      : '';
    const { rows } = await pool.query(
      `SELECT c.*,
              ARRAY(
                SELECT m.client_id FROM outreach_contact_clients m
                 WHERE m.contact_id = c.id
                 ORDER BY m.added_at
              ) AS client_ids${totalsCols}
         FROM outreach_contacts c
         ${whereSql}
         ORDER BY c.created_at DESC
         LIMIT 1000`,
      params
    );
    if (include_count === '1' || include_count === 'true') {
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM outreach_contacts c ${whereSql}`,
        params
      );
      return res.json({ rows, total: countRows[0]?.total ?? rows.length });
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// "Delete everything matching this filter" — bypasses the 1000-row
// list cap so AMs cleaning up a 21k-row library don't have to do it in
// chunks. Accepts the same filter params as GET /contacts/library plus
// `expected_count` (a guard against an unintended sweep — must match
// the server's count to within ±2 to proceed). Visibility scope is
// always applied so a non-admin can't nuke contacts they can't see.
router.post('/contacts/library/delete-by-filter', async (req, res) => {
  const body = req.body || {};
  try {
    const { whereSql, params } = buildLibraryFilter(req, body);
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM outreach_contacts c ${whereSql}`,
      params
    );
    const total = countRows[0]?.total ?? 0;
    if (body.expected_count != null && Math.abs(Number(body.expected_count) - total) > 2) {
      return res.status(409).json({
        error: `Count mismatch — expected ${body.expected_count}, would delete ${total}`,
        total,
      });
    }
    if (!total) return res.json({ deleted: 0, total: 0 });
    // Same approach as POST /contacts/bulk-delete: a single DELETE on
    // outreach_contacts; FK cascades handle memberships and sends.
    const { rows: idRows } = await pool.query(
      `SELECT c.id FROM outreach_contacts c ${whereSql}`,
      params
    );
    const ids = idRows.map(r => r.id);
    const { rowCount } = await pool.query(
      'DELETE FROM outreach_contacts WHERE id = ANY($1::uuid[])',
      [ids]
    );
    res.json({ deleted: rowCount, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSV export of the library, honouring the same filter the AM sees on
// screen. Bypasses the 1000-row list cap so a 21k library exports in
// one file. Visibility scope is applied so a viewer only gets contacts
// they can see.
router.get('/contacts/library/export.csv', async (req, res) => {
  try {
    const { whereSql, params } = buildLibraryFilter(req, req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const filename = `contacts-library-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const headers = [
      'first_name', 'last_name', 'name', 'email', 'company', 'contact_type',
      'title', 'role', 'location', 'linkedin_url', 'website', 'source',
      'status', 'tags', 'notes', 'created_at',
    ];
    res.write(headers.join(',') + '\n');

    // 21k contacts × ~16 columns sits comfortably in one SELECT. We write
    // the response row-by-row so a big export doesn't buffer the whole
    // body server-side.
    const { rows } = await pool.query(
      `SELECT ${headers.map(h => `c.${h}`).join(', ')}
         FROM outreach_contacts c
         ${whereSql}
         ORDER BY c.created_at DESC`,
      params
    );
    for (const row of rows) {
      res.write(headers.map(h => csvEscape(formatCell(row[h]))).join(',') + '\n');
    }
    res.end();
  } catch (err) {
    if (res.headersSent) return res.end();
    res.status(500).json({ error: err.message });
  }
});

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function formatCell(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join('; ');
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// Ask Claude to look at a slice of contacts and propose field-level
// cleanups (capitalisation, missing company from email domain, URL
// scheme, etc). Accepts the same search/tags filter as the library
// list so the AM can run it on a subset (or all 500, the hard cap).
router.post('/contacts/analyze-tidy', async (req, res) => {
  try {
    const contactTidy = require('../services/contactTidy');
    const result = await contactTidy.analyseContacts({
      visibleClientIds: req.visibleClientIds,
      filterBody: req.body || {},
      limit: Number(req.body?.limit) || contactTidy.MAX_CONTACTS,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Apply a set of accepted suggestions from /analyze-tidy. Writes an
// audit row per field change so the AM has a paper trail.
router.post('/contacts/apply-tidy', async (req, res) => {
  try {
    const contactTidy = require('../services/contactTidy');
    const result = await contactTidy.applyTidy({
      user: req.user,
      visibleClientIds: req.visibleClientIds,
      suggestions: req.body?.suggestions || [],
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Audit history for one contact — what changed, when, by whom,
// and (for AI changes) the rationale. Powers the new "History" tab
// on the contact edit modal.
router.get('/contacts/:id/audit', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, u.username AS applied_by_username
         FROM outreach_contact_audit a
         LEFT JOIN users u ON u.id = a.applied_by
        WHERE a.contact_id = $1
        ORDER BY a.applied_at DESC
        LIMIT 200`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Distinct tag list with usage counts. If ?client_id is given, scopes to
// contacts attached to that client; without it, returns workspace-wide
// counts (the library view). Drives the chip picker in contact and press
// flows so the AM sees what tags already exist.
router.get('/tags', async (req, res) => {
  const { client_id } = req.query;
  try {
    let rows;
    if (client_id) {
      ({ rows } = await pool.query(
        `SELECT t AS tag, COUNT(*)::int AS count
           FROM outreach_contacts c
           JOIN outreach_contact_clients m ON m.contact_id = c.id
           CROSS JOIN LATERAL UNNEST(c.tags) t
          WHERE m.client_id = $1 AND m.unsubscribed_at IS NULL
          GROUP BY t ORDER BY count DESC, t ASC`,
        [client_id]
      ));
    } else {
      // Workspace tags scoped to clients the caller can see. Admins have
      // visibleClientIds === null and see every contact's tags.
      const params = [];
      let scope = '';
      if (req.visibleClientIds !== null) {
        params.push(req.visibleClientIds);
        scope = `WHERE c.client_id = ANY($1::uuid[])
                 OR EXISTS (SELECT 1 FROM outreach_contact_clients m
                              WHERE m.contact_id = c.id AND m.client_id = ANY($1::uuid[]))`;
      }
      ({ rows } = await pool.query(
        `SELECT t AS tag, COUNT(*)::int AS count
           FROM outreach_contacts c
           CROSS JOIN LATERAL UNNEST(c.tags) t
           ${scope}
          GROUP BY t ORDER BY count DESC, t ASC`,
        params
      ));
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ask Claude to look at the tag catalogue and propose cleanups. Returns
// a list of operation objects — the UI lets the AM tick which ones to
// apply, then sends them back to /tags/apply-plan. Visibility is honoured
// so a viewer's plan only mentions tags they can see.
router.post('/tags/analyze', async (req, res) => {
  try {
    const tagTidy = require('../services/tagTidy');
    const result = await tagTidy.analyseTags(req.visibleClientIds);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Apply a list of tag-cleanup operations (from /tags/analyze or hand-
// crafted by the AM). Walks each op and reuses the existing rename/delete
// machinery, plus an inline "add a parent tag to every contact tagged
// with the child" path for add_parent ops. Returns a per-op report so
// the UI can show "renamed 142, merged 3, parented 280, …".
router.post('/tags/apply-plan', async (req, res) => {
  const ops = Array.isArray(req.body?.operations) ? req.body.operations : [];
  if (!ops.length) return res.status(400).json({ error: 'operations[] required' });
  const results = [];
  try {
    for (const op of ops) {
      if (op.type === 'rename') {
        const r = await renameTag(req, op.from, op.to);
        results.push({ op, ...r });
      } else if (op.type === 'merge') {
        // A merge is just N renames into the same target. Each one
        // contributes its contacts to the combined total.
        let total = 0;
        for (const from of op.from || []) {
          const r = await renameTag(req, from, op.into);
          total += r.updated || 0;
        }
        results.push({ op, updated: total });
      } else if (op.type === 'delete') {
        const r = await deleteTagEverywhere(req, op.tag);
        results.push({ op, ...r });
      } else if (op.type === 'add_parent') {
        const r = await addParentTag(req, op.child, op.parent);
        results.push({ op, ...r });
      } else {
        results.push({ op, skipped: true, reason: `unknown op type ${op.type}` });
      }
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message, results });
  }
});

async function renameTag(req, fromRaw, toRaw) {
  const from = String(fromRaw || '').trim();
  const to = String(toRaw || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (!from || !to || from === to) return { updated: 0, to };
  const params = [from, to];
  let scope = `WHERE tags && ARRAY[$1]::text[]`;
  if (req.visibleClientIds !== null) {
    params.push(req.visibleClientIds);
    scope += ` AND (
      client_id = ANY($3::uuid[])
      OR EXISTS (SELECT 1 FROM outreach_contact_clients m
                  WHERE m.contact_id = outreach_contacts.id
                    AND m.client_id = ANY($3::uuid[]))
    )`;
  }
  const { rowCount } = await pool.query(
    `UPDATE outreach_contacts
        SET tags = ARRAY(
          SELECT DISTINCT CASE WHEN t = $1 THEN $2 ELSE t END
            FROM unnest(tags) t
        ),
            updated_at = NOW()
      ${scope}`,
    params
  );
  return { updated: rowCount, to };
}

async function deleteTagEverywhere(req, tagRaw) {
  const tag = String(tagRaw || '').trim();
  if (!tag) return { updated: 0 };
  const params = [tag];
  let scope = `WHERE tags && ARRAY[$1]::text[]`;
  if (req.visibleClientIds !== null) {
    params.push(req.visibleClientIds);
    scope += ` AND (
      client_id = ANY($2::uuid[])
      OR EXISTS (SELECT 1 FROM outreach_contact_clients m
                  WHERE m.contact_id = outreach_contacts.id
                    AND m.client_id = ANY($2::uuid[]))
    )`;
  }
  const { rowCount } = await pool.query(
    `UPDATE outreach_contacts
        SET tags = ARRAY(SELECT t FROM unnest(tags) t WHERE t <> $1),
            updated_at = NOW()
      ${scope}`,
    params
  );
  return { updated: rowCount };
}

async function addParentTag(req, childRaw, parentRaw) {
  const child = String(childRaw || '').trim();
  const parent = String(parentRaw || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (!child || !parent || child === parent) return { updated: 0, parent };
  const params = [child, parent];
  let scope = `WHERE tags && ARRAY[$1]::text[]`;
  if (req.visibleClientIds !== null) {
    params.push(req.visibleClientIds);
    scope += ` AND (
      client_id = ANY($3::uuid[])
      OR EXISTS (SELECT 1 FROM outreach_contact_clients m
                  WHERE m.contact_id = outreach_contacts.id
                    AND m.client_id = ANY($3::uuid[]))
    )`;
  }
  // Add the parent tag to every contact that has the child, deduping
  // with DISTINCT so a contact that already had both stays clean.
  const { rowCount } = await pool.query(
    `UPDATE outreach_contacts
        SET tags = ARRAY(
          SELECT DISTINCT unnest(COALESCE(tags, ARRAY[]::text[]) || ARRAY[$2]::text[])
        ),
            updated_at = NOW()
      ${scope}`,
    params
  );
  return { updated: rowCount, parent };
}

// Delete a tag everywhere it's used. Strips the tag string from every
// matching contact's tags[] (in the caller's visibility scope) without
// touching the contacts themselves. Use this to clean up rubbish that
// came in from a CSV import.
router.post('/tags/delete', async (req, res) => {
  const tag = String(req.body?.tag || '').trim();
  if (!tag) return res.status(400).json({ error: 'tag is required' });
  try {
    const params = [tag];
    let scope = `WHERE tags && ARRAY[$1]::text[]`;
    if (req.visibleClientIds !== null) {
      params.push(req.visibleClientIds);
      scope += ` AND (
        client_id = ANY($2::uuid[])
        OR EXISTS (SELECT 1 FROM outreach_contact_clients m
                    WHERE m.contact_id = outreach_contacts.id
                      AND m.client_id = ANY($2::uuid[]))
      )`;
    }
    const { rowCount } = await pool.query(
      `UPDATE outreach_contacts
          SET tags = ARRAY(SELECT t FROM unnest(tags) t WHERE t <> $1),
              updated_at = NOW()
        ${scope}`,
      params
    );
    res.json({ updated: rowCount, tag });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Rename a tag everywhere it's used. The new name is normalised (lowercase,
// hyphens for spaces, alphanumerics only) so it matches what the create/edit
// flows produce. If a contact already had both the old AND new names, the
// duplicate is collapsed. Visibility scope: same as the list — admins update
// every matching contact, viewers only update contacts they can see.
router.post('/tags/rename', async (req, res) => {
  const from = String(req.body?.from || '').trim();
  const toRaw = String(req.body?.to || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (!from || !toRaw) return res.status(400).json({ error: 'from and to are required' });
  if (from === toRaw) return res.json({ updated: 0, to: toRaw });
  try {
    const params = [from, toRaw];
    let scope = `WHERE tags && ARRAY[$1]::text[]`;
    if (req.visibleClientIds !== null) {
      params.push(req.visibleClientIds);
      scope += ` AND (
        client_id = ANY($3::uuid[])
        OR EXISTS (SELECT 1 FROM outreach_contact_clients m
                    WHERE m.contact_id = outreach_contacts.id
                      AND m.client_id = ANY($3::uuid[]))
      )`;
    }
    const { rowCount } = await pool.query(
      `UPDATE outreach_contacts
          SET tags = ARRAY(
            SELECT DISTINCT CASE WHEN t = $1 THEN $2 ELSE t END
              FROM unnest(tags) t
          ),
              updated_at = NOW()
        ${scope}`,
      params
    );
    res.json({ updated: rowCount, to: toRaw });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create a contact. If client_id is provided, the contact is added to the
// library AND immediately attached to that client (the common path — the
// AM is in a client's Contacts tab). Pass attach_clients=[ids] to attach to
// multiple clients in one go; or omit client_id entirely to add to the
// library without attaching anywhere.
router.post('/contacts', async (req, res) => {
  const b = req.body;
  try {
    const tags = normaliseTags(b.tags);
    const { rows } = await pool.query(
      `INSERT INTO outreach_contacts
         (client_id, name, first_name, last_name, email, company, role, title,
          contact_type, location, linkedin_url, source, website, status, notes, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        b.client_id || null,
        b.name || [b.first_name, b.last_name].filter(Boolean).join(' ') || null,
        b.first_name || null, b.last_name || null,
        b.email || null, b.company || null,
        b.role || b.title || null, b.title || null,
        b.contact_type || null, b.location || null,
        b.linkedin_url || null, b.source || 'manual',
        b.website || null, b.status || 'new', b.notes || null,
        tags,
      ]
    );
    const contact = rows[0];
    const attachIds = new Set([
      ...(b.client_id ? [b.client_id] : []),
      ...(Array.isArray(b.attach_clients) ? b.attach_clients.filter(Boolean) : []),
    ]);
    for (const cid of attachIds) {
      await pool.query(
        `INSERT INTO outreach_contact_clients (contact_id, client_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [contact.id, cid]
      );
    }
    res.status(201).json(contact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk attach existing library contacts to a client. Used by the per-client
// "Add from library" picker. Pre-existing memberships are no-ops thanks to
// the (contact_id, client_id) primary key.
router.post('/clients/:clientId/contacts/attach', async (req, res) => {
  const { contact_ids } = req.body || {};
  if (!Array.isArray(contact_ids) || !contact_ids.length) {
    return res.status(400).json({ error: 'contact_ids array required' });
  }
  try {
    let attached = 0;
    for (const cid of contact_ids) {
      const r = await pool.query(
        `INSERT INTO outreach_contact_clients (contact_id, client_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [cid, req.params.clientId]
      );
      if (r.rowCount) attached++;
    }
    res.json({ attached, total: contact_ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear a per-client unsubscribe. Used when a journalist asks "actually,
// keep me on the list" or when the AM realises a wrong contact was
// auto-unsubscribed by a reply classifier false positive. Only touches
// the one client's membership row; other clients are unaffected.
router.post('/clients/:clientId/contacts/:contactId/resubscribe', async (req, res) => {
  try {
    const { clientId, contactId } = req.params;
    await pool.query(
      `UPDATE outreach_contact_clients
          SET unsubscribed_at = NULL
        WHERE contact_id = $1 AND client_id = $2`,
      [contactId, clientId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear a hard bounce on a contact. Use when the AM has confirmed the
// address is actually fine (the bounce was a temporary mail-server
// hiccup, or they got a new working address). Doesn't touch the
// per-client unsubscribe state.
router.post('/contacts/:id/clear-bounce', async (req, res) => {
  try {
    await pool.query(
      `UPDATE outreach_contacts
          SET bounced_at = NULL, bounce_reason = NULL,
              status = CASE WHEN status = 'bounced' THEN 'active' ELSE status END,
              updated_at = NOW()
        WHERE id = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Detach a contact from a specific client without deleting the library row.
// The contact keeps existing for other clients; only this client's
// membership row + any pending sends for this client's campaigns go away.
router.delete('/clients/:clientId/contacts/:contactId', async (req, res) => {
  try {
    const { clientId, contactId } = req.params;
    await pool.query(
      `UPDATE outreach_sends s SET status = 'cancelled'
         FROM outreach_campaigns c
        WHERE s.campaign_id = c.id
          AND c.client_id = $1
          AND s.contact_id = $2
          AND s.status = 'pending'`,
      [clientId, contactId]
    );
    await pool.query(
      'DELETE FROM outreach_contact_clients WHERE contact_id = $1 AND client_id = $2',
      [contactId, clientId]
    );
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Normalise a list of free-typed tags: lowercase, slug-ish, dedupe.
// Letters / digits / hyphens / spaces preserved; spaces flatten to
// hyphens so "Topic Architecture" → "topic-architecture".
function normaliseTags(input) {
  if (!Array.isArray(input)) return [];
  const out = new Set();
  for (const raw of input) {
    if (raw == null) continue;
    const t = String(raw).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').slice(0, 50);
    if (t) out.add(t);
  }
  return Array.from(out);
}

// Bulk CSV/JSON import. Dedupes by email across the workspace library so
// re-importing the same CSV doesn't create duplicates — for matching emails
// the existing library row is kept and its tags are merged with the
// imported tags. client_id is optional and attaches the resulting (new or
// existing) contacts to that one client. attach_clients[] does the same
// for many clients at once and is used by the Settings → Contacts library
// importer with the "Also attach to:" multi-select.
router.post('/contacts/bulk', async (req, res) => {
  const { client_id, contacts, attach_clients } = req.body;
  if (!Array.isArray(contacts)) {
    return res.status(400).json({ error: 'contacts array required' });
  }
  const targetClients = new Set([
    ...(client_id ? [client_id] : []),
    ...(Array.isArray(attach_clients) ? attach_clients.filter(Boolean) : []),
  ]);
  try {
    const upserted = [];
    let inserted = 0;
    let reused = 0;
    for (const c of contacts) {
      if (!c.email && !c.name && !c.first_name) continue;
      const tags = normaliseTags(c.tags);
      const combinedName = c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || null;
      const emailLower = c.email ? String(c.email).toLowerCase() : null;
      let row = null;
      if (emailLower) {
        const { rows: existing } = await pool.query(
          'SELECT * FROM outreach_contacts WHERE LOWER(email) = $1 LIMIT 1',
          [emailLower]
        );
        if (existing.length) {
          row = existing[0];
          // Merge new tags in; keep existing fields intact rather than
          // letting a sparse CSV stomp over richer library data.
          if (tags.length) {
            const merged = Array.from(new Set([...(row.tags || []), ...tags]));
            const upd = await pool.query(
              'UPDATE outreach_contacts SET tags = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
              [merged, row.id]
            );
            row = upd.rows[0];
          }
          reused++;
        }
      }
      if (!row) {
        const { rows } = await pool.query(
          `INSERT INTO outreach_contacts
             (client_id, name, first_name, last_name, email, company, role, title,
              contact_type, location, linkedin_url, source, website, tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING *`,
          [
            client_id || null, combinedName,
            c.first_name || null, c.last_name || null,
            c.email || null, c.company || null,
            c.role || c.title || null, c.title || null,
            c.contact_type || null, c.location || null,
            c.linkedin_url || null, c.source || null,
            c.website || null, tags,
          ]
        );
        row = rows[0];
        inserted++;
      }
      for (const cid of targetClients) {
        await pool.query(
          `INSERT INTO outreach_contact_clients (contact_id, client_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [row.id, cid]
        );
      }
      upserted.push(row);
    }
    res.json({ inserted, reused, total: upserted.length, contacts: upserted });
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
    const newTags = b.tags === undefined ? c.tags : normaliseTags(b.tags);
    const { rows } = await pool.query(
      `UPDATE outreach_contacts SET
         name = $1, first_name = $2, last_name = $3, email = $4, company = $5,
         role = $6, title = $7, contact_type = $8, location = $9,
         linkedin_url = $10, source = $11, website = $12,
         status = $13, notes = $14, tags = $15, updated_at = NOW()
       WHERE id = $16 RETURNING *`,
      [
        b.name ?? c.name,
        b.first_name ?? c.first_name,
        b.last_name ?? c.last_name,
        b.email ?? c.email,
        b.company ?? c.company,
        b.role ?? c.role,
        b.title ?? c.title,
        b.contact_type ?? c.contact_type,
        b.location ?? c.location,
        b.linkedin_url ?? c.linkedin_url,
        b.source ?? c.source,
        b.website ?? c.website,
        b.status ?? c.status,
        b.notes ?? c.notes,
        newTags,
        req.params.id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Per-contact engagement timeline — Mautic-style activity log. Returns
// every send + open + click + reply we have for this contact, in time
// order, scoped to clients the caller can see (the router.param hook
// already gates the contact itself; this just filters the campaigns).
// Includes the contact's attached clients so the UI can show "stopped
// emailing for client X" alongside the timeline.
router.get('/contacts/:id/activity', async (req, res) => {
  const id = req.params.id;
  try {
    // Admins (visibleClientIds === null) see every campaign; viewers see
    // only the campaigns of clients they're assigned to.
    const adminAll = req.visibleClientIds === null;
    const params = [id];
    const clientScope = adminAll ? '' : (() => {
      params.push(req.visibleClientIds);
      return `AND cam.client_id = ANY($${params.length}::uuid[])`;
    })();

    const { rows: sends } = await pool.query(
      `SELECT s.id, s.campaign_id, s.sequence_id, s.status,
              s.scheduled_at, s.sent_at, s.opened_at,
              s.replied_at, s.reply_classification, s.reply_summary,
              cam.client_id, cam.name AS campaign_name, cam.kind AS campaign_kind,
              seq.step_number, seq.subject
         FROM outreach_sends s
         JOIN outreach_campaigns cam ON cam.id = s.campaign_id
         LEFT JOIN outreach_sequences seq ON seq.id = s.sequence_id
        WHERE s.contact_id = $1 ${clientScope}
        ORDER BY COALESCE(s.sent_at, s.scheduled_at) DESC
        LIMIT 500`,
      params
    );

    const sendIds = sends.map(s => s.id);
    let clicks = [];
    if (sendIds.length) {
      const { rows } = await pool.query(
        `SELECT id, send_id, url, clicked_at
           FROM outreach_clicks
          WHERE send_id = ANY($1::uuid[])
          ORDER BY clicked_at DESC
          LIMIT 500`,
        [sendIds]
      );
      clicks = rows;
    }

    // Flatten into one event stream the UI can render top-down.
    const events = [];
    const labelFor = (row) => row.campaign_kind === 'press_release' && row.step_number === 1
      ? `Press release · ${row.campaign_name}`
      : row.campaign_kind === 'press_release'
        ? `Press follow-up #${(row.step_number || 1) - 1} · ${row.campaign_name}`
        : row.subject
          ? `${row.subject} · ${row.campaign_name}`
          : row.campaign_name;
    for (const s of sends) {
      if (s.sent_at) events.push({ type: 'sent', at: s.sent_at, send_id: s.id, campaign_id: s.campaign_id, client_id: s.client_id, label: labelFor(s) });
      if (s.opened_at) events.push({ type: 'opened', at: s.opened_at, send_id: s.id, campaign_id: s.campaign_id, client_id: s.client_id, label: labelFor(s) });
      if (s.replied_at) events.push({ type: 'replied', at: s.replied_at, send_id: s.id, campaign_id: s.campaign_id, client_id: s.client_id, label: labelFor(s), classification: s.reply_classification, summary: s.reply_summary });
    }
    for (const c of clicks) {
      const parent = sends.find(s => s.id === c.send_id);
      events.push({ type: 'clicked', at: c.clicked_at, send_id: c.send_id, campaign_id: parent?.campaign_id, client_id: parent?.client_id, label: parent ? labelFor(parent) : 'link', url: c.url });
    }
    events.sort((a, b) => new Date(b.at) - new Date(a.at));

    // Per-client memberships (unsubscribed_at lives here now) so the
    // timeline header can flag "unsubscribed from LOLO on Sept 17".
    const memberships = await pool.query(
      `SELECT m.client_id, m.unsubscribed_at, m.added_at, cl.name AS client_name
         FROM outreach_contact_clients m
         JOIN clients cl ON cl.id = m.client_id
        WHERE m.contact_id = $1
        ORDER BY m.added_at`,
      [id]
    );

    const { rows: contactRows } = await pool.query(
      `SELECT bounced_at, bounce_reason, status FROM outreach_contacts WHERE id = $1`,
      [id]
    );
    const contact = contactRows[0] || {};

    res.json({
      events,
      memberships: memberships.rows,
      bounce: contact.bounced_at
        ? { bounced_at: contact.bounced_at, reason: contact.bounce_reason }
        : null,
      contact_status: contact.status || null,
      totals: {
        sent: sends.filter(s => s.sent_at).length,
        opened: sends.filter(s => s.opened_at).length,
        clicked: clicks.length,
        replied: sends.filter(s => s.replied_at).length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk-edit tags across many contacts. Used by the library's Bulk tag
// editor — select a bunch of journalists, add "fashion-press" + "uk" to
// all of them, or strip an outdated tag. Both add and remove are
// optional and run independently so the AM can do one or both in a
// single call.
router.post('/contacts/bulk-tags', async (req, res) => {
  const { ids, add = [], remove = [] } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'ids[] required' });
  }
  const addTags = normaliseTags(add);
  const removeTags = normaliseTags(remove);
  if (!addTags.length && !removeTags.length) {
    return res.status(400).json({ error: 'At least one tag to add or remove is required' });
  }
  try {
    // Postgres array_cat + array(SELECT DISTINCT) gives us a dedupe in
    // one statement; subtract via a SELECT … WHERE NOT IN.
    let updated = 0;
    if (addTags.length) {
      const r = await pool.query(
        `UPDATE outreach_contacts
            SET tags = (
              SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(tags, ARRAY[]::text[]) || $2::text[]))
            ),
            updated_at = NOW()
          WHERE id = ANY($1::uuid[])`,
        [ids, addTags]
      );
      updated = Math.max(updated, r.rowCount);
    }
    if (removeTags.length) {
      const r = await pool.query(
        `UPDATE outreach_contacts
            SET tags = (
              SELECT COALESCE(ARRAY(SELECT t FROM unnest(tags) t WHERE t <> ALL($2::text[])), ARRAY[]::text[])
            ),
            updated_at = NOW()
          WHERE id = ANY($1::uuid[])`,
        [ids, removeTags]
      );
      updated = Math.max(updated, r.rowCount);
    }
    res.json({ updated, added: addTags, removed: removeTags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Global delete — removes the contact from the library entirely. Use
// DELETE /clients/:clientId/contacts/:contactId instead to only detach
// from one client. Only callable from the library view.
router.delete('/contacts/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM outreach_contacts WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk detach (from a client) or bulk destroy (workspace-wide). The per-
// client Contacts page calls this with client_id to detach; the library
// page calls it without client_id to wipe contacts entirely.
router.post('/contacts/bulk-delete', async (req, res) => {
  const { client_id, ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids[] required' });
  }
  try {
    if (client_id) {
      await pool.query(
        `UPDATE outreach_sends s SET status = 'cancelled'
           FROM outreach_campaigns c
          WHERE s.campaign_id = c.id
            AND c.client_id = $1
            AND s.contact_id = ANY($2::uuid[])
            AND s.status = 'pending'`,
        [client_id, ids]
      );
      const { rowCount } = await pool.query(
        'DELETE FROM outreach_contact_clients WHERE client_id = $1 AND contact_id = ANY($2::uuid[])',
        [client_id, ids]
      );
      return res.json({ detached: rowCount });
    }
    const { rowCount } = await pool.query(
      'DELETE FROM outreach_contacts WHERE id = ANY($1::uuid[])',
      [ids]
    );
    res.json({ deleted: rowCount });
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
  const b = req.body;
  if (!b.client_id || !b.name) return res.status(400).json({ error: 'client_id and name required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO outreach_campaigns
         (client_id, name, brand, campaign_type, audience_description,
          from_name, from_email, reply_to, coupon_code, press_release_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        b.client_id, b.name,
        b.brand || null, b.campaign_type || 'outreach',
        b.audience_description || null,
        b.from_name || null, b.from_email || null, b.reply_to || null,
        b.coupon_code || null, b.press_release_url || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Patch any subset of campaign fields — used by the wizard between steps.
router.put('/campaigns/:id', async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM outreach_campaigns WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: 'Campaign not found' });
    const c = cur[0];
    const b = req.body;
    const refined = b.refined_audience !== undefined ? JSON.stringify(b.refined_audience) : null;
    const searched = b.searched_domains !== undefined ? JSON.stringify(b.searched_domains) : null;
    const { rows } = await pool.query(
      `UPDATE outreach_campaigns SET
         name = $1, brand = $2, campaign_type = $3, status = $4,
         audience_description = $5, from_name = $6, from_email = $7,
         reply_to = $8, coupon_code = $9, press_release_url = $10,
         refined_audience = COALESCE($11::jsonb, refined_audience),
         searched_domains = COALESCE($12::jsonb, searched_domains),
         updated_at = NOW()
       WHERE id = $13 RETURNING *`,
      [
        b.name ?? c.name,
        b.brand ?? c.brand,
        b.campaign_type ?? c.campaign_type,
        b.status ?? c.status,
        b.audience_description ?? c.audience_description,
        b.from_name ?? c.from_name,
        b.from_email ?? c.from_email,
        b.reply_to ?? c.reply_to,
        b.coupon_code ?? c.coupon_code,
        b.press_release_url ?? c.press_release_url,
        refined,
        searched,
        req.params.id,
      ]
    );
    res.json(rows[0]);
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

// ── Wizard: audience refinement, batched contact search, link contacts ─────

// Step 2 — Claude refines the audience into a description, target domains
// and job titles. Result is cached on the campaign so later steps can use it.
router.post('/campaigns/:id/refine-audience', async (req, res) => {
  try {
    const { rows: camps } = await pool.query('SELECT * FROM outreach_campaigns WHERE id = $1', [req.params.id]);
    if (!camps.length) return res.status(404).json({ error: 'Campaign not found' });
    const campaign = camps[0];

    const audienceDescription = req.body.audience_description ?? campaign.audience_description ?? '';
    const extraInstructions = req.body.extra_instructions || '';
    const excludeSearched = req.body.exclude_searched !== false;
    const excludedDomains = excludeSearched ? (campaign.searched_domains || []) : [];

    const refined = await outreachAi.refineAudience({
      campaign, audienceDescription, extraInstructions, excludedDomains,
    });

    await pool.query(
      `UPDATE outreach_campaigns
       SET refined_audience = $1::jsonb, audience_description = $2, updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(refined), audienceDescription, req.params.id]
    );
    res.json(refined);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Step 3 — Search a batch of up to 8 domains via Hunter + Icypeas in parallel,
// dedupe by email, fall back to Icypeas role-based scan when both return nothing.
// The searched domain list is appended to the campaign so subsequent batches and
// Claude refinements can skip them.
router.post('/campaigns/:id/search-batch', async (req, res) => {
  const { domains = [], job_titles = [], contacts_per_domain = 25 } = req.body;
  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ error: 'domains array required' });
  }
  const batch = domains.slice(0, 8).map(d => String(d).trim().toLowerCase()).filter(Boolean);
  const perDomain = Math.min(Math.max(parseInt(contacts_per_domain, 10) || 25, 1), 100);
  try {
    const results = await Promise.all(batch.map(async (domain) => {
      const [hunterRes, icypeasRes] = await Promise.allSettled([
        hunter.domainSearch(domain, Math.min(perDomain, 25)),
        icypeas.findPeople(domain, job_titles, perDomain),
      ]);
      const merged = [];
      if (hunterRes.status === 'fulfilled') merged.push(...(hunterRes.value.contacts || []));
      if (icypeasRes.status === 'fulfilled') merged.push(...(icypeasRes.value.contacts || []));
      if (merged.length === 0) {
        try {
          const fallback = await icypeas.domainSearch(domain);
          merged.push(...(fallback.contacts || []));
        } catch { /* role-based fallback unavailable */ }
      }
      return { domain, contacts: merged };
    }));

    const seen = new Set();
    const allContacts = [];
    for (const r of results) {
      for (const c of r.contacts) {
        const key = (c.email || '').toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        allContacts.push(c);
      }
    }

    const { rows: cur } = await pool.query(
      'SELECT searched_domains FROM outreach_campaigns WHERE id = $1', [req.params.id]
    );
    const existing = Array.isArray(cur[0]?.searched_domains) ? cur[0].searched_domains : [];
    const mergedDomains = [...new Set([...existing, ...batch])];
    await pool.query(
      'UPDATE outreach_campaigns SET searched_domains = $1::jsonb, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(mergedDomains), req.params.id]
    );

    res.json({ searched: batch, contacts: allContacts, total_found: allContacts.length });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Step 3 save — link selected contacts to the campaign. Accepts existing
// contact IDs and/or freshly-found contact objects to create+link.
router.post('/campaigns/:id/contacts/add', async (req, res) => {
  const { contact_ids = [], new_contacts = [] } = req.body;
  try {
    const { rows: camp } = await pool.query('SELECT client_id FROM outreach_campaigns WHERE id = $1', [req.params.id]);
    if (!camp.length) return res.status(404).json({ error: 'Campaign not found' });
    const clientId = camp[0].client_id;

    const ids = [...contact_ids];

    for (const nc of new_contacts) {
      if (!nc.email) continue;
      const lower = String(nc.email).toLowerCase();
      // Library is workspace-wide — dedupe across the whole library, not
      // just within this client. Attach the found contact to the campaign's
      // client if it isn't already.
      const { rows: existing } = await pool.query(
        'SELECT id FROM outreach_contacts WHERE LOWER(email) = $1 LIMIT 1',
        [lower]
      );
      let contactId;
      if (existing.length) {
        contactId = existing[0].id;
      } else {
        const combinedName = nc.name || [nc.first_name, nc.last_name].filter(Boolean).join(' ') || null;
        const { rows } = await pool.query(
          `INSERT INTO outreach_contacts
             (client_id, name, first_name, last_name, email, company, role, title,
              contact_type, location, linkedin_url, source, website)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id`,
          [
            clientId, combinedName,
            nc.first_name || null, nc.last_name || null,
            lower, nc.company || null,
            nc.role || nc.title || null, nc.title || null,
            nc.contact_type || null, nc.location || null,
            nc.linkedin_url || null, nc.source || 'finder',
            nc.website || null,
          ]
        );
        contactId = rows[0].id;
      }
      await pool.query(
        `INSERT INTO outreach_contact_clients (contact_id, client_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [contactId, clientId]
      );
      ids.push(contactId);
    }

    let linked = 0;
    for (const cid of ids) {
      const r = await pool.query(
        'INSERT INTO outreach_campaign_contacts (campaign_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.params.id, cid]
      );
      if (r.rowCount) linked++;
    }
    res.json({ added: linked, total: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    // Pull only contacts attached to this client AND not unsubscribed from
    // them (the unsubscribe lives on the membership row, not the contact)
    // AND not globally hard-bounced.
    const { rows: contacts } = await pool.query(
      `SELECT c.* FROM outreach_contacts c
         JOIN outreach_contact_clients m ON m.contact_id = c.id
        WHERE m.client_id = $1
          AND m.unsubscribed_at IS NULL
          AND c.bounced_at IS NULL
          AND c.email IS NOT NULL AND c.email <> ''`,
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
