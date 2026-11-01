// Database → Publications: a table, a modal, and a delete you have to type.
//
// The button that mattered read "Delete all 2000 matching" and sat behind a
// window.confirm(), one Return away from detaching every journalist and every
// coverage entry attached to 2,000 publications. It also lied: the list drew
// 500, so a click deleted 1,500 rows nobody had looked at.
//
// The screen-level claims are driven in a browser. These guards hold the parts
// that a drive cannot see going wrong quietly.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

const page = read('src/pages/SettingsPage.jsx');
const confirmUi = read('src/components/ui/DangerConfirm.jsx');
const panel = page.slice(page.indexOf('function PublicationsPanel'), page.indexOf('function OutletEditModal'));
assert.ok(panel.length > 2000, 'the panel is still where this test looks');

ok('no bulk delete runs from a confirm()', () => {
  // The single-row delete keeps its confirm: one publication, named, is a
  // different risk from five hundred.
  assert.ok(!/confirm\(`Delete ALL/.test(panel));
  assert.ok(!/confirm\(`Delete \$\{selected\.size\}/.test(panel));
  assert.ok(/setPendingDelete\(/.test(panel), 'both go through the typed dialog');
  const asks = (panel.match(/setPendingDelete\(\{/g) || []).length;
  assert.strictEqual(asks, 2, 'selected, and all shown');
});

ok('the bulk delete only ever sends rows the list drew', () => {
  const fn = panel.slice(panel.indexOf('function askDeleteAllMatching'), panel.indexOf('async function runPendingDelete'));
  assert.ok(/visibleOutlets\.slice\(0, 500\)/.test(fn),
    'the old version mapped every matching row, including the ones off the page');
  assert.ok(/left alone/.test(fn), 'and says what it is leaving behind');
});

ok('the button names what it deletes, not what matches', () => {
  assert.ok(/Delete all \{shownCount\.toLocaleString\(\)\} shown/.test(panel));
  assert.ok(!/matching\s*\n?\s*<\/button>/.test(panel));
});

ok('the confirm needs the count typed, and Return alone does nothing', () => {
  assert.ok(/const armed = typed\.trim\(\) === expected/.test(confirmUi));
  assert.ok(/disabled=\{!armed \|\| busy\}/.test(confirmUi), 'the button stays dead until it matches');
  assert.ok(/if \(armed && !busy\) onConfirm\(\)/.test(confirmUi),
    'submit must re-check: Return in the field submits the form');
  assert.ok(/const expected = String\(count\)/.test(confirmUi),
    'the word to type is the count, which cannot be muscle memory');
});

ok('it says what else the delete touches', () => {
  assert.ok(/detached, not deleted/.test(panel));
  // Matched inside the rendered element, not anywhere in the file: the first
  // version matched this component's own header comment, so deleting the
  // warning from the dialog left the guard passing.
  const body = confirmUi.slice(confirmUi.indexOf('return ('));
  assert.ok(/This cannot be undone\./.test(body), 'the dialog itself says so');
});

ok('the record opens as a modal, not an embedded pane', () => {
  assert.ok(!/embedded\s*$/m.test(panel), 'no embedded OutletEditModal');
  assert.ok(/<OutletEditModal\b/.test(panel));
  assert.ok(!/ListDetail/.test(page), 'the picker rail is gone from this page entirely');
});

ok('the list is a table with a column per fact', () => {
  for (const col of ['Publication', 'Tier', 'Coverage', 'Journalists', 'Region', 'Feed']) {
    assert.ok(panel.includes(`>${col}<`), `${col} has its own column`);
  }
  assert.ok(/<table className="table">/.test(panel));
});

ok('the page title is the section, not the word Settings', () => {
  // One component serves Settings, Database and Biz dev. Publications read
  // "Settings / Publications" a year after it stopped being a setting.
  assert.ok(/const sectionTitle = sectionForPath\(location\.pathname\)\?\.title \|\| 'Settings'/.test(page));
  assert.ok(/<h1 className="display">\{sectionTitle\}<\/h1>/.test(page));
  assert.ok(/<ScreenHeading title=\{sectionTitle\} \/>/.test(page),
    'otherwise the screen name is compared against the wrong title and hides itself');
  assert.ok(!/<h1 className="display">Settings<\/h1>/.test(page));
});

ok('Publications is a Database screen, which is what the title now reads from', () => {
  const sections = read('src/nav/sections.js');
  const db = sections.slice(sections.indexOf('  database: {'), sections.indexOf('  bizdev: {'));
  assert.ok(/tab: 'publications'/.test(db));
  assert.ok(/title: 'Database'/.test(db));
});

console.log(`publications    ✓ ${passed} assertions passed`);
