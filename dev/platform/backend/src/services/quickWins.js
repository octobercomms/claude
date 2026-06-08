// Quick wins — keywords ranked in positions 11–20. One good content
// refresh (add 2–3 sub-topics, tighten the intro, internal linking) is
// usually all that's needed to push a #11–#20 page onto page 1, which
// is where ~80% of clicks happen.
//
// Computed at read time from seo_keywords + their latest ranking
// observations; no separate storage. Dismissed wins are tracked in
// quick_win_dismissed so the AM can clear ones they've already
// actioned without them re-appearing.

const pool = require('../db');

const QUICK_WIN_MIN = 11;
const QUICK_WIN_MAX = 20;

async function listForClient(clientId) {
  const { rows } = await pool.query(
    `SELECT k.id, k.keyword, k.target_url, k.intent,
            k.current_position, k.previous_position,
            k.aio_present, k.aio_brand_cited,
            d.dismissed_at, d.reason AS dismiss_reason
     FROM seo_keywords k
     LEFT JOIN quick_win_dismissed d
       ON d.keyword_id = k.id AND d.client_id = k.client_id
     WHERE k.client_id = $1
       AND k.active = TRUE
       AND k.current_position BETWEEN $2 AND $3
     ORDER BY (d.dismissed_at IS NOT NULL),
              k.current_position ASC`,
    [clientId, QUICK_WIN_MIN, QUICK_WIN_MAX]
  );
  // Compute a small "effort score" — lower = easier to push. Position
  // 11 is easiest (just on the edge of page 1), position 20 is hardest.
  // Pages that have moved UP since last check get a bonus (they're
  // trending the right way already).
  return rows.map(r => {
    const distance = r.current_position - 10;     // 1..10
    const trend = r.previous_position && r.current_position
      ? r.previous_position - r.current_position
      : 0;                                        // positive = improved
    const effort = Math.max(1, Math.min(10, distance - Math.max(0, trend)));
    return {
      id: r.id,
      keyword: r.keyword,
      target_url: r.target_url,
      intent: r.intent,
      current_position: r.current_position,
      previous_position: r.previous_position,
      trend,
      aio_present: r.aio_present,
      aio_brand_cited: r.aio_brand_cited,
      effort_score: effort,
      dismissed_at: r.dismissed_at || null,
      dismiss_reason: r.dismiss_reason || null,
    };
  });
}

async function dismiss({ clientId, keywordId, reason }) {
  await pool.query(
    `INSERT INTO quick_win_dismissed (client_id, keyword_id, reason)
     VALUES ($1, $2, $3)
     ON CONFLICT (client_id, keyword_id) DO UPDATE SET reason = EXCLUDED.reason, dismissed_at = NOW()`,
    [clientId, keywordId, reason || null]
  );
}

async function undismiss({ clientId, keywordId }) {
  await pool.query(
    `DELETE FROM quick_win_dismissed WHERE client_id = $1 AND keyword_id = $2`,
    [clientId, keywordId]
  );
}

module.exports = { listForClient, dismiss, undismiss, QUICK_WIN_MIN, QUICK_WIN_MAX };
