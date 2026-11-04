// GTM Brain Phase 3 — the track record.
//
// Groups completed queue items that have both a baseline and an outcome by
// what kind of action they were (metric_ref), classifies each as improved,
// flat or declined, and aggregates. This is cross-client on purpose: "items
// about paid:roas" is the category, regardless of which account they sat on.
// That is what makes autonomy earnable in Phase 4: you cannot trust the
// Brain's judgement on a kind of recommendation until you can see its record.
//
// The classification uses the metric's direction from the enum. A metric
// where higher is better ('up') improves when outcome > baseline. A metric
// where lower is better ('down') improves when outcome < baseline. A
// neutral metric (spend) is observed but not judged.
//
// The threshold for "flat" is 5% of the baseline. Anything within that band
// is noise, not signal, and calling it a win or a loss overstates what
// happened. Five percent is generous for paid (where 1% ROAS is visible)
// and tight for earned (where publication counts are small), but a single
// threshold is honest — per-metric thresholds would be a tuning exercise
// that optimises the record's appearance rather than its accuracy.

const pool = require('../../db');
const { directionFor, labelFor } = require('./metrics');

const FLAT_THRESHOLD = 0.05;

// Pure classification. Returns 'improved', 'declined', 'flat', or 'observed'
// (for neutral-direction metrics where we record but don't judge).
function classifyOutcome(baseline, outcome, direction) {
  if (baseline == null || outcome == null) return null;
  if (!direction || direction === 'neutral') return 'observed';

  const b = Number(baseline);
  const o = Number(outcome);
  if (!Number.isFinite(b) || !Number.isFinite(o)) return null;

  // Zero baseline: any non-zero outcome is a move; zero to zero is flat.
  if (b === 0) {
    if (o === 0) return 'flat';
    return (direction === 'up' ? o > 0 : o < 0) ? 'improved' : 'declined';
  }

  const change = (o - b) / Math.abs(b);
  if (Math.abs(change) <= FLAT_THRESHOLD) return 'flat';
  if (direction === 'up') return change > 0 ? 'improved' : 'declined';
  return change < 0 ? 'improved' : 'declined';
}

// Percentage change, rounded to one decimal. Null when baseline is zero.
function pctChange(baseline, outcome) {
  if (baseline == null || outcome == null) return null;
  const b = Number(baseline);
  const o = Number(outcome);
  if (!Number.isFinite(b) || !Number.isFinite(o) || b === 0) return null;
  return Math.round(((o - b) / Math.abs(b)) * 1000) / 10;
}

// The raw rows that feed the track record. A separate function so tests
// can exercise classification without a database.
async function measuredItems({ clientId } = {}) {
  const where = clientId
    ? 'AND r.client_id = $1'
    : '';
  const params = clientId ? [clientId] : [];
  const { rows } = await pool.query(`
    SELECT r.id, r.client_id, r.metric_ref, r.pillar,
           r.baseline_value, r.outcome_value,
           r.baseline_at, r.outcome_at, r.done_at,
           r.text, r.priority
      FROM strategist_briefing_recommendations r
      JOIN strategist_briefings b ON b.id = r.briefing_id
     WHERE r.done = true
       AND r.metric_ref IS NOT NULL
       AND r.qualitative = false
       AND r.baseline_value IS NOT NULL
       AND r.outcome_value IS NOT NULL
       AND b.status = 'completed'
       ${where}
     ORDER BY r.done_at DESC NULLS LAST`, params);
  return rows;
}

// Enrich each row with classification and change percentage.
function classifyRows(rows) {
  return rows.map(r => {
    const direction = directionFor(r.metric_ref);
    return {
      ...r,
      direction,
      classification: classifyOutcome(r.baseline_value, r.outcome_value, direction),
      change_pct: pctChange(r.baseline_value, r.outcome_value),
    };
  });
}

// Group classified rows into buckets and compute summary stats.
function aggregate(classified, groupKey) {
  const groups = new Map();
  for (const r of classified) {
    const key = groupKey(r);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, { key, label: null, items: [], improved: 0, flat: 0, declined: 0, observed: 0 });
    }
    const g = groups.get(key);
    g.items.push(r);
    if (r.classification === 'improved') g.improved++;
    else if (r.classification === 'flat') g.flat++;
    else if (r.classification === 'declined') g.declined++;
    else if (r.classification === 'observed') g.observed++;
  }

  const out = [];
  for (const g of groups.values()) {
    const judged = g.improved + g.flat + g.declined;
    const changes = g.items.filter(i => i.change_pct != null).map(i => i.change_pct);
    out.push({
      key: g.key,
      label: g.label,
      total: g.items.length,
      improved: g.improved,
      flat: g.flat,
      declined: g.declined,
      observed: g.observed,
      win_rate: judged > 0 ? Math.round((g.improved / judged) * 100) : null,
      avg_change_pct: changes.length > 0
        ? Math.round((changes.reduce((s, c) => s + c, 0) / changes.length) * 10) / 10
        : null,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

// Track record grouped by metric_ref.
async function byMetric({ clientId } = {}) {
  const rows = await measuredItems({ clientId });
  const classified = classifyRows(rows);
  const groups = aggregate(classified, r => r.metric_ref);
  groups.forEach(g => { g.label = labelFor(g.key); });
  return groups;
}

// Track record grouped by pillar.
async function byPillar({ clientId } = {}) {
  const rows = await measuredItems({ clientId });
  const classified = classifyRows(rows);
  return aggregate(classified, r => r.pillar);
}

// Full detail for one client (individual items, classified).
async function forClient(clientId) {
  const rows = await measuredItems({ clientId });
  return classifyRows(rows);
}

module.exports = { classifyOutcome, pctChange, classifyRows, byMetric, byPillar, forClient, FLAT_THRESHOLD };
