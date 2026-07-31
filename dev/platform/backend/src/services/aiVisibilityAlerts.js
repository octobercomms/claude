// AI Visibility alerts — the weekly watchdog on AI-answer share of voice. After
// the Monday AEO run lands, this compares the last 7 days to the previous 7 and
// fires an alert when either:
//   • the brand's share of voice drops week-on-week (sov_drop), or
//   • a competitor overtakes the brand in AI answers (competitor_overtake).
// Alerts are stored, shown in the panel, and emailed to the AM as a digest.

const pool = require('../db');

// Thresholds. Kept conservative so the alert stays signal, not noise.
const MIN_SAMPLE = 3;          // need at least this many answers in a window to judge
const SOV_DROP_PP = 10;        // percentage-point week-on-week drop that fires
const SOV_DROP_HIGH_PP = 20;   // …and above this it's high severity
const DEDUP_DAYS = 6;          // don't re-fire the same open alert within this window

// Distinct latest answer per prompt+engine inside a day-bounded window, so a
// prompt that ran twice in a week counts once.
async function windowStats(clientId, fromDaysAgo, toDaysAgo) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (prompt_id, engine) brand_mentioned, competitor_mentions
       FROM ai_visibility_runs
      WHERE client_id = $1
        AND fetched_at >= NOW() - ($2::int || ' days')::interval
        AND fetched_at <  NOW() - ($3::int || ' days')::interval
      ORDER BY prompt_id, engine, fetched_at DESC`,
    [clientId, fromDaysAgo, toDaysAgo]
  );
  let brandHits = 0;
  const competitors = new Map();
  for (const r of rows) {
    if (r.brand_mentioned) brandHits += 1;
    for (const c of (r.competitor_mentions || [])) {
      const name = String(c || '').trim();
      if (name) competitors.set(name, (competitors.get(name) || 0) + 1);
    }
  }
  const total = rows.length;
  return { total, brandHits, sov: total ? Math.round((brandHits / total) * 100) : 0, competitors };
}

// Has an unacknowledged alert of this kind (optionally for this competitor)
// already fired recently? Keeps the weekly check idempotent.
async function alreadyOpen(clientId, kind, competitor = null) {
  const { rows } = await pool.query(
    `SELECT data FROM ai_visibility_alerts
      WHERE client_id = $1 AND kind = $2 AND acknowledged_at IS NULL
        AND created_at >= NOW() - ($3::int || ' days')::interval`,
    [clientId, kind, DEDUP_DAYS]
  );
  if (!competitor) return rows.length > 0;
  return rows.some(r => (r.data && r.data.competitor) === competitor);
}

async function insertAlert(clientId, a) {
  const { rows } = await pool.query(
    `INSERT INTO ai_visibility_alerts (client_id, kind, severity, title, detail, data)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, kind, severity, title, detail, data, created_at`,
    [clientId, a.kind, a.severity || 'medium', a.title, a.detail || null, a.data || null]
  );
  return rows[0];
}

// Evaluate one client and persist any newly-fired alerts. Returns the alerts
// created this run (empty array if all quiet).
async function checkClient(clientId) {
  const cur = await windowStats(clientId, 7, 0);
  const prev = await windowStats(clientId, 14, 7);
  if (cur.total < MIN_SAMPLE) return [];   // not enough fresh data to judge

  const fired = [];

  // 1) Share-of-voice drop, week-on-week.
  if (prev.total >= MIN_SAMPLE) {
    const drop = prev.sov - cur.sov;
    if (drop >= SOV_DROP_PP && !(await alreadyOpen(clientId, 'sov_drop'))) {
      fired.push(await insertAlert(clientId, {
        kind: 'sov_drop',
        severity: drop >= SOV_DROP_HIGH_PP ? 'high' : 'medium',
        title: `Share of voice dropped ${drop} points`,
        detail: `Your brand was named in ${cur.sov}% of AI answers this week, down from ${prev.sov}% last week.`,
        data: { current_sov: cur.sov, previous_sov: prev.sov, drop, sample: cur.total },
      }));
    }
  }

  // 2) Competitor overtake — cited more than the brand this week, having been
  //    level or behind last week (a genuine crossover, not a standing gap).
  let topOvertaker = null;
  for (const [name, count] of cur.competitors) {
    if (count <= cur.brandHits) continue;                 // not ahead of us now
    const prevCount = prev.competitors.get(name) || 0;
    if (prev.total >= MIN_SAMPLE && prevCount > prev.brandHits) continue; // already ahead last week
    if (!topOvertaker || count > topOvertaker.count) topOvertaker = { name, count };
  }
  if (topOvertaker && !(await alreadyOpen(clientId, 'competitor_overtake', topOvertaker.name))) {
    fired.push(await insertAlert(clientId, {
      kind: 'competitor_overtake',
      severity: 'high',
      title: `${topOvertaker.name} overtook you in AI answers`,
      detail: `${topOvertaker.name} was named in ${topOvertaker.count} AI answers this week vs your ${cur.brandHits}. Worth a look at which questions they win.`,
      data: { competitor: topOvertaker.name, competitor_mentions: topOvertaker.count, brand_mentions: cur.brandHits, sample: cur.total },
    }));
  }

  return fired;
}

// Weekly sweep across every client that has visibility prompts configured.
// Returns [{ clientId, clientName, alerts: [...] }] for clients that fired.
async function runAll() {
  const { rows: clients } = await pool.query(
    `SELECT DISTINCT c.id, c.name
       FROM clients c
       JOIN ai_visibility_prompts p ON p.client_id = c.id AND p.active = true`
  );
  const out = [];
  for (const c of clients) {
    try {
      const alerts = await checkClient(c.id);
      if (alerts.length) out.push({ clientId: c.id, clientName: c.name, alerts });
    } catch (err) {
      console.error(`[aeo-alerts] check failed for ${c.id}:`, err.message);
    }
  }
  return out;
}

// Open (unacknowledged) alerts for the panel banner.
async function listOpen(clientId, { limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, kind, severity, title, detail, data, created_at
       FROM ai_visibility_alerts
      WHERE client_id = $1 AND acknowledged_at IS NULL
      ORDER BY created_at DESC LIMIT $2`,
    [clientId, Math.min(limit, 100)]
  );
  return rows;
}

async function acknowledge(alertId) {
  const { rows } = await pool.query(
    `UPDATE ai_visibility_alerts SET acknowledged_at = NOW() WHERE id = $1 RETURNING client_id`,
    [alertId]
  );
  return rows[0] || null;
}

module.exports = { checkClient, runAll, listOpen, acknowledge, windowStats };
