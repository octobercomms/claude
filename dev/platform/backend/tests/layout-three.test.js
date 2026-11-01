// Three layout notes off the 31 October review.
//
// Each is a reading of a short note rather than a spec, so what these guards
// hold is the decision, not the pixel: if the reading was wrong the fix is
// cheap, and if the reading was right it should not quietly revert.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

const css = read('src/index.css');

// ── Shared → Create: options fill the width, unpicked ones are grey ─────────

ok('every option row on Create fills the width', () => {
  const social = read('src/pages/ClientSocialPage.jsx');
  const form = social.slice(social.indexOf('function BriefForm({ clientId, brief'), social.indexOf('function BriefForm({ clientId, brief') + 6000);
  const rows = (form.match(/className="opt-row"/g) || []).length;
  assert.strictEqual(rows, 3, 'how many posts, post length, platforms');
  assert.ok(!/display: 'flex', gap: 'var\(--s2\)', flexWrap: 'wrap' \}\}>\n\s+\{\[1, 2, 3/.test(form),
    'the content-width pill rows are gone');
});

ok('an unpicked option looks like a button you could press', () => {
  const rule = css.slice(css.indexOf('.opt-row .tab:not(.active) {'), css.indexOf('.opt-row .tab:not(.active):hover'));
  assert.ok(/background: var\(--surface-sunken\)/.test(rule), 'a grey surface');
  assert.ok(/border-color: var\(--card-border\)/.test(rule), 'and a border');
  // .tab's own resting state is transparent with a transparent border, which
  // is why the unpicked ones read as labels.
  assert.ok(/\.tab \{[^}]*border: var\(--border-w\) solid transparent/.test(css));
});

ok('and the row collapses rather than making seven 40px buttons', () => {
  assert.ok(/\.opt-row \{ grid-auto-flow: row; grid-template-columns: repeat\(auto-fit, minmax\(84px, 1fr\)\)/.test(css));
  // @container, not @media. The nav panel takes 170px of the viewport, so a
  // viewport query collapses this row while the content box is still wide —
  // which is the rule containerQueries.test.mjs exists to hold, and which
  // both of these queries broke on the first pass.
  const i = css.indexOf('.opt-row { grid-auto-flow: row');
  assert.ok(/@container appmain \(max-width: 760px\)/.test(css.slice(Math.max(0, i - 300), i)));
});

// ── Earned → Releases: the way out is above the box ─────────────────────────

ok('"All releases" is drawn by the page, not by the editor', () => {
  const pr = read('src/pages/ClientPRPage.jsx');
  const editor = read('src/components/PressReleaseEditor.jsx');
  assert.ok(/← All releases/.test(pr), 'the page draws it');
  assert.ok(!/← All releases/.test(editor), 'and the editor does not, or there are two');
  // Above the card, not inside it: a way out drawn inside the thing it leaves
  // reads as part of the record.
  const block = pr.slice(pr.indexOf('const renderReleases ='), pr.indexOf('const renderReleases =') + 1200);
  const link = block.indexOf('← All releases');
  const card = block.indexOf('<div className="card">');
  assert.ok(link > 0 && card > 0 && link < card, 'the link comes before the card opens');
});

ok('and it still goes back', () => {
  const pr = read('src/pages/ClientPRPage.jsx');
  const block = pr.slice(pr.indexOf('const renderReleases ='), pr.indexOf('const renderReleases =') + 1200);
  assert.ok(/setPr\(null\); loadReleases\(\);/.test(block));
});

// ── Shared → Hook vault: 75/25 ──────────────────────────────────────────────

ok('the vault is three quarters and the explanation one', () => {
  assert.ok(/\.hookvault \{ display: grid/.test(css));
  assert.ok(/grid-template-columns: minmax\(0, 3fr\) minmax\(0, 1fr\)/.test(css), '3fr to 1fr is 75/25');
  const panel = read('src/components/social/HookVaultPanel.jsx');
  assert.ok(/className="hookvault__main"/.test(panel));
  assert.ok(/className="hookvault__rail"/.test(panel));
});

ok('the explanation moved into the rail rather than being deleted', () => {
  const panel = read('src/components/social/HookVaultPanel.jsx');
  const rail = panel.slice(panel.indexOf('hookvault__rail'));
  for (const phrase of ['A hook is the first line of a post',
    'Those two numbers are different claims',
    'Reusing a hook is not reusing the post']) {
    assert.ok(rail.includes(phrase), `the rail still says: ${phrase}`);
  }
  const main = panel.slice(panel.indexOf('hookvault__main'), panel.indexOf('hookvault__rail'));
  assert.ok(!main.includes('A hook is the first line of a post'), 'and it is not in both');
});

ok('it stacks before the rail gets too narrow to read', () => {
  const block = css.slice(css.indexOf('.hookvault { display: grid'), css.indexOf('.hookvault__main { min-width: 0; }'));
  assert.ok(/@container appmain \(min-width: 1000px\)/.test(block),
    'one column until the CONTENT box is wide enough, not the viewport: the nav takes 170px of it');
  assert.ok(/grid-template-columns: minmax\(0, 1fr\)/.test(block), 'and one column is the default');
  assert.ok(/\.hookvault__main \{ min-width: 0; \}/.test(css), 'so the list can shrink instead of pushing the page wide');
});

ok('the vault search box takes three quarters of its row', () => {
  const list = read('src/components/social/HookVaultList.jsx');
  assert.ok(/className="filter-row"/.test(list));
  assert.ok(!/className="input" style=\{\{ flex: 1 \}\}/.test(list),
    'flex: 1 loses to .select width:100%, which is how the box became a 40px square');
  assert.ok(/\.filter-row \{ display: grid; grid-template-columns: minmax\(0, 3fr\) minmax\(0, 1fr\)/.test(css));
});

ok('and it is not called search-row, which is already taken', () => {
  // .search-row is the global palette's result row, 1,400 lines down this
  // file, and it sets display:flex. The collision cost nothing only because
  // the drive measured the columns instead of trusting the class name.
  const palette = css.indexOf('.search-row {');
  assert.ok(palette > 0, 'the palette rule is still there');
  assert.ok(/\.search-row \{[^}]*display: flex/.test(css.slice(palette, palette + 200))
    || /\.search-row \{\s*\n[^}]*flex/.test(css.slice(palette, palette + 300)),
    'and it is still a flex row, which is why the name could not be shared');
  const list = read('src/components/social/HookVaultList.jsx');
  assert.ok(!/className="search-row"/.test(list));
});

console.log(`layout-three    ✓ ${passed} assertions passed`);
