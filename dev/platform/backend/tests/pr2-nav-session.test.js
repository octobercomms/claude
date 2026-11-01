// PR 2 of the review plan: every route and slug move, in one pass.
//
// Six changes agreed with Daniel on 1 November. They are together because
// they all edit nav/sections.js and the route table, and six separate passes
// would mean six chances to leave a dead link — a class this repo has
// shipped six of in a single commit.
//
// The unit suite already owns the structural checks (routeTargets.test.mjs
// proved its worth here by catching two dead links in this very change, and
// sectionPanel.test.mjs covers row/tab agreement). This file guards the
// decisions themselves, the ones a future edit could quietly undo without
// breaking anything.
//
// The behavioural verification is dev/platform/drives/drive-pr2.mjs: 27
// assertions against the built app, including that the kebab really is
// inside the page header and that an old /improve link still lands.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
const stripComments = (src) => src
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const sections = read('src/nav/sections.js');
const code = stripComments(sections);
const app = stripComments(read('src/App.jsx'));
const settings = stripComments(read('src/pages/SettingsPage.jsx'));
const social = stripComments(read('src/pages/ClientSocialPage.jsx'));
const convert = stripComments(read('src/pages/ClientConvertPage.jsx'));
const outreach = stripComments(read('src/pages/ClientOutreachPage.jsx'));
const tools = stripComments(read('src/components/database/RecordTools.jsx'));

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

// ── 1. Shared: Create group becomes Make ─────────────────────────────────
ok('the Shared group is Make, and no group repeats a row inside it', () => {
  assert.ok(/{ heading: 'Make', rows: \[\s*\n\s*{ tab: 'brainstorm'/.test(code),
    'the Shared group heading is Make');
  // The rule the rename is an instance of: a group must not share its name
  // with a row it contains. That is what "we have 2 creates" meant.
  const groups = [...sections.matchAll(/{ heading: '([^']+)', rows: \[([\s\S]*?)\n      \] }/g)];
  assert.ok(groups.length >= 10, `found the groups (${groups.length})`);
  // Known, and left alone on purpose: Dashboard has a Setup group holding a
  // Setup row. Writing this rule found it, which is the rule earning its
  // keep — but renaming a screen is Daniel's call, not something to slip in
  // while he is out. Flagged for him; the rule stays live for new ones.
  const KNOWN = new Set(['Setup']);
  const found = [];
  for (const [, heading, body] of groups) {
    const labels = [...body.matchAll(/label: '([^']+)'/g)].map(m => m[1]);
    if (labels.includes(heading) && !KNOWN.has(heading)) found.push(heading);
  }
  assert.deepStrictEqual(found, [],
    `a group contains a row of the same name: ${found.join(', ')}`);
});

// ── 2. Outreach is a group inside Convert ────────────────────────────────
//
// Corrected 1 November, after the first version promoted Email to a section
// of its own: "it isnt meant to have its own top level nav, its meant to be a
// section heading inside convert". The promotion also shipped with no entry
// in the nav rail, so for a few hours the five screens had a route, a panel
// and no door. That rule now lives in sectionPanel.test.mjs, where it applies
// to every section rather than to this one.
ok('Outreach is a group inside Convert, with five rows', () => {
  const sec = code.slice(code.indexOf('  convert: {'), code.indexOf('  produce: {'));
  assert.ok(/{ heading: 'Outreach', rows: \[/.test(sec), 'the group is headed Outreach');
  const labels = [...sec.matchAll(/label: '([^']+)'/g)].map(m => m[1]);
  assert.deepStrictEqual(labels,
    ['Optimise', 'Forms', 'Campaigns', 'Prospects', 'Tasks', 'Sending', 'Find leads'],
    'Convert carries its own two, then the five under Outreach');
  assert.ok(/slug: 'prospects'/.test(sec), 'Prospects rather than Leads, slug and all');
  assert.ok(/slug: 'find-leads'/.test(sec), 'and Find leads rather than Selective outreach');
});

ok('there is no Email section, and no route that would orphan one', () => {
  assert.ok(!/^  email: \{/m.test(code), 'no top-level Email section');
  assert.ok(!/clients\/:id\/email/.test(app), 'and no route left pointing at one');
  assert.ok(/ClientOutreachPage/.test(convert), 'Convert renders the outreach screens');
  assert.ok(!/convert\/:screen\?\/:sub\?/.test(app), 'the :sub? segment is still gone');
});

ok('nothing builds an Outreach path by hand', () => {
  // The old version navigated with a template the route guard could not
  // read, which is how a link rots unseen. The parent owns the mapping.
  assert.ok(!/\/email\/\$\{SLUG/.test(outreach), 'no hand-built slug path');
  assert.ok(/onScreen \|\| \(\(\) => \{\}\)/.test(outreach), 'it calls the parent instead');
  assert.ok(/onScreen=\{setTab\}/.test(convert), 'and the parent passes useScreen\'s setter');
});

ok('each Outreach screen says what it produces', () => {
  const map = convert.slice(convert.indexOf('OUTREACH_PRODUCES'), convert.indexOf('export default'));
  for (const k of ['campaigns', 'contacts', 'tasks', 'sending', 'prospecting']) {
    assert.ok(new RegExp(`${k}:`).test(map), `${k} has a line`);
  }
  // A line that describes the screen rather than its output is the thing
  // this item existed to fix, so each one has to name a noun you end up with.
  assert.ok(/You end up with a list of who/.test(map), 'and they name the output');
});

// ── 3. Improve folds into Learn ──────────────────────────────────────────
ok('Improve is off the nav and renders inside Learn', () => {
  const measure = code.slice(code.indexOf("{ heading: 'Measure'"), code.indexOf("  owned: {"));
  assert.ok(!/tab: 'audit'/.test(measure), 'the Improve row is gone');
  const labels = [...measure.matchAll(/label: '([^']+)'/g)].map(m => m[1]);
  assert.deepStrictEqual(labels, ['Review', 'Learn', 'Hook vault', 'Compare'],
    'Measure is four rows');
  assert.ok(!/socialTab === 'audit'/.test(social), 'and no screen renders it alone');
  const learn = social.slice(social.indexOf('const renderLearn'), social.indexOf('const renderCompare'));
  assert.ok(/<SocialAuditPanel clientId=\{id\} \/>/.test(learn), 'it renders inside Learn');
});

// ── 4. Settings: Models under Costs ──────────────────────────────────────
ok('Models sits under Costs, and Connections keeps only credentials', () => {
  const costs = code.slice(code.indexOf("{ heading: 'Costs'"), code.indexOf("{ heading: 'Connections'"));
  assert.ok(/tab: 'ai', label: 'Models'/.test(costs), 'Models is a Costs row');
  const conns = code.slice(code.indexOf("{ heading: 'Connections'"), code.indexOf("{ heading: 'Tools'"));
  assert.ok(!/label: 'Models'/.test(conns), 'and no longer a Connections row');
});

// ── 5. Database tools ────────────────────────────────────────────────────
ok('Cleanup Centre is renamed, and no link points at the old path', () => {
  assert.ok(/path="database-tools"/.test(app), 'the route is /database-tools');
  assert.ok(!/contacts\/cleanup/.test(app + settings), 'nothing links to the old path');
  assert.ok(!/>🧹 Cleanup Centre</.test(settings), 'and no button still says Cleanup Centre');
  // Named, not counted. This asserted "exactly 2" until PR 3 moved every
  // maintenance job onto the page and added four more pointers to it. A count
  // pins a number; what this cares about is that each list's drawer still
  // reaches the page, and lands on its own tab. Relaxing the count to "at
  // least 2" would have been worse than either: both halves of this could
  // then break and the four new pointers would still satisfy it.
  assert.ok(/to="\/database-tools\?tab=pubdupes"/.test(settings),
    'the Publications drawer lands on its own duplicates tab');
  assert.ok(/to="\/database-tools"/.test(settings),
    'and the Journalists drawer lands on the page itself');
});

ok('the tools kebab is published to the page header, not drawn in the card', () => {
  assert.ok(/export function DatabaseToolsSlot/.test(tools), 'there is a slot');
  assert.ok(/export function DatabaseToolsTrigger/.test(tools), 'and a trigger for the header');
  // RecordTools must no longer render a kebab itself, or there would be two.
  const rt = tools.slice(tools.indexOf('export default function RecordTools'));
  assert.ok(!/icon-circle/.test(rt), 'RecordTools draws no kebab of its own');
  assert.ok(/return primary \|\| null;/.test(rt), 'it renders only the primary action');
  assert.ok(/<DatabaseToolsTrigger tools=\{tools\} \/>/.test(settings), 'the header renders it');
  assert.ok(settings.indexOf('<DatabaseToolsTrigger') < settings.indexOf('</header>'),
    'and it is inside the header element');
});

ok('switching lists does not leave the previous list\'s tools behind', () => {
  // Publications and Journalists both publish into one slot. Without the
  // cleanup the header would keep showing whichever mounted first.
  assert.ok(/return \(\) => publish\(null\);/.test(tools), 'the slot is cleared on unmount');
});

console.log(`${passed} guards`);
console.log('---');
console.log('THE NAV MOVED IN ONE PIECE');
