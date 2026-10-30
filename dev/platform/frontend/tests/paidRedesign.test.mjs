// The Paid redesign's three pieces of arithmetic and routing.
//
// Everything here was found by looking at a screenshot rather than by
// anything automatic, which is the expensive way: a duplicated total sat on
// the live platform until somebody read the same figure twice and asked why.
// Each case below is a thing that was wrong on screen, or would have been.

import test from 'node:test';
import assert from 'node:assert/strict';
import { showCombined } from '../src/utils/adsTotals.js';
import { briefSeedFor } from '../src/utils/competitorBrief.js';
import { resolvePaidTab } from '../src/utils/paidTabs.js';

// ── Combined · Google + Meta ──────────────────────────────────────────────
// The bug as it shipped: Falcon has a Meta ad account connected which spent
// nothing, and the strip tested "connected" rather than "spent".

test('a combined total needs both networks to have spent', () => {
  assert.equal(showCombined({ spend: 2853.94 }, { spend: 410.0 }), true);
});

test('a connected network that spent nothing is not a second source', () => {
  // This exact pair was on screen: Combined £2,853.94 above Google £2,853.94.
  assert.equal(showCombined({ spend: 2853.94 }, { spend: 0 }), false);
});

test('neither spending is not a combined total either', () => {
  assert.equal(showCombined({ spend: 0 }, { spend: 0 }), false);
});

test('a missing network total is treated as no spend, never as agreement', () => {
  assert.equal(showCombined({ spend: 2853.94 }, null), false);
  assert.equal(showCombined(null, { spend: 410 }), false);
  assert.equal(showCombined(undefined, undefined), false);
});

test('a network with clicks but no spend still does not make a blend', () => {
  // Impressions without spend happen on a paused campaign mid-period.
  assert.equal(showCombined({ spend: 100 }, { spend: 0, clicks: 42 }), false);
});

// ── Competitors → brief ───────────────────────────────────────────────────

const run = {
  query: 'rival.com',
  region: 'GB',
  ad_count: 24,
  analysis: {
    overview: 'They are leaning hard on free delivery.',
    angles: ['Free delivery over £50', 'Lifetime guarantee'],
    longest_running: ['The guarantee ad, 14 months'],
    counter_ideas: ['Lead on the repair service they do not offer'],
  },
};

test('the seed carries the research, not just a title', () => {
  const seed = briefSeedFor(run);
  assert.match(seed, /rival\.com \(GB\), 24 live ads/);
  assert.match(seed, /leaning hard on free delivery/);
  assert.match(seed, /- Free delivery over £50/);
  assert.match(seed, /- The guarantee ad, 14 months/);
  assert.match(seed, /- Lead on the repair service/);
});

test('the seed tells the model to differentiate rather than copy', () => {
  assert.match(briefSeedFor(run), /different position/);
});

test('an empty analysis seeds nothing at all', () => {
  // The failure this prevents: a pull that found nothing handing over a
  // header and an instruction, which reads like research that was done.
  assert.equal(briefSeedFor({ query: 'x', region: 'GB', ad_count: 0, analysis: {} }), '');
  assert.equal(briefSeedFor({ query: 'x', region: 'GB', ad_count: 0 }), '');
  assert.equal(briefSeedFor(null), '');
});

test('blank strings in a section do not become empty bullets', () => {
  const seed = briefSeedFor({
    query: 'x', region: 'GB', ad_count: 1,
    analysis: { overview: 'Something.', angles: ['', '   ', null] },
  });
  assert.doesNotMatch(seed, /^- *$/m);
  assert.doesNotMatch(seed, /Angles they are testing/);
});

test('a section present but empty does not print its heading', () => {
  const seed = briefSeedFor({
    query: 'x', region: 'GB', ad_count: 3,
    analysis: { angles: ['One real angle'], counter_ideas: [] },
  });
  assert.match(seed, /Angles they are testing/);
  assert.doesNotMatch(seed, /Counter-ad ideas/);
});

// ── Old links ─────────────────────────────────────────────────────────────

test('the tabs that were deleted all land somewhere', () => {
  assert.deepEqual(resolvePaidTab('health'), { tab: 'measure', openPlaybook: false });
  assert.deepEqual(resolvePaidTab('performance'), { tab: 'measure', openPlaybook: false });
  assert.deepEqual(resolvePaidTab('resize'), { tab: 'library', openPlaybook: false });
  assert.deepEqual(resolvePaidTab('pipeline'), { tab: 'brief', openPlaybook: false });
  assert.deepEqual(resolvePaidTab('creative'), { tab: 'brief', openPlaybook: false });
});

test('a playbook link opens the playbook, not just the page under it', () => {
  // Landing on Measure without the drawer would look like the playbook had
  // been deleted, which is the quiet breakage this whole table exists for.
  assert.deepEqual(resolvePaidTab('playbook'), { tab: 'measure', openPlaybook: true });
});

test('a tab that still exists is never redirected', () => {
  for (const t of ['measure', 'brief', 'concepts', 'render', 'approve', 'launch',
                   'library', 'audiences', 'competitor_ads']) {
    assert.equal(resolvePaidTab(t), null, `${t} should stay put`);
  }
});

// ── Stat tiles ────────────────────────────────────────────────────────────
// Leading with revenue put the largest figure in the feature tile, which is
// where a pre-existing overflow became visible: "£4,800.00" rendered as
// "£4,800." with the pence sliced off by the tile edge. A clipped number is
// worse than a small one, because it reads as a different, smaller number.
//
// This affects every StatStrip in the platform, not only Paid, so the buckets
// are pinned here rather than left to whoever next edits the CSS.

import { valueSizeClass } from '../src/utils/statValue.js';

test('a short value keeps the full display size', () => {
  assert.equal(valueSizeClass('3.70x'), '');
  assert.equal(valueSizeClass('2,700'), '');
  assert.equal(valueSizeClass('£1,200'), '');
});

test('a money figure with pence steps down rather than clipping', () => {
  // The exact value that was clipped on the live page.
  assert.equal(valueSizeClass('£4,800.00'), 'ds-stat__value--md');
  assert.equal(valueSizeClass('£1,008.00'), 'ds-stat__value--md');
});

test('a long figure steps down further', () => {
  assert.equal(valueSizeClass('£148,210.37'), 'ds-stat__value--sm');
  assert.equal(valueSizeClass('CHF 1,480,210.37'), 'ds-stat__value--xs');
});

test('an em dash and an empty value never blow up', () => {
  assert.equal(valueSizeClass('—'), '');
  assert.equal(valueSizeClass(null), '');
  assert.equal(valueSizeClass(undefined), '');
});

test('the buckets only ever shrink, never grow', () => {
  // A regression here would be a bucket that returns a *larger* class for a
  // shorter string, which would reintroduce clipping somewhere else.
  const order = ['', 'ds-stat__value--md', 'ds-stat__value--sm', 'ds-stat__value--xs'];
  let last = 0;
  for (let n = 1; n <= 20; n += 1) {
    const idx = order.indexOf(valueSizeClass('9'.repeat(n)));
    assert.ok(idx >= last, `length ${n} went back up the scale`);
    last = idx;
  }
});
