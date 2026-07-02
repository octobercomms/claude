// Phase E4 — press release → backlink attribution.
//
// The PR-ROI feature: for a press release, look at the referring domains
// that FIRST appeared in the 21-day window after the campaign launched, and
// how many of those came from outlets we actually pitched. Pure views over
// existing tables — outreach_press_releases → outreach_campaigns →
// outreach_sends for the launch date + recipients, and the E1 snapshots
// (dfs_referring_domains) for the earned links. No new schema.
//
// "Launch" = the first send of the release's campaign. A referring domain
// counts as earned if its DFS first_seen falls in [launch, launch + 21d].
// first_seen is a global signal (when DFS first saw any link from that
// domain), so this is correlation, not proof — but it's the same window
// every PR tool uses, and pairing it with the pitched-outlet match makes it
// defensible.

const pool = require('../db');

const WINDOW_DAYS = 21;

// Reduce an email / website to a bare registrable-ish domain for matching
// pitched outlets against referring domains. Not a full PSL parse — good
// enough to match "jane@guardian.co.uk" / "https://www.guardian.co.uk/x"
// against a referring domain "guardian.co.uk".
function hostFrom(value) {
  if (!value) return null;
  let v = String(value).trim().toLowerCase();
  const at = v.indexOf('@');
  if (at >= 0) v = v.slice(at + 1);
  v = v.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/:?#].*$/, '');
  return v || null;
}

// Attribution for a single press release. Returns { launched, ... }.
async function attributionForRelease(pressReleaseId) {
  const { rows: relRows } = await pool.query(
    `SELECT id, client_id, campaign_id, title FROM outreach_press_releases WHERE id = $1`,
    [pressReleaseId]
  );
  if (!relRows.length) throw new Error('Press release not found');
  const rel = relRows[0];

  // Launch date + recipients from the linked campaign's sends.
  if (!rel.campaign_id) return notLaunched(rel);
  const { rows: launchRows } = await pool.query(
    `SELECT MIN(sent_at) AS launch_at, COUNT(DISTINCT contact_id) AS recipients
       FROM outreach_sends
      WHERE campaign_id = $1 AND sent_at IS NOT NULL`,
    [rel.campaign_id]
  );
  const launchAt = launchRows[0]?.launch_at;
  const recipients = Number(launchRows[0]?.recipients || 0);
  if (!launchAt) return notLaunched(rel);

  const windowEnd = new Date(new Date(launchAt).getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // New referring domains in the window, from the client's latest snapshot.
  const { rows: capRows } = await pool.query(
    `SELECT MAX(captured_at) AS captured_at FROM dfs_referring_domains WHERE client_id = $1`,
    [rel.client_id]
  );
  const capturedAt = capRows[0]?.captured_at;

  let earned = [];
  if (capturedAt) {
    const { rows } = await pool.query(
      `SELECT domain, rank, first_seen, backlinks_count, dofollow
         FROM dfs_referring_domains
        WHERE client_id = $1 AND captured_at = $2
          AND first_seen >= $3 AND first_seen <= $4
        ORDER BY rank DESC NULLS LAST, backlinks_count DESC`,
      [rel.client_id, capturedAt, launchAt, windowEnd]
    );
    earned = rows;
  }

  // Which pitched outlets' domains show up among the earned links?
  const { rows: contactRows } = await pool.query(
    `SELECT DISTINCT c.email, c.website
       FROM outreach_sends s
       JOIN outreach_contacts c ON c.id = s.contact_id
      WHERE s.campaign_id = $1 AND s.sent_at IS NOT NULL`,
    [rel.campaign_id]
  );
  const pitchedHosts = new Set();
  for (const c of contactRows) {
    const h1 = hostFrom(c.email); if (h1) pitchedHosts.add(h1);
    const h2 = hostFrom(c.website); if (h2) pitchedHosts.add(h2);
  }
  const matchedEarned = earned.filter(e => {
    const d = (e.domain || '').toLowerCase();
    for (const h of pitchedHosts) {
      if (d === h || d.endsWith('.' + h) || h.endsWith('.' + d)) return true;
    }
    return false;
  });

  const dofollowCount = earned.filter(e => e.dofollow).length;
  return {
    launched: true,
    press_release_id: rel.id,
    client_id: rel.client_id,
    campaign_id: rel.campaign_id,
    title: rel.title,
    launch_at: launchAt,
    window_days: WINDOW_DAYS,
    window_end: windowEnd,
    recipients,
    snapshot_captured_at: capturedAt,
    new_rds: earned.length,
    dofollow_rds: dofollowCount,
    pitched_rds: matchedEarned.length,
    rds_per_recipient: recipients ? Number((earned.length / recipients).toFixed(3)) : null,
    domains: earned.slice(0, 100).map(e => ({
      domain: e.domain,
      rank: e.rank,
      first_seen: e.first_seen,
      dofollow: e.dofollow,
      pitched: matchedEarned.includes(e),
    })),
  };
}

// Workspace-wide leaderboard (Phase E4b) — launched press campaigns across
// the visible clients, ranked by referring domains earned per recipient in
// the 21-day window. One set-based query rather than N per-release passes.
async function leaderboard(visibleClientIds, { limit = 25 } = {}) {
  if (!Array.isArray(visibleClientIds) || !visibleClientIds.length) return [];
  const { rows } = await pool.query(
    `WITH launched AS (
       SELECT pr.id, pr.client_id, pr.title,
              MIN(s.sent_at) AS launch_at,
              COUNT(DISTINCT s.contact_id) AS recipients
         FROM outreach_press_releases pr
         JOIN outreach_sends s
           ON s.campaign_id = pr.campaign_id AND s.sent_at IS NOT NULL
        WHERE pr.client_id = ANY($1::uuid[])
        GROUP BY pr.id, pr.client_id, pr.title
     ),
     latest_cap AS (
       SELECT client_id, MAX(captured_at) AS captured_at
         FROM dfs_referring_domains
        WHERE client_id = ANY($1::uuid[])
        GROUP BY client_id
     ),
     earned AS (
       SELECT l.id AS pr_id,
              COUNT(*) AS new_rds,
              COUNT(*) FILTER (WHERE rd.dofollow) AS dofollow_rds
         FROM launched l
         JOIN latest_cap lc ON lc.client_id = l.client_id
         JOIN dfs_referring_domains rd
           ON rd.client_id = l.client_id AND rd.captured_at = lc.captured_at
          AND rd.first_seen >= l.launch_at
          AND rd.first_seen <= l.launch_at + INTERVAL '${WINDOW_DAYS} days'
        GROUP BY l.id
     )
     SELECT l.id AS press_release_id, l.client_id, l.title, l.launch_at, l.recipients,
            cl.name AS client_name,
            COALESCE(e.new_rds, 0) AS new_rds,
            COALESCE(e.dofollow_rds, 0) AS dofollow_rds,
            ROUND(COALESCE(e.new_rds, 0)::numeric / NULLIF(l.recipients, 0), 3) AS rds_per_recipient
       FROM launched l
       JOIN clients cl ON cl.id = l.client_id
       LEFT JOIN earned e ON e.pr_id = l.id
      WHERE l.recipients > 0
      ORDER BY rds_per_recipient DESC NULLS LAST, new_rds DESC, l.launch_at DESC
      LIMIT $2`,
    [visibleClientIds, limit]
  );
  return rows;
}

function notLaunched(rel) {
  return {
    launched: false,
    press_release_id: rel.id,
    client_id: rel.client_id,
    campaign_id: rel.campaign_id,
    title: rel.title,
  };
}

module.exports = { attributionForRelease, leaderboard, hostFrom, WINDOW_DAYS };
