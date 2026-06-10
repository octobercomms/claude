/**
 * Contact dedup. Mirrors the outlet dedup pattern (services/pr.js) — scan
 * groups likely duplicates into clusters; merge picks a canonical and repoints
 * every FK reference, then marks losers with merged_into.
 *
 * Cluster signals (conservative on purpose — false positives mean losing real
 * data, false negatives mean the AM just sees fewer suggestions):
 *
 *   exact_email:    same lowercased email (non-empty) → almost always the
 *                   same person across imports.
 *   name_and_outlet: same full name (≥2 word tokens) AND same outlet_id —
 *                   "Jane Smith at Vogue" appears twice because two CSVs
 *                   spelt her name slightly differently.
 *   name_and_domain: same full name (≥2 tokens) AND same email domain on
 *                   contacts with no outlet set — catches a freshly-imported
 *                   "jane.smith@vogue.com" twice before either row got its
 *                   outlet_id filled in.
 *
 * Deliberately NOT clustered:
 *   - Single-token names ("Simon", "Scott"). Too weak as identity.
 *   - Cross-outlet name matches. Two journalists called "Sarah Williams" at
 *     different publications are almost always different people.
 *   - Two rows both with NULL outlet AND no email domain in common. Without
 *     either signal there's no tie strong enough to suggest a merge.
 */
const db = require('../db');

function foldDiacritics(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function normaliseName(s) {
  return foldDiacritics(String(s || '').toLowerCase())
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scan live contacts for duplicate clusters. Returns [{ method, members:[{id,name,email,outlet,outlet_id,coverage,clients}] }, …].
 * Visibility-scoped: an admin sees everything; a per-client user sees only
 * contacts attached to their visible clients (matches the library list rule).
 */
async function scanContactDuplicates(visibleClientIds) {
  const params = [];
  let visibilityWhere = '';
  if (visibleClientIds !== null) {
    params.push(visibleClientIds);
    visibilityWhere = `AND (
      c.client_id = ANY($${params.length}::uuid[])
      OR EXISTS (SELECT 1 FROM outreach_contact_clients m
                  WHERE m.contact_id = c.id AND m.client_id = ANY($${params.length}::uuid[]))
    )`;
  }
  // Pull everything once, cluster in JS. With ~20k library size that's a
  // handful of MB — cheaper than two correlated scans on the DB.
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.first_name, c.last_name, c.email, c.outlet_id, c.created_at,
            o.name AS outlet,
            (SELECT COUNT(*) FROM pr_editorial_log l WHERE l.contact_id = c.id) AS coverage_count,
            (SELECT COUNT(*) FROM outreach_contact_clients m WHERE m.contact_id = c.id) AS client_count
       FROM outreach_contacts c
       LEFT JOIN pr_outlets o ON o.id = c.outlet_id
      WHERE c.merged_into IS NULL ${visibilityWhere}`,
    params
  );

  // First, group by lowercased non-empty email — strongest signal.
  const byEmail = new Map();
  for (const r of rows) {
    const e = (r.email || '').trim().toLowerCase();
    if (!e) continue;
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e).push(r);
  }
  const clusters = [];
  const claimed = new Set();
  for (const [, members] of byEmail) {
    if (members.length < 2) continue;
    members.forEach((m) => claimed.add(m.id));
    clusters.push({ method: 'exact_email', members: members.map(formatMember) });
  }

  // Then by (normalised full name + outlet_id) — only over contacts not
  // already claimed by an email cluster, so we don't double-suggest the same
  // people in two clusters. Stricter than before to avoid the "every Simon
  // with no outlet collapses into one bucket" problem:
  //
  //   - Skip single-token names. "Simon" / "Scott" / "James" on their own
  //     are useless as identity — three different Simons at three different
  //     domains were being clustered as the same person. Need ≥2 word tokens
  //     (first + last) before we even consider the name a fingerprint.
  //   - Skip rows with no outlet_id. NULL == NULL is not a match; an outlet
  //     of "unknown" carries no identity signal. Two journalists with the
  //     same full name but no outlet need a stronger tie (e.g. same email
  //     domain) before we'd dare cluster them.
  //
  // The result is a much smaller, much higher-confidence pile of "review"
  // suggestions. Real cross-import dupes (same person re-imported under a
  // slightly different spelling at the same publication) still surface.
  const byNameOutlet = new Map();
  for (const r of rows) {
    if (claimed.has(r.id)) continue;
    if (!r.outlet_id) continue;
    const name = normaliseName(r.name || `${r.first_name || ''} ${r.last_name || ''}`);
    if (!name) continue;
    if (name.split(' ').length < 2) continue;
    const key = `${name}::${r.outlet_id}`;
    if (!byNameOutlet.has(key)) byNameOutlet.set(key, []);
    byNameOutlet.get(key).push(r);
  }
  for (const [, members] of byNameOutlet) {
    if (members.length < 2) continue;
    clusters.push({ method: 'name_and_outlet', members: members.map(formatMember) });
  }

  // Last pass: contacts with no outlet but full-name + same email domain.
  // Catches "jane.smith@vogue.com" appearing twice in different imports
  // before either row got its outlet_id filled in. Still requires the
  // 2-token name rule so "info@" collisions across companies don't cluster.
  const byNameDomain = new Map();
  for (const r of rows) {
    if (claimed.has(r.id)) continue;
    if (r.outlet_id) continue;
    const email = (r.email || '').trim().toLowerCase();
    const at = email.indexOf('@');
    if (at < 0) continue;
    const domain = email.slice(at + 1);
    if (!domain) continue;
    const name = normaliseName(r.name || `${r.first_name || ''} ${r.last_name || ''}`);
    if (!name || name.split(' ').length < 2) continue;
    const key = `${name}::${domain}`;
    if (!byNameDomain.has(key)) byNameDomain.set(key, []);
    byNameDomain.get(key).push(r);
  }
  for (const [, members] of byNameDomain) {
    if (members.length < 2) continue;
    clusters.push({ method: 'name_and_domain', members: members.map(formatMember) });
  }

  // Order: emails first (highest confidence), then most-impactful clusters
  // (more members → more cleanup per merge).
  clusters.sort((a, b) => {
    if (a.method !== b.method) return a.method === 'exact_email' ? -1 : 1;
    return b.members.length - a.members.length;
  });
  return clusters;
}

function formatMember(r) {
  return {
    id: r.id,
    name: r.name || [r.first_name, r.last_name].filter(Boolean).join(' ') || '(no name)',
    email: r.email || '',
    outlet: r.outlet || '',
    outlet_id: r.outlet_id || null,
    coverage: Number(r.coverage_count) || 0,
    clients: Number(r.client_count) || 0,
    created_at: r.created_at,
  };
}

/**
 * Pick a sensible default canonical: prefer the member with the most coverage
 * entries (deletes the least history), tiebreak by most client memberships,
 * then by oldest created_at (the original record is usually the "good" one).
 */
function suggestCanonical(cluster) {
  const sorted = [...cluster.members].sort((a, b) => {
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
    if (b.clients !== a.clients) return b.clients - a.clients;
    return new Date(a.created_at) - new Date(b.created_at);
  });
  return sorted[0]?.id || null;
}

/**
 * Merge memberIds into canonicalId. Repoints every FK that references the
 * losers, dedupes junction-table rows that would collide on a unique
 * constraint, marks losers as merged_into. Idempotent: re-running with the
 * same args is a no-op once the losers are flagged.
 *
 * Returns the count of contacts actually merged.
 */
async function mergeContacts(canonicalId, memberIds) {
  memberIds = (memberIds || []).filter((mid) => mid && mid !== canonicalId);
  if (!canonicalId || !memberIds.length) return 0;
  const canon = await db.query('SELECT id FROM outreach_contacts WHERE id = $1 AND merged_into IS NULL', [canonicalId]);
  if (!canon.rows.length) return 0;

  let merged = 0;
  for (const mid of memberIds) {
    const m = await db.query('SELECT id FROM outreach_contacts WHERE id = $1 AND merged_into IS NULL', [mid]);
    if (!m.rows.length) continue;

    // Tables with a UNIQUE/PK that includes contact_id need the dedupe
    // pattern: delete loser rows that would collide with an existing canonical
    // row, then repoint the rest. The order matters — DELETE before UPDATE.
    //
    // Schemas in scope (see migrations 015, 030, 033, 037, 054, 058, 078, 081):
    //   outreach_contact_clients  PK(contact_id, client_id)
    //   outreach_campaign_contacts PK(campaign_id, contact_id)
    //   outreach_press_release_recipients PK(press_release_id, contact_id)
    //   outreach_prospect_state  unique(campaign_id, contact_id)
    //   pr_editorial_log         no constraint on contact_id (multiple OK)
    //   pr_engagement            no constraint
    //   pr_sent_thanks           no constraint
    //   pr_thank_feedback        no constraint
    //   outreach_contact_audit   no constraint
    //   outreach_tasks           no constraint
    //   url_gap_prospects        no constraint
    //
    // We're defensive on the "may have unique" ones; the no-constraint tables
    // are simple UPDATEs.

    await db.query(
      `DELETE FROM outreach_contact_clients
        WHERE contact_id = $1
          AND client_id IN (SELECT client_id FROM outreach_contact_clients WHERE contact_id = $2)`,
      [mid, canonicalId]
    );
    await db.query('UPDATE outreach_contact_clients SET contact_id = $1 WHERE contact_id = $2', [canonicalId, mid]);

    await db.query(
      `DELETE FROM outreach_campaign_contacts
        WHERE contact_id = $1
          AND campaign_id IN (SELECT campaign_id FROM outreach_campaign_contacts WHERE contact_id = $2)`,
      [mid, canonicalId]
    );
    await db.query('UPDATE outreach_campaign_contacts SET contact_id = $1 WHERE contact_id = $2', [canonicalId, mid]);

    await safeRepointUnique('outreach_press_release_recipients', 'press_release_id', mid, canonicalId);
    await safeRepointUnique('outreach_prospect_state', 'campaign_id', mid, canonicalId);

    // No-constraint tables — straight UPDATE.
    for (const table of ['pr_editorial_log', 'pr_engagement', 'pr_sent_thanks', 'pr_thank_feedback', 'outreach_contact_audit', 'outreach_tasks']) {
      try { await db.query(`UPDATE ${table} SET contact_id = $1 WHERE contact_id = $2`, [canonicalId, mid]); } catch (e) { /* table may not exist in older deployments */ }
    }
    // url_gap_prospects uses outreach_contact_id rather than contact_id.
    try { await db.query('UPDATE url_gap_prospects SET outreach_contact_id = $1 WHERE outreach_contact_id = $2', [canonicalId, mid]); } catch (e) { /* optional */ }

    // Merge tag arrays into the canonical so we don't lose categorisation.
    await db.query(
      `UPDATE outreach_contacts c
          SET tags = (
            SELECT ARRAY(SELECT DISTINCT UNNEST(COALESCE(c.tags, ARRAY[]::text[]) || COALESCE(l.tags, ARRAY[]::text[])))
              FROM outreach_contacts l WHERE l.id = $2
          )
        WHERE c.id = $1`,
      [canonicalId, mid]
    );

    // Backfill missing canonical fields from the loser — name, email, company,
    // outlet_id, etc. — so a sparse canonical inherits the loser's data
    // wherever the canonical doesn't already have it.
    await db.query(
      `UPDATE outreach_contacts c SET
         name        = COALESCE(NULLIF(c.name,''),        (SELECT NULLIF(name,'')        FROM outreach_contacts WHERE id = $2)),
         first_name  = COALESCE(NULLIF(c.first_name,''),  (SELECT NULLIF(first_name,'')  FROM outreach_contacts WHERE id = $2)),
         last_name   = COALESCE(NULLIF(c.last_name,''),   (SELECT NULLIF(last_name,'')   FROM outreach_contacts WHERE id = $2)),
         email       = COALESCE(NULLIF(c.email,''),       (SELECT NULLIF(email,'')       FROM outreach_contacts WHERE id = $2)),
         company     = COALESCE(NULLIF(c.company,''),     (SELECT NULLIF(company,'')     FROM outreach_contacts WHERE id = $2)),
         title       = COALESCE(NULLIF(c.title,''),       (SELECT NULLIF(title,'')       FROM outreach_contacts WHERE id = $2)),
         outlet_id   = COALESCE(c.outlet_id,              (SELECT outlet_id              FROM outreach_contacts WHERE id = $2)),
         updated_at  = NOW()
       WHERE c.id = $1`,
      [canonicalId, mid]
    );

    await db.query('UPDATE outreach_contacts SET merged_into = $1, updated_at = NOW() WHERE id = $2', [canonicalId, mid]);
    merged++;
  }
  return merged;
}

async function safeRepointUnique(table, otherCol, loserId, canonicalId) {
  try {
    await db.query(
      `DELETE FROM ${table}
        WHERE contact_id = $1
          AND ${otherCol} IN (SELECT ${otherCol} FROM ${table} WHERE contact_id = $2)`,
      [loserId, canonicalId]
    );
    await db.query(`UPDATE ${table} SET contact_id = $1 WHERE contact_id = $2`, [canonicalId, loserId]);
  } catch (e) { /* table may not exist in older deployments */ }
}

module.exports = { scanContactDuplicates, mergeContacts, suggestCanonical, normaliseName };
