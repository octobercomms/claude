// GTM Brain Phase 2 — the outcome reader.
//
// A scheduled pass that, for each completed queue item whose measurement
// window has elapsed, re-reads its metric through the same pillar gatherer
// that produced the briefing, and stores the result.
//
// Also captures baselines for newly raised items that have a metric ref
// but no baseline value yet. Both directions of "what was the number" live
// here so the extractor logic is in one place.
//
// Reusing the gatherer matters: a second path to the same number is a
// second place for the number to be wrong.

const pool = require('../../db');
const dataCollector = require('../dataCollector');

// The gatherers, lazily loaded so a missing module doesn't crash the
// import (and so the extractor is testable without them).
function gathererFor(pillar) {
  switch (pillar) {
    case 'paid':   return require('../paidOverviewReport');
    case 'earned': return require('../earnedOverviewReport');
    case 'shared': return require('../socialOverviewReport');
    case 'owned':  return require('../ownedOverviewReport');
    default:       return null;
  }
}

// Extract a single numeric value from a pillar gatherer's reportData return.
// Pure, synchronous, and the only thing the test file exercises.
const EXTRACTORS = {
  'paid:roas':        d => d?.ads?.totals?.roas ?? null,
  'paid:cpa':         d => {
    const t = d?.ads?.totals;
    return (t?.spend > 0 && t?.convs > 0) ? t.spend / t.convs : null;
  },
  'paid:spend':       d => d?.ads?.totals?.spend ?? null,
  'paid:revenue':     d => d?.ads?.totals?.revenue ?? null,
  'paid:conversions': d => d?.ads?.totals?.convs ?? null,
  'paid:clicks':      d => d?.ads?.totals?.clicks ?? null,

  'earned:published':        d => d?.stats?.published ?? null,
  'earned:tier1_placements': d => {
    const js = d?.journalists;
    if (!Array.isArray(js)) return null;
    return js.filter(j => j.tier === 1).reduce((s, j) => s + (j.published || 0), 0);
  },
  'earned:pitch_conversion': d => {
    const pitched = d?.funnel?.pitched;
    if (!pitched) return null;
    const pub = (d?.funnel?.published || 0) + (d?.funnel?.download || 0);
    return Math.round((pub / pitched) * 100);
  },
  'earned:journalist_count': d => d?.stats?.journalists ?? null,

  'shared:engagement_rate': d => d?.totals?.avg_engagement_rate ?? null,
  'shared:reach':           d => d?.totals?.reach ?? null,
  'shared:posts':           d => d?.totals?.posts ?? null,

  'owned:top10':             d => d?.kpis?.top10 ?? null,
  'owned:top3':              d => d?.kpis?.top3 ?? null,
  'owned:audit_score':       d => d?.audit?.score ?? null,
  'owned:domain_authority':  d => d?.authority?.moz_da ?? null,
  'owned:aio_citation_rate': d => d?.kpis?.aio_coverage ?? null,

  'cross:revenue': null, // handled separately via dataCollector
  'cross:orders':  null,
};

function extractMetric(metricRef, data) {
  const fn = EXTRACTORS[metricRef];
  if (fn === undefined) return null; // unknown ref
  if (fn === null) return null; // cross — needs separate path
  const v = fn(data);
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

// Cross metrics go through dataCollector, not a pillar gatherer.
async function readCrossMetric(clientId, metricRef, days) {
  try {
    const end = new Date();
    const start = new Date(Date.now() - days * 86400000);
    const collected = await dataCollector.collectClientData(
      clientId, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)
    );
    const entries = Object.entries(collected?.data || {});
    let revenue = 0, orders = 0, found = false;
    for (const [k, payload] of entries) {
      if (k.startsWith('shopify') || k.startsWith('woocommerce')) {
        const s = payload?.summary || {};
        revenue += Number(s.total_revenue || 0);
        orders += Number(s.total_orders || 0);
        found = true;
      }
    }
    if (!found) return null;
    if (metricRef === 'cross:revenue') return Math.round(revenue);
    if (metricRef === 'cross:orders') return orders;
    return null;
  } catch { return null; }
}

// Read the current value of a metric for a client.
async function readMetric(clientId, metricRef, days) {
  const pillar = metricRef.split(':')[0];
  if (pillar === 'cross') return readCrossMetric(clientId, metricRef, days);
  const gatherer = gathererFor(pillar);
  if (!gatherer) return null;
  try {
    const data = await gatherer.reportData(clientId, { days });
    if (!data || !data.has_data) return null;
    return extractMetric(metricRef, data);
  } catch { return null; }
}

// Capture baselines for items that have a metric ref but no baseline yet.
async function captureBaselines({ log = () => {} } = {}) {
  const { rows } = await pool.query(`
    SELECT r.id, r.client_id, r.metric_ref, r.measurement_window_days
      FROM strategist_briefing_recommendations r
      JOIN strategist_briefings b ON b.id = r.briefing_id
     WHERE r.metric_ref IS NOT NULL
       AND r.qualitative = false
       AND r.baseline_value IS NULL
       AND b.status = 'completed'
     ORDER BY r.client_id, r.id
     LIMIT 200`);

  if (!rows.length) {
    log('[gtm-outcome] No items need baselines.');
    return { captured: 0 };
  }

  // Group by client to reuse gatherer calls.
  const byClient = new Map();
  for (const r of rows) {
    if (!byClient.has(r.client_id)) byClient.set(r.client_id, []);
    byClient.get(r.client_id).push(r);
  }

  let captured = 0;
  for (const [clientId, items] of byClient) {
    // Group by pillar to call each gatherer once per client.
    const byPillar = new Map();
    for (const item of items) {
      const pillar = item.metric_ref.split(':')[0];
      if (!byPillar.has(pillar)) byPillar.set(pillar, []);
      byPillar.get(pillar).push(item);
    }

    for (const [pillar, pillarItems] of byPillar) {
      const days = pillarItems[0].measurement_window_days || 30;
      let data = null;
      if (pillar === 'cross') {
        // Each cross metric is read individually.
        for (const item of pillarItems) {
          const val = await readCrossMetric(clientId, item.metric_ref, days);
          if (val != null) {
            await pool.query(
              `UPDATE strategist_briefing_recommendations
                  SET baseline_value = $1, baseline_at = NOW()
                WHERE id = $2`,
              [val, item.id]
            );
            captured++;
          }
        }
        continue;
      }

      const gatherer = gathererFor(pillar);
      if (!gatherer) continue;
      try {
        data = await gatherer.reportData(clientId, { days });
      } catch (err) {
        log(`[gtm-outcome] Gatherer failed for ${pillar} on client ${clientId}: ${err.message}`);
        continue;
      }
      if (!data || !data.has_data) continue;

      for (const item of pillarItems) {
        const val = extractMetric(item.metric_ref, data);
        if (val != null) {
          await pool.query(
            `UPDATE strategist_briefing_recommendations
                SET baseline_value = $1, baseline_at = NOW()
              WHERE id = $2`,
            [val, item.id]
          );
          captured++;
        }
      }
    }
  }

  log(`[gtm-outcome] Captured ${captured} baseline(s) across ${byClient.size} client(s).`);
  return { captured };
}

// Read outcomes for completed items whose measurement window has elapsed.
async function readOutcomes({ log = () => {} } = {}) {
  const { rows } = await pool.query(`
    SELECT r.id, r.client_id, r.metric_ref, r.measurement_window_days
      FROM strategist_briefing_recommendations r
      JOIN strategist_briefings b ON b.id = r.briefing_id
     WHERE r.done = true
       AND r.metric_ref IS NOT NULL
       AND r.qualitative = false
       AND r.outcome_value IS NULL
       AND r.done_at IS NOT NULL
       AND r.done_at + make_interval(days => COALESCE(r.measurement_window_days, 30)) <= NOW()
       AND b.status = 'completed'
     ORDER BY r.client_id, r.id
     LIMIT 200`);

  if (!rows.length) {
    log('[gtm-outcome] No completed items are due for outcome reading.');
    return { read: 0 };
  }

  const byClient = new Map();
  for (const r of rows) {
    if (!byClient.has(r.client_id)) byClient.set(r.client_id, []);
    byClient.get(r.client_id).push(r);
  }

  let read = 0;
  for (const [clientId, items] of byClient) {
    const byPillar = new Map();
    for (const item of items) {
      const pillar = item.metric_ref.split(':')[0];
      if (!byPillar.has(pillar)) byPillar.set(pillar, []);
      byPillar.get(pillar).push(item);
    }

    for (const [pillar, pillarItems] of byPillar) {
      const days = pillarItems[0].measurement_window_days || 30;
      if (pillar === 'cross') {
        for (const item of pillarItems) {
          const val = await readCrossMetric(clientId, item.metric_ref, days);
          if (val != null) {
            await pool.query(
              `UPDATE strategist_briefing_recommendations
                  SET outcome_value = $1, outcome_at = NOW()
                WHERE id = $2`,
              [val, item.id]
            );
            read++;
          }
        }
        continue;
      }

      const gatherer = gathererFor(pillar);
      if (!gatherer) continue;
      let data = null;
      try {
        data = await gatherer.reportData(clientId, { days });
      } catch (err) {
        log(`[gtm-outcome] Gatherer failed for ${pillar} on client ${clientId}: ${err.message}`);
        continue;
      }
      if (!data || !data.has_data) continue;

      for (const item of pillarItems) {
        const val = extractMetric(item.metric_ref, data);
        if (val != null) {
          await pool.query(
            `UPDATE strategist_briefing_recommendations
                SET outcome_value = $1, outcome_at = NOW()
              WHERE id = $2`,
            [val, item.id]
          );
          read++;
        }
      }
    }
  }

  log(`[gtm-outcome] Read ${read} outcome(s) across ${byClient.size} client(s).`);
  return { read };
}

// The daily pass: baselines first, then outcomes.
async function runDaily({ log = () => {} } = {}) {
  const baselines = await captureBaselines({ log });
  const outcomes = await readOutcomes({ log });
  return { baselines: baselines.captured, outcomes: outcomes.read };
}

module.exports = { extractMetric, readMetric, captureBaselines, readOutcomes, runDaily };
