// SEO drift baselining ("Git for SEO") — Integration E.
//
// Snapshots the SEO signals OMI already computes into seo_drift_baselines, then
// diffs the current signals against a chosen baseline and severity-codes every
// change. Nothing here calls an external API — it reads tables the platform
// already populates (rankings, site audits, backlinks, manual authority) — so a
// compare is cheap and deterministic. Methodology mined (MIT) from
// AgriciDaniel/claude-seo + seranking/seo-skills.

const pool = require('../db');

// ── Gather the current signals for a client ────────────────────────────────
async function gatherSignals(clientId) {
  // Rankings — latest position per active tracked keyword.
  const { rows: kw } = await pool.query(
    `SELECT k.keyword, k.location_code,
       (SELECT position FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS pos
     FROM seo_keywords k WHERE k.client_id = $1 AND k.active = true`,
    [clientId]
  );
  const positions = {};
  let ranked = 0, top3 = 0, top10 = 0, sum = 0;
  for (const k of kw) {
    const key = `${k.keyword}|${k.location_code}`;
    const p = k.pos != null ? Number(k.pos) : null;
    positions[key] = p;
    if (p != null) { ranked++; sum += p; if (p <= 3) top3++; if (p <= 10) top10++; }
  }
  const rankings = {
    tracked: kw.length, ranked, not_ranking: kw.length - ranked,
    avg_position: ranked ? Math.round((sum / ranked) * 10) / 10 : null,
    top3, top10, positions,
  };

  // Site audit — latest complete audit's score + open-issue counts by severity.
  let site_audit = null;
  const { rows: sa } = await pool.query(
    `SELECT id, score FROM site_audits WHERE client_id = $1 AND status = 'complete' ORDER BY started_at DESC LIMIT 1`,
    [clientId]
  );
  if (sa.length) {
    const { rows: sev } = await pool.query(
      `SELECT severity, COUNT(*)::int AS c FROM site_audit_issues WHERE audit_id = $1 AND status = 'open' GROUP BY severity`,
      [sa[0].id]
    );
    const bySev = { high: 0, medium: 0, low: 0 };
    sev.forEach(r => { if (r.severity in bySev) bySev[r.severity] = r.c; });
    site_audit = { score: sa[0].score, high: bySev.high, medium: bySev.medium, low: bySev.low,
      issues_total: bySev.high + bySev.medium + bySev.low };
  }

  // Backlinks — latest DFS snapshot summary (may be absent).
  let backlinks = null;
  const { rows: bl } = await pool.query(
    `SELECT backlinks_total, referring_domains_total, dofollow_ratio
     FROM dfs_backlinks_summary WHERE client_id = $1 ORDER BY captured_at DESC LIMIT 1`,
    [clientId]
  );
  if (bl.length) backlinks = {
    backlinks_total: numOrNull(bl[0].backlinks_total),
    referring_domains_total: numOrNull(bl[0].referring_domains_total),
    dofollow_ratio: numOrNull(bl[0].dofollow_ratio),
  };

  // Authority — latest manual metric month (may be absent).
  let authority = null;
  const { rows: au } = await pool.query(
    `SELECT moz_da, authority_score, referring_domains FROM seo_manual_metrics
     WHERE client_id = $1 ORDER BY month DESC LIMIT 1`,
    [clientId]
  );
  if (au.length) authority = {
    moz_da: numOrNull(au[0].moz_da), authority_score: numOrNull(au[0].authority_score),
    referring_domains: numOrNull(au[0].referring_domains),
  };

  return { rankings, site_audit, backlinks, authority };
}

function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// ── Baseline CRUD ──────────────────────────────────────────────────────────
async function captureBaseline(clientId, label) {
  const snapshot = await gatherSignals(clientId);
  const { rows } = await pool.query(
    `INSERT INTO seo_drift_baselines (client_id, label, snapshot)
     VALUES ($1, $2, $3) RETURNING id, label, snapshot, captured_at`,
    [clientId, (label || '').trim() || null, JSON.stringify(snapshot)]
  );
  return rows[0];
}

async function listBaselines(clientId) {
  const { rows } = await pool.query(
    `SELECT id, label, captured_at, snapshot FROM seo_drift_baselines
     WHERE client_id = $1 ORDER BY captured_at DESC`,
    [clientId]
  );
  return rows;
}

async function deleteBaseline(clientId, id) {
  await pool.query(`DELETE FROM seo_drift_baselines WHERE id = $1 AND client_id = $2`, [id, clientId]);
}

// ── Diff a baseline against the current signals ────────────────────────────
// One change record: { area, metric, from, to, delta, direction, severity, note }
function change(area, metric, from, to, { higherIsBetter, warnAbs, critAbs, warnPct, critPct, note } = {}) {
  if (from == null || to == null) return null;
  const delta = Math.round((to - from) * 100) / 100;
  if (delta === 0) return null;
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  const mag = Math.abs(delta);
  const pct = from !== 0 ? Math.abs(delta / from) : null;
  let severity = 'info';
  if (!improved) {
    if ((critAbs != null && mag >= critAbs) || (critPct != null && pct != null && pct >= critPct)) severity = 'critical';
    else if ((warnAbs != null && mag >= warnAbs) || (warnPct != null && pct != null && pct >= warnPct)) severity = 'warning';
    else severity = 'info';
  }
  return { area, metric, from, to, delta, direction: improved ? 'up' : 'down', severity, note: note || null };
}

function compareSnapshots(base, cur) {
  const changes = [];
  const add = (c) => { if (c) changes.push(c); };

  // Rankings
  if (base.rankings && cur.rankings) {
    add(change('Rankings', 'Average position', base.rankings.avg_position, cur.rankings.avg_position,
      { higherIsBetter: false, warnAbs: 3, critAbs: 7 }));
    add(change('Rankings', 'Keywords in top 10', base.rankings.top10, cur.rankings.top10,
      { higherIsBetter: true, warnAbs: 2, critAbs: 5 }));
    add(change('Rankings', 'Keywords in top 3', base.rankings.top3, cur.rankings.top3,
      { higherIsBetter: true, warnAbs: 2, critAbs: 4 }));
    add(change('Rankings', 'Not ranking', base.rankings.not_ranking, cur.rankings.not_ranking,
      { higherIsBetter: false, warnAbs: 2, critAbs: 5 }));

    // Per-keyword regressions worth naming: dropped out of the top 10, or fell
    // 10+ positions. Cap the list so a big shift doesn't flood the report.
    const bp = base.rankings.positions || {}, cp = cur.rankings.positions || {};
    const dropped = [];
    for (const key of Object.keys(bp)) {
      const from = bp[key], to = cp[key];
      const label = key.split('|')[0];
      if (from != null && from <= 10 && (to == null || to > 10)) {
        dropped.push({ area: 'Rankings', metric: `"${label}" left the top 10`, from, to: to ?? null,
          delta: null, direction: 'down', severity: 'warning', note: to == null ? 'now not ranking' : `now #${to}` });
      } else if (from != null && to != null && to - from >= 10) {
        dropped.push({ area: 'Rankings', metric: `"${label}" fell`, from, to,
          delta: to - from, direction: 'down', severity: to - from >= 20 ? 'critical' : 'warning', note: `#${from} → #${to}` });
      }
    }
    dropped.sort((a, b) => (b.severity === 'critical' ? 1 : 0) - (a.severity === 'critical' ? 1 : 0));
    changes.push(...dropped.slice(0, 15));
  }

  // Site audit
  if (base.site_audit && cur.site_audit) {
    add(change('Site audit', 'Health score', base.site_audit.score, cur.site_audit.score,
      { higherIsBetter: true, warnAbs: 10, critAbs: 20 }));
    add(change('Site audit', 'High-severity issues', base.site_audit.high, cur.site_audit.high,
      { higherIsBetter: false, warnAbs: 1, critAbs: 5 }));
    add(change('Site audit', 'Total open issues', base.site_audit.issues_total, cur.site_audit.issues_total,
      { higherIsBetter: false, warnAbs: 5, critAbs: 15 }));
  }

  // Backlinks
  if (base.backlinks && cur.backlinks) {
    add(change('Backlinks', 'Referring domains', base.backlinks.referring_domains_total, cur.backlinks.referring_domains_total,
      { higherIsBetter: true, warnPct: 0.05, critPct: 0.15 }));
    add(change('Backlinks', 'Total backlinks', base.backlinks.backlinks_total, cur.backlinks.backlinks_total,
      { higherIsBetter: true, warnPct: 0.1, critPct: 0.25 }));
  }

  // Authority
  if (base.authority && cur.authority) {
    add(change('Authority', 'Moz DA', base.authority.moz_da, cur.authority.moz_da,
      { higherIsBetter: true, warnAbs: 2, critAbs: 5 }));
    add(change('Authority', 'Authority score', base.authority.authority_score, cur.authority.authority_score,
      { higherIsBetter: true, warnAbs: 2, critAbs: 5 }));
  }

  const summary = { critical: 0, warning: 0, info: 0 };
  for (const c of changes) summary[c.severity] = (summary[c.severity] || 0) + 1;
  // Order: critical → warning → info, then by area.
  const rank = { critical: 0, warning: 1, info: 2 };
  changes.sort((a, b) => (rank[a.severity] - rank[b.severity]) || a.area.localeCompare(b.area));
  return { changes, summary };
}

async function compareToBaseline(clientId, baselineId) {
  let base;
  if (baselineId) {
    const { rows } = await pool.query(
      `SELECT id, label, snapshot, captured_at FROM seo_drift_baselines WHERE id = $1 AND client_id = $2`,
      [baselineId, clientId]
    );
    if (!rows.length) throw new Error('Baseline not found');
    base = rows[0];
  } else {
    const { rows } = await pool.query(
      `SELECT id, label, snapshot, captured_at FROM seo_drift_baselines WHERE client_id = $1 ORDER BY captured_at DESC LIMIT 1`,
      [clientId]
    );
    if (!rows.length) throw new Error('No baseline captured yet — capture one first.');
    base = rows[0];
  }
  const current = await gatherSignals(clientId);
  const { changes, summary } = compareSnapshots(base.snapshot, current);
  return {
    baseline: { id: base.id, label: base.label, captured_at: base.captured_at },
    current,
    changes,
    summary,
  };
}

module.exports = {
  gatherSignals, captureBaseline, listBaselines, deleteBaseline,
  compareToBaseline, compareSnapshots,
};
