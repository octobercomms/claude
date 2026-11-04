// GTM Brain Phase 2 — outcome reader tests.
//
//   node tests/strategist-outcome.test.js

const assert = require('assert');
const { extractMetric } = require('../src/services/strategist/outcome');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// ── Paid ────────────────────────────────────────────────────────────

console.log('extractMetric — paid');

const paidData = {
  ads: {
    totals: { spend: 5000, revenue: 15000, clicks: 2400, imps: 80000, convs: 120, roas: 3.0 },
    campaigns: [],
  },
  has_data: true,
};

check('paid:roas', () => {
  assert.strictEqual(extractMetric('paid:roas', paidData), 3.0);
});

check('paid:spend', () => {
  assert.strictEqual(extractMetric('paid:spend', paidData), 5000);
});

check('paid:revenue', () => {
  assert.strictEqual(extractMetric('paid:revenue', paidData), 15000);
});

check('paid:clicks', () => {
  assert.strictEqual(extractMetric('paid:clicks', paidData), 2400);
});

check('paid:conversions reads from convs field', () => {
  assert.strictEqual(extractMetric('paid:conversions', paidData), 120);
});

check('paid:cpa computes spend / convs', () => {
  const val = extractMetric('paid:cpa', paidData);
  assert.ok(Math.abs(val - 41.6667) < 0.01, `expected ~41.67, got ${val}`);
});

check('paid:cpa returns null when convs is zero', () => {
  const zeroCpa = { ads: { totals: { spend: 1000, convs: 0 } }, has_data: true };
  assert.strictEqual(extractMetric('paid:cpa', zeroCpa), null);
});

check('paid:roas returns null when roas is null', () => {
  const noRoas = { ads: { totals: { spend: 0, revenue: 0, roas: null } }, has_data: true };
  assert.strictEqual(extractMetric('paid:roas', noRoas), null);
});

// ── Earned ──────────────────────────────────────────────────────────

console.log('\nextractMetric — earned');

const earnedData = {
  stats: { published: 14, tracked: 38, journalists: 22 },
  funnel: { pitched: 30, published: 10, download: 4, declined: 5, in_review: 3 },
  journalists: [
    { name: 'A', tier: 1, published: 5, pitched: 8 },
    { name: 'B', tier: 2, published: 3, pitched: 4 },
    { name: 'C', tier: 1, published: 2, pitched: 3 },
    { name: 'D', tier: 3, published: 1, pitched: 2 },
  ],
  has_data: true,
};

check('earned:published', () => {
  assert.strictEqual(extractMetric('earned:published', earnedData), 14);
});

check('earned:journalist_count', () => {
  assert.strictEqual(extractMetric('earned:journalist_count', earnedData), 22);
});

check('earned:pitch_conversion (% of pitched that published)', () => {
  // (10 + 4) / 30 = 46.67, rounded to 47
  assert.strictEqual(extractMetric('earned:pitch_conversion', earnedData), 47);
});

check('earned:pitch_conversion returns null when nothing pitched', () => {
  const none = { funnel: { pitched: 0 }, has_data: true };
  assert.strictEqual(extractMetric('earned:pitch_conversion', none), null);
});

check('earned:tier1_placements sums published from tier 1 journalists', () => {
  assert.strictEqual(extractMetric('earned:tier1_placements', earnedData), 7);
});

check('earned:tier1_placements returns 0 with no tier 1', () => {
  const noTier1 = { journalists: [{ tier: 2, published: 5 }], has_data: true };
  assert.strictEqual(extractMetric('earned:tier1_placements', noTier1), 0);
});

// ── Shared ──────────────────────────────────────────────────────────

console.log('\nextractMetric — shared');

const sharedData = {
  totals: { posts: 24, reach: 45000, interactions: 1200, avg_engagement_rate: 3.2 },
  has_data: true,
};

check('shared:engagement_rate', () => {
  assert.strictEqual(extractMetric('shared:engagement_rate', sharedData), 3.2);
});

check('shared:reach', () => {
  assert.strictEqual(extractMetric('shared:reach', sharedData), 45000);
});

check('shared:posts', () => {
  assert.strictEqual(extractMetric('shared:posts', sharedData), 24);
});

// ── Owned ───────────────────────────────────────────────────────────

console.log('\nextractMetric — owned');

const ownedData = {
  kpis: { tracked: 50, ranking: 42, top10: 18, top3: 7, aio_present: 20, aio_cited: 8, aio_coverage: 40 },
  audit: { score: 82, pages_crawled: 150, total_issues: 23 },
  authority: { moz_da: 34, referring_domains: 120 },
  has_data: true,
};

check('owned:top10', () => {
  assert.strictEqual(extractMetric('owned:top10', ownedData), 18);
});

check('owned:top3', () => {
  assert.strictEqual(extractMetric('owned:top3', ownedData), 7);
});

check('owned:audit_score', () => {
  assert.strictEqual(extractMetric('owned:audit_score', ownedData), 82);
});

check('owned:domain_authority', () => {
  assert.strictEqual(extractMetric('owned:domain_authority', ownedData), 34);
});

check('owned:aio_citation_rate', () => {
  assert.strictEqual(extractMetric('owned:aio_citation_rate', ownedData), 40);
});

check('owned:audit_score returns null when no audit', () => {
  const noAudit = { kpis: { top10: 5 }, audit: null, authority: null, has_data: true };
  assert.strictEqual(extractMetric('owned:audit_score', noAudit), null);
});

check('owned:domain_authority returns null when no authority', () => {
  const noAuth = { kpis: { top10: 5 }, audit: null, authority: null, has_data: true };
  assert.strictEqual(extractMetric('owned:domain_authority', noAuth), null);
});

// ── Cross ───────────────────────────────────────────────────────────

console.log('\nextractMetric — cross');

check('cross:revenue returns null (handled separately)', () => {
  assert.strictEqual(extractMetric('cross:revenue', {}), null);
});

check('cross:orders returns null (handled separately)', () => {
  assert.strictEqual(extractMetric('cross:orders', {}), null);
});

// ── Edge cases ──────────────────────────────────────────────────────

console.log('\nextractMetric — edge cases');

check('unknown ref returns null', () => {
  assert.strictEqual(extractMetric('paid:nonsense', paidData), null);
  assert.strictEqual(extractMetric('unknown:metric', paidData), null);
});

check('null data returns null', () => {
  assert.strictEqual(extractMetric('paid:roas', null), null);
  assert.strictEqual(extractMetric('paid:roas', undefined), null);
});

check('empty data returns null', () => {
  assert.strictEqual(extractMetric('paid:roas', {}), null);
  assert.strictEqual(extractMetric('paid:spend', { ads: {} }), null);
  assert.strictEqual(extractMetric('shared:reach', { totals: {} }), null);
});

check('NaN or Infinity returns null', () => {
  const badData = { ads: { totals: { roas: NaN } }, has_data: true };
  assert.strictEqual(extractMetric('paid:roas', badData), null);
  const infData = { ads: { totals: { roas: Infinity } }, has_data: true };
  assert.strictEqual(extractMetric('paid:roas', infData), null);
});

check('zero is a valid value, not null', () => {
  const zeroData = { ads: { totals: { spend: 0, clicks: 0, convs: 0, roas: 0 } }, has_data: true };
  assert.strictEqual(extractMetric('paid:spend', zeroData), 0);
  assert.strictEqual(extractMetric('paid:clicks', zeroData), 0);
});

check('string numbers are coerced', () => {
  const strData = { totals: { posts: '24', reach: '45000' }, has_data: true };
  assert.strictEqual(extractMetric('shared:posts', strData), 24);
  assert.strictEqual(extractMetric('shared:reach', strData), 45000);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
