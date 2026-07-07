// Core Web Vitals via the Google PageSpeed Insights API (Integration B).
//
// PSI returns two useful things per URL: CrUX *field* data (real Chrome-user
// measurements, 28-day rolling) and a Lighthouse *lab* run. We prefer field
// data — page-level, then origin-level — and fall back to lab when a URL has
// too little real traffic to have field data. Replaces the CLS *heuristic* in
// agentReadiness.js with actual LCP / INP / CLS numbers.
//
// Tier-0 (API key only) — the AM pastes PAGESPEED_API_KEY in Settings; no
// OAuth. Degrades cleanly: unconfigured throws a friendly 503, never a crash.
// Methodology (thresholds, field-preferred) mined from claude-seo +
// seranking/seo-skills — see docs/omi/seo-skills-integration-plan.md.

const axios = require('axios');
const { getSetting } = require('../utils/settings');

const PSI_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

// Google's official Core Web Vitals thresholds. good ≤ first, poor > second.
const THRESHOLDS = {
  lcp:  { good: 2500, poor: 4000, unit: 'ms' },
  inp:  { good: 200,  poor: 500,  unit: 'ms' },
  cls:  { good: 0.1,  poor: 0.25, unit: '' },
  fcp:  { good: 1800, poor: 3000, unit: 'ms' },
  ttfb: { good: 800,  poor: 1800, unit: 'ms' },
};

function rate(metric, value) {
  const t = THRESHOLDS[metric];
  if (!t || value == null) return null;
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'needs-improvement';
  return 'poor';
}

async function isConfigured() {
  return !!(await getSetting('PAGESPEED_API_KEY'));
}

// CrUX field metrics block (loadingExperience / originLoadingExperience) → our
// shape. CrUX reports CLS as an integer ×100, so scale it back to the 0–1 score.
function fromField(le) {
  if (!le || !le.metrics) return null;
  const m = le.metrics;
  const p = (k) => (m[k] && m[k].percentile != null ? Number(m[k].percentile) : null);
  const lcp = p('LARGEST_CONTENTFUL_PAINT_MS');
  const inp = p('INTERACTION_TO_NEXT_PAINT') ?? p('EXPERIMENTAL_INTERACTION_TO_NEXT_PAINT');
  const clsRaw = p('CUMULATIVE_LAYOUT_SHIFT_SCORE');
  const cls = clsRaw != null ? clsRaw / 100 : null;
  const fcp = p('FIRST_CONTENTFUL_PAINT_MS');
  const ttfb = p('EXPERIMENTAL_TIME_TO_FIRST_BYTE');
  return {
    metrics: {
      lcp:  { value: lcp,  rating: rate('lcp', lcp) },
      inp:  { value: inp,  rating: rate('inp', inp) },
      cls:  { value: cls,  rating: rate('cls', cls) },
      fcp:  { value: fcp,  rating: rate('fcp', fcp) },
      ttfb: { value: ttfb, rating: rate('ttfb', ttfb) },
    },
    overall: le.overall_category ? le.overall_category.toLowerCase().replace('_', '-') : null,
  };
}

// Lighthouse lab fallback. INP has no lab equivalent — Total Blocking Time is
// the accepted lab proxy, flagged as such so the UI doesn't rate it as INP.
function fromLab(lh) {
  if (!lh || !lh.audits) return null;
  const a = lh.audits;
  const num = (id) => (a[id] && a[id].numericValue != null ? Number(a[id].numericValue) : null);
  const lcp = num('largest-contentful-paint');
  const cls = num('cumulative-layout-shift');
  const fcp = num('first-contentful-paint');
  const tbt = num('total-blocking-time');
  const ttfb = num('server-response-time');
  const score = lh.categories?.performance?.score != null ? Math.round(lh.categories.performance.score * 100) : null;
  return {
    metrics: {
      lcp:  { value: lcp,  rating: rate('lcp', lcp) },
      inp:  { value: tbt,  rating: null, note: 'Total Blocking Time — lab proxy for INP' },
      cls:  { value: cls,  rating: rate('cls', cls) },
      fcp:  { value: fcp,  rating: rate('fcp', fcp) },
      ttfb: { value: ttfb, rating: rate('ttfb', ttfb) },
    },
    performance_score: score,
  };
}

// Public — fetch Core Web Vitals for a URL. Returns { source, metrics, ... }
// where source is 'field' (this URL), 'origin' (whole site), or 'lab'.
async function fetchCoreWebVitals(url, { strategy = 'mobile' } = {}) {
  const key = await getSetting('PAGESPEED_API_KEY');
  if (!key) {
    const e = new Error('PageSpeed API key not set — add PAGESPEED_API_KEY in Settings to pull real Core Web Vitals.');
    e.status = 503; e.code = 'psi_unconfigured';
    throw e;
  }
  const { data } = await axios.get(PSI_URL, {
    params: { url, key, strategy, category: 'performance' },
    timeout: 60000,
  });

  const field = data.loadingExperience?.metrics ? fromField(data.loadingExperience) : null;
  const origin = data.originLoadingExperience?.metrics ? fromField(data.originLoadingExperience) : null;
  const lab = fromLab(data.lighthouseResult);
  const chosen = field ? { source: 'field', ...field }
              : origin ? { source: 'origin', ...origin }
              : lab   ? { source: 'lab', ...lab }
              : { source: 'none', metrics: {} };

  return {
    url,
    strategy,
    fetched_at: new Date().toISOString(),
    source: chosen.source,
    overall: chosen.overall ?? null,
    // Always surface the lab performance score when we have it, regardless of
    // which source drove the CWV metrics.
    performance_score: lab?.performance_score ?? chosen.performance_score ?? null,
    metrics: chosen.metrics || {},
  };
}

module.exports = { isConfigured, fetchCoreWebVitals, THRESHOLDS };
