// The Paid redesign's three pieces of arithmetic and routing.
//
// Everything here was found by looking at a screenshot rather than by
// anything automatic, which is the expensive way: a duplicated total sat on
// the live platform until somebody read the same figure twice and asked why.
// Each case below is a thing that was wrong on screen, or would have been.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { showCombined } from '../src/utils/adsTotals.js';
import { briefSeedFor } from '../src/utils/competitorBrief.js';
import { resolvePaidTab } from '../src/utils/paidTabs.js';
import { SECTIONS, tabsOf } from '../src/nav/sections.js';

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
  // Resize is a screen of its own now and the library is gone, so the
  // redirect runs the other way. 'resize' is covered by the derived
  // live-tabs test below, which is the point of deriving it.
  assert.deepEqual(resolvePaidTab('library'), { tab: 'resize', openPlaybook: false });
  assert.deepEqual(resolvePaidTab('pipeline'), { tab: 'brief', openPlaybook: false });
  assert.deepEqual(resolvePaidTab('creative'), { tab: 'brief', openPlaybook: false });
});

test('a playbook link opens the playbook, not just the page under it', () => {
  // Landing on Measure without the drawer would look like the playbook had
  // been deleted, which is the quiet breakage this whole table exists for.
  assert.deepEqual(resolvePaidTab('playbook'), { tab: 'measure', openPlaybook: true });
});

test('a tab that still exists is never redirected', () => {
  // Derived from the panel rather than listed here. This was a hardcoded
  // array and it went stale the moment Approve stopped being a step: the
  // test went on asserting that 'approve' must not redirect, which is the
  // opposite of what the change needed. A list that cannot drift from
  // sections.js cannot make that mistake again.
  for (const t of tabsOf(SECTIONS.paid)) {
    assert.equal(resolvePaidTab(t), null, `${t} should stay put`);
  }
});

test('the redirect is fed the raw slug, not the resolved tab', () => {
  // The table was correct and wired to the wrong input for months. useScreen
  // maps an unknown slug to the section default before the page renders, so
  // resolvePaidTab(tab) only ever saw 'measure' and not one of these
  // redirects fired: /ads/playbook showed Measure with no drawer, /ads/resize
  // never reached the library, and the dead slug stayed in the address bar.
  //
  // Every unit test here passed throughout, because they call the table
  // directly with the alias. This one reads the call site instead, which is
  // the only part that was ever wrong.
  const page = readFileSync(new URL('../src/pages/ClientAdsPage.jsx', import.meta.url), 'utf8');
  // Comments stripped first. The note above that call site quotes the broken
  // version verbatim, and without this the test reads the explanation of the
  // bug and reports the bug — which it duly did on the first run.
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const call = code.match(/resolvePaidTab\(([^)]*)\)/);
  assert.ok(call, 'ClientAdsPage no longer calls resolvePaidTab at all');
  assert.notEqual(call[1].trim(), 'tab',
    'resolvePaidTab must be given the raw URL slug; `tab` has already been resolved');
  assert.match(code, /screen: rawScreen/,
    'the raw slug has to come off useParams for this to be possible');
});

test('the retired steps land somewhere rather than nowhere', () => {
  // Approve was step 4 until it became a header button. Its URL is in
  // bookmarks and in at least one sent email, and a deep link that resolves
  // to nothing reads as the feature having been deleted.
  assert.deepEqual(resolvePaidTab('approve'), { tab: 'launch', openPlaybook: false });
  assert.ok(!tabsOf(SECTIONS.paid).includes('approve'), 'and it is genuinely gone from the panel');
  // The Paid library went the same way. Resize only ever hung off it, so
  // without a row of its own it would have become unreachable — the exact
  // failure sections.js warns about three times over.
  assert.ok(!tabsOf(SECTIONS.paid).includes('library'), 'the Paid library is gone from the panel');
  assert.ok(tabsOf(SECTIONS.paid).includes('resize'), 'and Resize has a row of its own');
});

// ── Stat tiles ────────────────────────────────────────────────────────────
// Leading with revenue put the largest figure in the feature tile, which is
// where a pre-existing overflow became visible: "£4,800.00" rendered as
// "£4,800." with the pence sliced off by the tile edge. A clipped number is
// worse than a small one, because it reads as a different, smaller number.
//
// This affects every StatStrip in the platform, not only Paid, so the buckets
// are pinned here rather than left to whoever next edits the CSS.

import { valueSizeClass, rowSizeClass } from '../src/utils/statValue.js';

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

// ─── one size per row ───────────────────────────────────────────────────────
//
// Sizing each tile on its own length fixed the clipping and broke the row.
// Measure showed £70,271 at 30px beside 332, 30,791 and 1.08% at 40px, which
// Daniel read as a rendering fault: *"can you make the font size the same
// across them all?"*. The row is now sized by its longest value, which keeps
// the anti-clipping property and loses the ragged look.

test('a whole row renders at one size, set by its longest value', () => {
  // The live Measure row, in order.
  const measure = ['£70,271', '332', '£212', '30,791', '26,947', '1.08%'];
  assert.equal(rowSizeClass(measure), 'ds-stat__value--md');
  // And that is the size the longest of them needs on its own, so nothing clips.
  assert.equal(rowSizeClass(measure), valueSizeClass('£70,271'));
});

test('one long value pulls the whole row down with it', () => {
  // The alternative is that value clipping while its neighbours stay large.
  assert.equal(rowSizeClass(['332', 'CHF 1,480,210.37']), 'ds-stat__value--xs');
});

test('a row of short values keeps the full display size', () => {
  assert.equal(rowSizeClass(['332', '£212', '1.08%']), '');
});

test('an empty row, and a row of nothing, do not blow up', () => {
  assert.equal(rowSizeClass([]), '');
  assert.equal(rowSizeClass([null, undefined]), '');
  assert.equal(rowSizeClass(), '');
});

test('order does not change the answer', () => {
  // It reduces over the row, so the longest wins wherever it sits. A version
  // that took the first or the last would depend on tile order, which pages
  // change freely.
  const a = rowSizeClass(['£70,271', '332', '1.08%']);
  const b = rowSizeClass(['1.08%', '£70,271', '332']);
  const c = rowSizeClass(['332', '1.08%', '£70,271']);
  assert.equal(a, b);
  assert.equal(b, c);
});

test('the strip asks for one size and gives it to every tile', () => {
  // The component is where the two could still drift apart: computing a row
  // size and then rendering per-tile classes would pass every test above.
  const src = readFileSync(new URL('../src/components/shells/StatStrip.jsx', import.meta.url), 'utf8');
  assert.match(src, /rowSizeClass\(items\.map\(/,
    'StatStrip no longer derives one size from the whole row');
  assert.doesNotMatch(src, /valueSizeClass\(/,
    'StatStrip is sizing a tile from its own value again, which is the ragged row');
  assert.match(src, /ds-stat__value \$\{size\}/,
    'the row size is computed but not applied to the tiles');
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
