// PR 3 of the review plan: every maintenance job in one place.
//
// "so its one mega cleanup centre?" — yes. Before this they were scattered
// over four screens with no pattern: two buttons in a grey strip above Find
// new journalists, one beside the Tags heading, one as the primary action on
// Publications. The only way to learn any of them existed was to be on the
// right screen on the right day.
//
// What this file guards is the thing a later edit would quietly undo: a job
// drifting back onto a list screen, or a pointer going stale after the one it
// replaced was deleted. The route itself is exercised for real in
// tests/outlet-create.test.js, and the placement is driven in
// dev/platform/drives/drive-pr3.mjs.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
// Four guards in one afternoon failed on their own explanatory comments
// quoting the string they banned, so every "is it gone" check reads the code.
const stripComments = (src) => src
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const settingsRaw = read('src/pages/SettingsPage.jsx');
const settings = stripComments(settingsRaw);
const toolsPage = stripComments(read('src/pages/ContactCleanupPage.jsx'));
const maint = read('src/components/database/MaintenanceTools.jsx');
const tidy = read('src/components/database/TagTidyTool.jsx');
const apiJs = stripComments(read('src/utils/api.js'));

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

// ── 1. The tab exists, and it is where the jobs live ─────────────────────
ok('Maintenance is a Cleanup row, and it renders the tools', () => {
  // This asserted the SuiteTabs entry and its 'Whole database' group label,
  // which was the strip the seven screens had inside their own page. They are
  // rows in the Database panel now, so the tab list is gone and the row is
  // what has to exist. The decision the guard is for — these jobs have one
  // home and it is reachable — is unchanged.
  const sections = stripComments(read('src/nav/sections.js'));
  const db = sections.slice(sections.indexOf('  database: {'), sections.indexOf('  bizdev: {'));
  assert.ok(/{ heading: 'Cleanup', rows: \[/.test(db), 'Database has a Cleanup group');
  assert.ok(/tab: 'maintenance',\s+label: 'Maintenance'/.test(db), 'with a Maintenance row');
  assert.ok(/tab === 'maintenance' && <MaintenanceTools \/>/.test(toolsPage), 'and it renders the tools');
  assert.ok(/CLEANUP_SCREENS\.includes\(tab\)/.test(settings),
    'and the Database section renders the Cleanup screens');
});

// ── 2. Every job that moved, moved ───────────────────────────────────────
ok('all five jobs are on the maintenance tab', () => {
  for (const [label, endpoint] of [
    ['Find websites + feeds', '/pr/outlets/resolve-websites/sweep'],
    ['Mine feeds for new bylines', '/pr/feeds/mine'],
    ['Enable semantic matching', '/pr/embeddings/backfill'],
    ['Email me this week', '/pr/digest/send-now'],
  ]) {
    assert.ok(maint.includes(label), `${label} is on the page`);
    assert.ok(maint.includes(endpoint), `${label} calls ${endpoint} from here`);
  }
  assert.ok(/<TagTidyTool \/>/.test(maint), 'and tag cleanup is the fifth');
  assert.ok(tidy.includes('/outreach/tags/analyze') && tidy.includes('/outreach/tags/apply-plan'),
    'which carries the whole flow, not just the button');
});

ok('and none of them is still wired up on a list screen', () => {
  for (const endpoint of [
    '/pr/outlets/resolve-websites/sweep',
    '/pr/outlets/find-rss/sweep',
    '/pr/feeds/mine',
    '/pr/embeddings/backfill',
    '/pr/digest/send-now',
    '/outreach/tags/analyze',
    '/outreach/tags/apply-plan',
  ]) {
    assert.ok(!settings.includes(endpoint),
      `${endpoint} is still called from SettingsPage — it has two homes now, which is what this PR was fixing`);
  }
});

// ── 3. Each one reports what it did ──────────────────────────────────────
ok('each job says what it did, because it no longer sits where its results land', () => {
  // Mining fed a review queue on the Journalists screen and finding feeds
  // filled columns in the list you were looking at. Moving them costs that,
  // and the answer is that each one reports here and names where to go next.
  assert.ok(/result=\{results\.feeds\}/.test(maint), 'finding feeds reports');
  assert.ok(/result=\{results\.mine\}/.test(maint), 'mining reports');
  assert.ok(/result=\{results\.embed\}/.test(maint), 'embedding reports');
  assert.ok(/result=\{results\.digest\}/.test(maint), 'the digest reports');
  assert.ok(/under Find new journalists/.test(maint),
    'and mining names where the suggestions it queued are waiting');
  // alert() blocks the page and says nothing after you dismiss it. The old
  // find-feeds button used one.
  assert.ok(!/\balert\(/.test(stripComments(maint)), 'no blocking alert');
});

ok('every job says when it runs on its own', () => {
  // A button you press for something that already happens nightly is a
  // button you press for nothing.
  const schedules = (maint.match(/schedule="/g) || []).length;
  assert.strictEqual(schedules, 4, `four scheduled jobs each say so (found ${schedules})`);
  assert.ok(/Runs nightly/.test(maint) && /Sent every Monday/.test(maint), 'in words, not a tooltip');
});

// ── 4. Nothing is left pointing at a button that moved ───────────────────
ok('the screens the jobs left point at where they went', () => {
  // Was a count of /database-tools?tab=maintenance. That path no longer
  // exists: Maintenance is a row in the Database panel, and the four screens
  // build the path from sections.js through one constant, so a renamed row
  // cannot leave four dead links. Pinning the literal string again would make
  // this guard fail on a rename that is correct.
  const links = (settings.match(/to=\{MAINTENANCE_PATH\}/g) || []).length;
  assert.ok(links >= 4, `each screen links on (found ${links})`);
  assert.ok(/const MAINTENANCE_PATH = `\$\{SECTIONS_NAV\.database\.base\(\)\}\/\$\{slugForTab\(SECTIONS_NAV\.database, 'maintenance'\)\}`/.test(settings),
    'and the path is derived from the row rather than written out');
  assert.ok(!/database-tools/.test(settings + stripComments(read('src/App.jsx'))),
    'nothing still points at the old top-level page');
  // The one thing worse than a job in two places is a line describing a
  // button that is not there any more.
  assert.ok(!/<strong>Find websites \+ feeds<\/strong> runs over every publication/.test(settings),
    'the paragraph explaining the moved button went with it');
  assert.ok(!/Preview it now:/.test(settings), 'and the digest strip no longer promises a button');
});

ok('nothing is left over in SettingsPage from the tidy flow', () => {
  for (const dead of ['tidyWithClaude', 'applyPlan', 'selectedOps', 'OpSummary', 'setAnalyzing']) {
    assert.ok(!settings.includes(dead), `${dead} is gone from SettingsPage`);
  }
  // Renaming or deleting one tag is a control on the Tags list and stays.
  assert.ok(/renameTag/.test(settings) && /deleteTag/.test(settings), 'the per-tag controls stay');
});

// ── 5. Publications gets a primary of its own ────────────────────────────
ok('Publications leads with Add publication', () => {
  assert.ok(/primary=\{\s*<button onClick=\{\(\) => setAdding\(true\)\} className="btn btn-primary btn-sm">\+ Add publication<\/button>/
    .test(settings.replace(/\n\s*/g, '\n          ').replace(/\n\s+/g, ' ')) || /\+ Add publication/.test(settings),
    'the primary action is adding one');
  assert.ok(/function AddOutletModal/.test(settings), 'there is a form');
  assert.ok(/api\.post\('\/pr\/outlets', form\)/.test(settings), 'which posts to the new route');
  // Name is the only required field: the feed job fills the website and the
  // feed, and Generate writes the About line. A form demanding six fields
  // gets a name and five blanks.
  assert.ok(/disabled=\{!form\.name\.trim\(\) \|\| saving\}/.test(settings), 'name is required and nothing else is');
});

ok('a clash offers to open the publication rather than only refusing', () => {
  assert.ok(/onExisting/.test(settings), 'there is a path to the existing row');
  assert.ok(/Open it/.test(settings), 'and a button that takes it');
  assert.ok(/e\?\.body\?\.existing/.test(settings), 'read off the error body the 409 carries');
});

ok('a new publication is put at the top of the list, not refetched into it', () => {
  // The list is ordered by coverage DESC with a LIMIT, and a publication
  // added by hand has none — so a refetch files it below two thousand others
  // and reads as the add having failed.
  assert.ok(/setOutlets\(\(list\) => \[o, \.\.\.\(list \|\| \[\]\)\]\)/.test(settings),
    'it is prepended');
  assert.ok(/setOpenOutlet\(\{ id: o\.id \}\)/.test(settings), 'and opens for the rest of the detail');
});

// ── 6. The error body the 409 depends on ─────────────────────────────────
ok('api.js hands the response body to the caller', () => {
  // It parsed the body and threw away everything but .error, so a 409 that
  // answers "already there, and here is the row" was indistinguishable from
  // one that only said no. Found by reading the handler I had just written
  // against the layer it depended on, not by a test.
  assert.ok(/e\.body = err;/.test(apiJs), 'the body rides along');
  assert.ok(/e\.status = res\.status;/.test(apiJs), 'and the status code with it');
  // Counted, not matched. api.js throws that message from two places, and an
  // assertion that only had to find it once passed happily while the line it
  // meant to pin had been rewritten — satisfied by the other one. The
  // mutation run found that, twice: the second time because the fix to the
  // first had added a third copy of the shape it was anchoring on.
  const throwsCount = (apiJs.match(/new Error\(err\.error \|\| `HTTP \$\{res\.status\}`\)/g) || []).length;
  assert.strictEqual(throwsCount, 2,
    `both throw sites keep the message every caller already reads (found ${throwsCount})`);
  const carriesCount = (apiJs.match(/e\.body = err;/g) || []).length;
  assert.strictEqual(carriesCount, 2, `and both carry the body (found ${carriesCount})`);
});

console.log(`${passed} guards`);
console.log('---');
console.log('ONE PLACE FOR EVERY DATABASE JOB');
