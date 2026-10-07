// Audiences within one press release.
//
// A release can have several named audiences (Workplace, Retail, Residential…),
// each built from an uploaded list plus tags, each with its own subject lines,
// intro and follow-ups. The release body and hero stay shared: one release,
// several tailored covering notes.
//
// Membership is the dedupe. It lives on outreach_campaign_contacts, whose
// primary key is (campaign_id, contact_id), so a contact cannot be in two
// audiences on one release. Adding a list that overlaps an existing audience
// therefore does not silently move anyone: assign() reports the overlap, and the
// operator resolves it. See migration 191 for why the copy lives here rather
// than on per-audience outreach_sequences rows.

const pool = require('../db');

const norm = (s) => String(s == null ? '' : s).trim();

// A segment is editable until it is locked, and frozen for good once it has
// sent. Callers use these rather than reading the timestamps, so the rule is
// stated in one place.
function editableState(seg) {
  if (!seg) return { ok: false, reason: 'Audience not found.' };
  if (seg.sent_at) return { ok: false, reason: `"${seg.name}" has already been sent, so it cannot be changed.` };
  return { ok: true };
}

function assertEditable(seg) {
  const s = editableState(seg);
  if (!s.ok) { const e = new Error(s.reason); e.status = 409; throw e; }
}

async function get(id) {
  const { rows } = await pool.query('SELECT * FROM outreach_campaign_segments WHERE id = $1', [id]);
  return rows[0] || null;
}

// Every audience on a campaign, with its live member count and how many of those
// members are suppressed (so the UI can show a real sendable number rather than
// a count that shrinks at dispatch).
async function list(campaignId) {
  const { rows } = await pool.query(
    `SELECT s.*,
            COUNT(cc.contact_id)::int AS member_count,
            COUNT(cc.contact_id) FILTER (
              WHERE c.email IS NULL OR c.email = ''
                 OR c.status = 'do_not_contact' OR c.bounced_at IS NOT NULL
                 OR m.unsubscribed_at IS NOT NULL OR m.excluded_at IS NOT NULL
            )::int AS suppressed_count
       FROM outreach_campaign_segments s
       LEFT JOIN outreach_campaign_contacts cc ON cc.segment_id = s.id
       LEFT JOIN outreach_contacts c ON c.id = cc.contact_id
       LEFT JOIN outreach_contact_clients m
              ON m.contact_id = cc.contact_id
             AND m.client_id = (SELECT client_id FROM outreach_campaigns WHERE id = s.campaign_id)
      WHERE s.campaign_id = $1
      GROUP BY s.id
      ORDER BY s.position, s.created_at`,
    [campaignId]
  );
  return rows;
}

// Contacts attached to the campaign but in no audience. These are the ones an
// older single-audience campaign has, and the ones a fresh add lands in before
// being filed.
async function unassigned(campaignId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.email, c.company, c.tags
       FROM outreach_campaign_contacts cc
       JOIN outreach_contacts c ON c.id = cc.contact_id
      WHERE cc.campaign_id = $1 AND cc.segment_id IS NULL
      ORDER BY c.name LIMIT 2000`,
    [campaignId]
  );
  return rows;
}

async function create({ campaignId, name, tags = [] }) {
  const label = norm(name);
  if (!label) { const e = new Error('Give the audience a name.'); e.status = 400; throw e; }
  const { rows: pos } = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM outreach_campaign_segments WHERE campaign_id = $1',
    [campaignId]
  );
  try {
    const { rows } = await pool.query(
      `INSERT INTO outreach_campaign_segments (campaign_id, name, tags, position)
       VALUES ($1, $2, $3::text[], $4) RETURNING *`,
      [campaignId, label, tags.map(norm).filter(Boolean), pos[0].next]
    );
    return rows[0];
  } catch (err) {
    // The unique index on (campaign_id, lower(name)) — two audiences with the
    // same name would make the dedupe prompt ambiguous.
    if (err.code === '23505') { const e = new Error(`There is already an audience called "${label}".`); e.status = 409; throw e; }
    throw err;
  }
}

const COPY_FIELDS = ['name', 'tags', 'intro', 'subjects', 'followups', 'position'];

async function update(id, patch) {
  const seg = await get(id);
  assertEditable(seg);
  const sets = []; const params = [];
  for (const f of COPY_FIELDS) {
    if (!(f in patch)) continue;
    let v = patch[f];
    if (f === 'name') {
      v = norm(v);
      if (!v) { const e = new Error('Give the audience a name.'); e.status = 400; throw e; }
    }
    if (f === 'tags') v = (Array.isArray(v) ? v : []).map(norm).filter(Boolean);
    if (f === 'subjects' || f === 'followups') v = v == null ? null : JSON.stringify(v);
    params.push(v);
    sets.push(`${f} = $${params.length}${(f === 'subjects' || f === 'followups') ? '::jsonb' : ''}`);
  }
  if (!sets.length) return seg;
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE outreach_campaign_segments SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length} RETURNING *`,
    params
  );
  return rows[0];
}

// Locking snapshots the audience: membership stops following the tags it was
// built from, so retagging a journalist later never moves them mid-release.
async function setLocked(id, on) {
  const seg = await get(id);
  assertEditable(seg);
  const { rows } = await pool.query(
    'UPDATE outreach_campaign_segments SET locked_at = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
    [id, on ? new Date() : null]
  );
  return rows[0];
}

async function remove(id) {
  const seg = await get(id);
  assertEditable(seg);
  // Members fall back to unassigned rather than being detached from the
  // campaign: ON DELETE SET NULL on the membership column does this, so nobody
  // is lost by deleting an audience.
  await pool.query('DELETE FROM outreach_campaign_segments WHERE id = $1', [id]);
  return { deleted: true };
}

// Put contacts into an audience.
//
// Anyone already in a DIFFERENT audience on this release is NOT moved. They come
// back as a conflict for the operator to resolve, because moving someone changes
// which pitch they receive and that is not a decision to take silently. Anyone
// already in THIS audience, or in no audience, is simply filed here.
async function assign({ segmentId, contactIds }) {
  const seg = await get(segmentId);
  assertEditable(seg);
  if (seg.locked_at) {
    const e = new Error(`"${seg.name}" is locked. Unlock it to change who is in it.`);
    e.status = 409; throw e;
  }
  const ids = (Array.isArray(contactIds) ? contactIds : []).filter(Boolean);
  if (!ids.length) return { added: 0, already: 0, conflicts: [] };

  const { rows: existing } = await pool.query(
    `SELECT cc.contact_id, cc.segment_id, c.name, c.email, s.name AS segment_name
       FROM outreach_campaign_contacts cc
       JOIN outreach_contacts c ON c.id = cc.contact_id
       LEFT JOIN outreach_campaign_segments s ON s.id = cc.segment_id
      WHERE cc.campaign_id = $1 AND cc.contact_id = ANY($2::uuid[])`,
    [seg.campaign_id, ids]
  );
  const byId = new Map(existing.map((r) => [String(r.contact_id), r]));

  const conflicts = [];
  const toFile = [];
  let already = 0;
  for (const id of ids) {
    const row = byId.get(String(id));
    if (!row) { toFile.push(id); continue; }                       // not on the campaign yet
    if (!row.segment_id) { toFile.push(id); continue; }            // on the campaign, unfiled
    if (String(row.segment_id) === String(segmentId)) { already++; continue; }
    conflicts.push({
      contact_id: row.contact_id, name: row.name, email: row.email,
      current_segment_id: row.segment_id, current_segment_name: row.segment_name,
    });
  }

  if (toFile.length) {
    await pool.query(
      `INSERT INTO outreach_campaign_contacts (campaign_id, contact_id, segment_id)
       SELECT $1, id, $3 FROM unnest($2::uuid[]) AS t(id)
       ON CONFLICT (campaign_id, contact_id) DO UPDATE SET segment_id = $3`,
      [seg.campaign_id, toFile, segmentId]
    );
  }
  return { added: toFile.length, already, conflicts };
}

// Resolve an overlap. 'move' files them into this audience; 'keep' leaves them
// where they are. Either way the operator has chosen, and nobody ends up in two.
async function resolve({ segmentId, contactIds, action }) {
  const seg = await get(segmentId);
  assertEditable(seg);
  const ids = (Array.isArray(contactIds) ? contactIds : []).filter(Boolean);
  if (action === 'keep' || !ids.length) return { moved: 0 };
  if (action !== 'move') { const e = new Error("action must be 'move' or 'keep'."); e.status = 400; throw e; }
  // Never move someone out of an audience that has already sent — they have had
  // that audience's email, and re-filing them would misreport what they got.
  const { rowCount } = await pool.query(
    `UPDATE outreach_campaign_contacts cc
        SET segment_id = $3
      WHERE cc.campaign_id = $1 AND cc.contact_id = ANY($2::uuid[])
        AND NOT EXISTS (
          SELECT 1 FROM outreach_campaign_segments s
           WHERE s.id = cc.segment_id AND s.sent_at IS NOT NULL
        )`,
    [seg.campaign_id, ids, segmentId]
  );
  return { moved: rowCount };
}

// Remove from an audience without detaching from the campaign.
async function unfile({ segmentId, contactIds }) {
  const seg = await get(segmentId);
  assertEditable(seg);
  const ids = (Array.isArray(contactIds) ? contactIds : []).filter(Boolean);
  if (!ids.length) return { removed: 0 };
  const { rowCount } = await pool.query(
    `UPDATE outreach_campaign_contacts SET segment_id = NULL
      WHERE campaign_id = $1 AND contact_id = ANY($2::uuid[]) AND segment_id = $3`,
    [seg.campaign_id, ids, segmentId]
  );
  return { removed: rowCount };
}

// The sendable member ids of an audience, with the same suppression rules the
// audience picker uses, plus the release's country exclusions. The dispatch gate
// remains the authoritative stop; this just means we do not queue sends that are
// only going to be cancelled, so the count the operator confirms is the number
// that actually goes out.
async function memberIds(segmentId) {
  const { rows } = await pool.query(
    `SELECT cc.contact_id AS id
       FROM outreach_campaign_contacts cc
       JOIN outreach_contacts c ON c.id = cc.contact_id
       JOIN outreach_campaign_segments s ON s.id = cc.segment_id
       LEFT JOIN outreach_contact_clients m
              ON m.contact_id = cc.contact_id
             AND m.client_id = (SELECT client_id FROM outreach_campaigns WHERE id = s.campaign_id)
       LEFT JOIN outreach_press_releases pr ON pr.campaign_id = s.campaign_id
      WHERE cc.segment_id = $1
        AND c.email IS NOT NULL AND c.email <> ''
        AND (c.status IS NULL OR c.status <> 'do_not_contact')
        AND c.bounced_at IS NULL
        AND m.unsubscribed_at IS NULL
        AND m.excluded_at IS NULL
        AND NOT COALESCE(${require('./contactCountry').excludedByCountrySql(
             'c', 'pr.excluded_countries', 'pr.unknown_country_policy')}, FALSE)`,
    [segmentId]
  );
  return rows.map((r) => String(r.id));
}

// Why an audience's members are being held back, so the send panel can say
// "24 held back: 18 in an excluded country, 6 unsubscribed" rather than showing a
// number that silently shrank.
async function suppressionBreakdown(segmentId) {
  const cc = require('./contactCountry');
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS members,
       COUNT(*) FILTER (WHERE c.email IS NULL OR c.email = '')::int AS no_email,
       COUNT(*) FILTER (WHERE c.status = 'do_not_contact')::int      AS do_not_contact,
       COUNT(*) FILTER (WHERE c.bounced_at IS NOT NULL)::int         AS bounced,
       COUNT(*) FILTER (WHERE m.unsubscribed_at IS NOT NULL)::int    AS unsubscribed,
       COUNT(*) FILTER (WHERE m.excluded_at IS NOT NULL)::int        AS client_excluded,
       COUNT(*) FILTER (WHERE ${cc.excludedByCountrySql('c', 'pr.excluded_countries', 'pr.unknown_country_policy')})::int
         AS country_excluded,
       COUNT(*) FILTER (WHERE c.country IS NULL)::int                AS country_unknown
      FROM outreach_campaign_contacts occ
      JOIN outreach_contacts c ON c.id = occ.contact_id
      JOIN outreach_campaign_segments s ON s.id = occ.segment_id
      LEFT JOIN outreach_contact_clients m
             ON m.contact_id = occ.contact_id
            AND m.client_id = (SELECT client_id FROM outreach_campaigns WHERE id = s.campaign_id)
      LEFT JOIN outreach_press_releases pr ON pr.campaign_id = s.campaign_id
     WHERE occ.segment_id = $1`,
    [segmentId]
  );
  return rows[0];
}

// Which audience's copy applies to this recipient, if any. Called by the sender
// on every press dispatch, so it is one indexed lookup and returns null fast for
// a campaign with no audiences.
async function copyForContact(campaignId, contactId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.subjects, s.intro, s.followups
       FROM outreach_campaign_contacts cc
       JOIN outreach_campaign_segments s ON s.id = cc.segment_id
      WHERE cc.campaign_id = $1 AND cc.contact_id = $2`,
    [campaignId, contactId]
  );
  const seg = rows[0];
  if (!seg) return null;
  const subjects = seg.subjects && typeof seg.subjects === 'object' ? seg.subjects : {};
  const followups = Array.isArray(seg.followups) ? seg.followups : [];
  return {
    segment_id: seg.id,
    name: seg.name,
    // A step's subject, or null to fall back to the shared sequence row.
    subjectFor: (step) => norm(subjects[String(step)]) || null,
    intro: norm(seg.intro) || null,
    // Step 2 is followups[0].
    followUpFor: (step) => followups[step - 2] || null,
    hasCopy: !!(norm(seg.intro) || followups.length || Object.keys(subjects).length),
  };
}

async function markSent(segmentId) {
  await pool.query(
    'UPDATE outreach_campaign_segments SET sent_at = COALESCE(sent_at, NOW()), updated_at = NOW() WHERE id = $1',
    [segmentId]
  );
}

module.exports = {
  get, list, unassigned, create, update, setLocked, remove,
  assign, resolve, unfile, memberIds, suppressionBreakdown, copyForContact, markSent,
  editableState,
};
