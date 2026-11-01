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
  assert.ok(/tab: 'models', label: 'Models'/.test(costs), 'Models is a Costs row');
  const conns = code.slice(code.indexOf("{ heading: 'Connections'"), code.indexOf("{ heading: 'Tools'"));
  assert.ok(!/label: 'Models'/.test(conns), 'and no longer a Connections row');
  assert.ok(/tab: 'ai',\s+label: 'AI'/.test(conns), 'the AI credentials are a Connections row');

  // The half the move left undone. Moving the row put the routing list under
  // Costs and left the AI provider keys rendering underneath it, so the
  // screen still did two jobs — which is the complaint the move answered.
  // The keys are what separate them: SUBTAB_CATS is keyed by screen, so a
  // screen keyed 'ai' picks up the AI credential category whatever it is
  // called or wherever it sits.
  const settingsPage = read('src/pages/SettingsPage.jsx');
  assert.ok(/\{tab === 'models' && <AiModelsPanel \/>\}/.test(settingsPage),
    'the routing list renders on the Models screen');
  assert.ok(!/\btab === 'ai'\b/.test(stripComments(settingsPage)),
    'and nothing renders a panel for the AI screen but its credentials');
  const cats = read('src/settings/catalogue.js');
  assert.ok(/^\s*ai: \['AI'\],/m.test(cats), "the AI category is keyed 'ai'");
  assert.ok(!/^\s*models: \[/m.test(cats),
    'and Models claims no credential category, or the keys come back');
});

// ── 5. Database tools ────────────────────────────────────────────────────
ok('the Cleanup screens are rows, not a page behind a kebab', () => {
  // This block asserted the kebab, the slot that published into it and the
  // drawer it opened. All three are gone: "the drawer icon is completely the
  // wrong place", and with the seven screens in the panel the drawer had one
  // item left on Publications and two on Journalists.
  assert.ok(!/path="database-tools"/.test(app), 'the top-level page is gone');
  assert.ok(!/contacts\/cleanup/.test(app + settings), 'nothing links to the old path either');
  assert.ok(!/>🧹 Cleanup Centre</.test(settings), 'and no button still says Cleanup Centre');

  const db = code.slice(code.indexOf('  database: {'), code.indexOf('  bizdev: {'));
  const cleanup = db.slice(db.indexOf("{ heading: 'Cleanup'"));
  const labels = [...cleanup.matchAll(/label: '([^']+)'/g)].map(m => m[1]);
  assert.deepStrictEqual(labels,
    ['Journalist duplicates', 'Coverage matchups', 'Tidy fixes', 'Contact updates',
      'Reply catch-up', 'Publication duplicates', 'Maintenance'],
    'all seven screens are rows, and the two Duplicates say which is which');

  // They were the last screens in Database outside the path scheme: the page
  // seeded its tab from ?tab= once and never updated the URL again.
  assert.ok(!/useSearchParams/.test(stripComments(read('src/pages/ContactCleanupPage.jsx'))),
    'the page no longer reads its screen from a query string');
  for (const slug of ['journalist-duplicates', 'coverage-matchups', 'tidy-fixes',
    'contact-updates', 'reply-catch-up', 'publication-duplicates']) {
    assert.ok(cleanup.includes(`slug: '${slug}'`), `${slug} is a readable permalink`);
  }
});

ok('the kebab and its drawer are gone, and the list keeps its own actions', () => {
  assert.ok(!/DatabaseToolsSlot|DatabaseToolsTrigger/.test(tools + settings),
    'no slot and no trigger survive');
  assert.ok(!/icon-circle/.test(tools), 'and nothing draws a kebab');
  assert.ok(!/SideDrawer/.test(tools), 'nor opens a drawer');
  // The actions that were inside it are buttons on the list's own header.
  assert.ok(/Export CSV/.test(settings) && /Import CSV/.test(settings),
    'export and import are still offered');
});

console.log(`${passed} guards`);
console.log('---');
console.log('THE NAV MOVED IN ONE PIECE');
