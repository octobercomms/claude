// Earned → Results: one emphasised tile, and not a black one.
//
// The screen renders two stat rows one under the other, and each had a black
// slab in it: "new referring domains" in the attribution row and "🔥 warm" in
// the engagement row. Two dark tiles in one view emphasise nothing, and the
// screen reads as a page of black blocks.
//
// Worse, the emphasis was on the wrong figure. The line under the attribution
// row calls "from outlets you pitched" the defensible number, so the screen
// shouted about the figure it then told you to discount.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

const detail = read('src/components/PressCampaignDetail.jsx');
const analytics = read('src/components/PressCampaignAnalytics.jsx');
const strip = read('src/components/shells/StatStrip.jsx');
const css = read('src/index.css');

// The attribution row, which is the one Daniel screenshotted.
const row = detail.slice(detail.indexOf("label: 'new referring domains'"), detail.indexOf("label: 'emailed so far'"));
assert.ok(row.length > 100, 'the attribution strip is still where this test looks');

ok('no black tile on either of the two rows Results shows at once', () => {
  assert.ok(!/feature:/.test(row), 'the attribution row must not feature a tile');
  const eng = analytics.slice(analytics.indexOf("label: 'recipients'"), analytics.indexOf("label: 'unsubscribed'"));
  assert.ok(!/feature:/.test(eng), 'the engagement row must not feature a tile');
});

ok('the emphasis is on the defensible number, and only there', () => {
  const accents = (row.match(/accent:/g) || []).length;
  assert.strictEqual(accents, 1, 'exactly one emphasised tile in the row');
  const pitched = row.slice(row.indexOf("label: 'from outlets you pitched'"));
  assert.ok(/accent: true/.test(pitched), 'it is the tile the copy calls defensible');
  // And the figure it emphasises is still the one the label names.
  assert.ok(/value: attribution\.pitched_rds/.test(pitched));
});

ok('warm carries no emphasis, so the whole screen has exactly one', () => {
  // Found by driving the screen rather than reading the diff: warm was
  // emphasised too, so Results showed two emphasised tiles and emphasised
  // nothing. Per-row checks cannot see this; the screen renders both rows.
  const warm = analytics.slice(analytics.indexOf("label: '🔥 warm'"), analytics.indexOf("label: 'unsubscribed'"));
  assert.ok(!/accent:/.test(warm), 'the one emphasis belongs to the attribution row');
  assert.ok(!/feature:/.test(warm));
});

ok('the accent tile keeps black ink', () => {
  const rule = css.slice(css.indexOf('.ds-stat--accent'), css.indexOf('.ds-stat--accent') + 200);
  assert.ok(/border-color: var\(--accent\)/.test(rule));
  assert.ok(/background: var\(--accent-soft\)/.test(rule));
  assert.ok(!/color:\s*#fff/.test(rule),
    'the accent is #E7CD41, about 1.7:1 on white — unreadable as a number');
});

ok('the black feature tile still exists for the screens that use it', () => {
  // Twelve other screens render one. This change is Results-only.
  assert.ok(/\.ds-stat--feature \{ background: var\(--text\)/.test(css));
  assert.ok(/s\.feature \? 'ds-stat--feature' : ''/.test(strip));
});

ok('a tile cannot be both, and feature wins', () => {
  assert.ok(/s\.accent && !s\.feature \? 'ds-stat--accent' : ''/.test(strip),
    'two emphasis classes on one tile would fight over the background');
});

console.log(`earned-results  ✓ ${passed} assertions passed`);
