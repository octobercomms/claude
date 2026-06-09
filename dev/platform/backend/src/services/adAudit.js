// Ad audit scorer — turns the Strategist's Meta + Google campaign snapshot
// into a weighted 0–100 ad-health score with per-category findings.
//
// The methodology (categories, weights, benchmarks) is mined from
// AgriciDaniel/claude-ads (MIT) and scoped to the campaign-performance
// aggregates we already pull — see src/data/adAuditRubric.json for the
// rubric and the attribution. The rubric file holds the editable knowledge
// (what's checked, weights, thresholds); the evaluation logic lives here,
// keyed by check id.
//
// scoreSnapshot() is a PURE function of the snapshot object that
// strategistReport.snapshot() builds — no DB, no Claude, no network — so it's
// deterministic and trivially testable with fixtures. strategistReport wires
// it in (and persists the result) in the next slice; this slice ships the
// scorer in isolation.

const rubric = require('../data/adAuditRubric.json');

// Default score (0–1) for each status. Individual checks can override with a
// finer-grained number; these are the fallbacks and drive category/overall
// aggregation. 'na' findings are excluded from every average.
const STATUS_SCORE = { strong: 1, healthy: 0.85, mixed: 0.55, weak: 0.3, broken: 0, na: null };

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}
function gbp(n) { return `£${Math.round(num(n)).toLocaleString('en-GB')}`; }
function pct(n) { return `${num(n).toFixed(2)}%`; }

// Flatten the snapshot's per-platform campaign arrays into one normalised
// shape so the checks don't each have to know Meta-vs-Google field names.
function normalizeCampaigns(snapshot) {
  const out = [];
  for (const c of snapshot?.meta?.campaigns || []) {
    out.push({
      platform: 'Meta', account: c.account || null, campaign: c.campaign || 'Unknown',
      spend: num(c.spend), impressions: num(c.impressions), clicks: num(c.clicks),
      ctr: num(c.ctr), frequency: c.frequency == null ? null : num(c.frequency),
      add_to_cart: num(c.add_to_cart), initiate_checkout: num(c.initiate_checkout),
      conversions: num(c.purchases), conversion_value: num(c.purchase_value),
      roas: c.roas == null ? null : num(c.roas),
    });
  }
  for (const c of snapshot?.google?.campaigns || []) {
    out.push({
      platform: 'Google', account: c.account || null, campaign: c.campaign || 'Unknown',
      spend: num(c.spend), impressions: num(c.impressions), clicks: num(c.clicks),
      ctr: num(c.ctr), frequency: null,
      add_to_cart: null, initiate_checkout: null,
      conversions: num(c.conversions), conversion_value: num(c.conversion_value),
      roas: c.roas == null ? null : num(c.roas),
    });
  }
  return out;
}

function totals(campaigns) {
  return campaigns.reduce((a, c) => ({
    spend: a.spend + c.spend,
    impressions: a.impressions + c.impressions,
    clicks: a.clicks + c.clicks,
    conversions: a.conversions + c.conversions,
    conversion_value: a.conversion_value + c.conversion_value,
  }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 });
}

// ── Individual checks ──────────────────────────────────────────────────────
// Each returns { status, score?, evidence }. status is one of the STATUS_SCORE
// keys; 'na' means "not enough data to judge", excluded from scoring.

const B = rubric.benchmarks;

const CHECKS = {
  blended_roas(ctx) {
    const { t } = ctx;
    if (t.spend <= 0) return { status: 'na', evidence: 'No spend in period.' };
    if (t.conversion_value <= 0) {
      return { status: 'na', evidence: `No conversion value reported on ${gbp(t.spend)} spend — likely a lead-gen/value-less setup; ROAS not meaningful.` };
    }
    const roas = t.conversion_value / t.spend;
    const ev = `Blended ROAS ${roas.toFixed(2)}x (${gbp(t.conversion_value)} value on ${gbp(t.spend)} spend).`;
    if (roas >= B.roas.good) return { status: 'strong', evidence: ev };
    if (roas >= B.roas.weak) return { status: 'healthy', evidence: ev };
    if (roas >= B.roas.broken) return { status: 'weak', evidence: ev };
    return { status: 'broken', evidence: `${ev} Below ${B.roas.broken}x — spend is losing money.` };
  },

  zero_conversion_drain(ctx) {
    const { campaigns, t } = ctx;
    if (t.spend <= 0) return { status: 'na', evidence: 'No spend in period.' };
    const drains = campaigns
      .filter(c => c.spend >= B.drain_min_spend && c.conversions <= 0)
      .sort((a, b) => b.spend - a.spend);
    if (!drains.length) return { status: 'strong', evidence: `Every campaign above ${gbp(B.drain_min_spend)} spend produced at least one conversion.` };
    const wasted = drains.reduce((s, c) => s + c.spend, 0);
    const share = wasted / t.spend;
    const named = drains.slice(0, 3).map(c => `${c.platform}: "${c.campaign}" (${gbp(c.spend)})`).join('; ');
    const ev = `${drains.length} campaign(s) spent ${gbp(wasted)} (${pct(share * 100)} of total) with zero conversions — ${named}.`;
    if (share >= 0.4) return { status: 'broken', score: 0.1, evidence: ev };
    if (share >= 0.15) return { status: 'weak', evidence: ev };
    return { status: 'mixed', evidence: ev };
  },

  conversion_signal_present(ctx) {
    const { t } = ctx;
    if (t.spend <= 0) return { status: 'na', evidence: 'No spend in period.' };
    if (t.conversions > 0) return { status: 'healthy', evidence: `${Math.round(t.conversions)} conversion(s) recorded — tracking is firing.` };
    return { status: 'broken', evidence: `Zero conversions across ${gbp(t.spend)} of spend — either nothing converted, or (more likely) conversion tracking is broken. Verify the pixel / conversion actions before optimising.` };
  },

  meta_funnel(ctx) {
    const meta = ctx.campaigns.filter(c => c.platform === 'Meta');
    const atc = meta.reduce((s, c) => s + num(c.add_to_cart), 0);
    const purch = meta.reduce((s, c) => s + c.conversions, 0);
    if (atc <= 0) return { status: 'na', evidence: 'No Meta add-to-cart data in period.' };
    const rate = (purch / atc) * 100;
    const ev = `Meta add-to-cart → purchase rate ${pct(rate)} (${Math.round(purch)} purchases from ${Math.round(atc)} add-to-carts).`;
    if (rate >= B.atc_to_purchase_pct.good) return { status: 'strong', evidence: ev };
    if (rate >= B.atc_to_purchase_pct.weak) return { status: 'mixed', evidence: ev };
    return { status: 'weak', evidence: `${ev} Heavy drop-off after add-to-cart points at checkout/landing-page friction, not ad targeting.` };
  },

  ctr_health(ctx) {
    const { campaigns, t } = ctx;
    if (t.impressions <= 0) return { status: 'na', evidence: 'No impressions in period.' };
    // Spend-weighted CTR avoids a tiny test campaign skewing the headline.
    const weighted = campaigns.reduce((s, c) => s + c.ctr * c.spend, 0);
    const ctr = t.spend > 0 ? weighted / t.spend : (t.clicks / t.impressions) * 100;
    const ev = `Spend-weighted CTR ${pct(ctr)}.`;
    if (ctr >= B.ctr_pct.good) return { status: 'strong', evidence: ev };
    if (ctr >= B.ctr_pct.weak) return { status: 'mixed', evidence: ev };
    return { status: 'weak', evidence: `${ev} Below ${B.ctr_pct.weak}% — creative or targeting isn't earning the click.` };
  },

  frequency_fatigue(ctx) {
    const meta = ctx.campaigns.filter(c => c.platform === 'Meta' && c.frequency != null && c.spend > 0);
    if (!meta.length) return { status: 'na', evidence: 'No Meta frequency data in period.' };
    const spend = meta.reduce((s, c) => s + c.spend, 0);
    const freq = meta.reduce((s, c) => s + c.frequency * c.spend, 0) / (spend || 1);
    const ev = `Spend-weighted Meta frequency ${freq.toFixed(1)} over the period.`;
    if (freq >= B.meta_frequency.broken) return { status: 'broken', evidence: `${ev} Above ${B.meta_frequency.broken} — the same people are being hit repeatedly; refresh creative or widen the audience.` };
    if (freq >= B.meta_frequency.weak) return { status: 'weak', evidence: `${ev} Creeping toward fatigue.` };
    return { status: 'healthy', evidence: ev };
  },

  spend_concentration(ctx) {
    const { campaigns, t } = ctx;
    if (t.spend <= 0 || campaigns.length < 2) return { status: 'na', evidence: 'Too few campaigns to judge concentration.' };
    const top = campaigns.slice().sort((a, b) => b.spend - a.spend)[0];
    const share = (top.spend / t.spend) * 100;
    if (share < B.spend_concentration_pct) return { status: 'healthy', evidence: `Spend is spread across ${campaigns.length} campaigns (largest takes ${pct(share)}).` };
    // Concentrated — fine if the big spender performs, a risk if it doesn't.
    const ev = `"${top.campaign}" (${top.platform}) takes ${pct(share)} of all spend`;
    if (top.roas != null && top.roas >= B.roas.weak) return { status: 'mixed', evidence: `${ev} but is carrying its weight (ROAS ${top.roas.toFixed(2)}x). Single point of failure if it fatigues.` };
    if (top.conversions <= 0) return { status: 'broken', score: 0.1, evidence: `${ev} and has zero conversions — budget concentrated on a non-performer.` };
    return { status: 'weak', evidence: `${ev} with weak return — rebalance toward proven campaigns.` };
  },

  spend_sufficiency(ctx) {
    const { t, days } = ctx;
    if (t.spend <= 0) return { status: 'na', evidence: 'No spend in period — nothing to score.' };
    const ev = `${gbp(t.spend)} spend over ${days} day(s).`;
    if (t.spend >= B.min_spend_for_judgement) return { status: 'healthy', evidence: ev };
    return { status: 'mixed', evidence: `${ev} Below ${gbp(B.min_spend_for_judgement)} — too thin to draw firm conclusions; treat findings as directional.` };
  },
};

function statusFromScore(s) {
  if (s == null) return 'na';
  if (s >= 0.8) return 'strong';
  if (s >= 0.6) return 'healthy';
  if (s >= 0.4) return 'mixed';
  if (s >= 0.2) return 'weak';
  return 'broken';
}

function daysBetween(snapshot) {
  const a = snapshot?.period_start, b = snapshot?.period_end;
  if (!a || !b) return null;
  const d = Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
  return Number.isFinite(d) && d > 0 ? d : null;
}

// Public — score a Strategist snapshot. Returns null score only when there's
// no ad data at all; otherwise a 0–100 score plus per-category findings.
function scoreSnapshot(snapshot) {
  const campaigns = normalizeCampaigns(snapshot);
  const t = totals(campaigns);
  const days = daysBetween(snapshot) || 7;
  const ctx = { campaigns, t, days };

  const categories = [];
  let weightedSum = 0, weightTotal = 0;

  for (const cat of rubric.categories) {
    const findings = [];
    for (const def of cat.checks) {
      const fn = CHECKS[def.id];
      if (!fn) continue;
      const r = fn(ctx);
      const score = r.score != null ? r.score : STATUS_SCORE[r.status];
      findings.push({ check: def.id, label: def.label, status: r.status, score, evidence: r.evidence });
    }
    const scored = findings.filter(f => f.score != null);
    const catScore = scored.length ? scored.reduce((s, f) => s + f.score, 0) / scored.length : null;
    const catStatus = statusFromScore(catScore);
    if (catScore != null) { weightedSum += catScore * cat.weight; weightTotal += cat.weight; }
    categories.push({ id: cat.id, label: cat.label, weight: cat.weight, score: catScore, status: catStatus, findings });
  }

  const score = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) : null;
  return {
    score,
    status: statusFromScore(score == null ? null : score / 100),
    confidence: t.spend >= rubric.benchmarks.min_spend_for_judgement && (daysBetween(snapshot) || 0) >= 7 ? 'high' : 'low',
    period: { start: snapshot?.period_start || null, end: snapshot?.period_end || null, days },
    totals: t,
    categories,
    attribution: rubric.attribution,
  };
}

module.exports = { scoreSnapshot, normalizeCampaigns };
