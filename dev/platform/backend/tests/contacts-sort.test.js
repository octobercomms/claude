// Database → Journalists: sort, on the server, and a red button that asks for
// the count rather than for a word.
//
// Search was already server-side, and the comment explaining why is the whole
// argument for sorting the same way: the library holds 21,000 contacts and
// the list draws a 200-row page, so doing either in the browser orders or
// filters the page you happen to be looking at and calls it the library.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

const route = read('backend/src/routes/outreach.js');
const page = read('frontend/src/pages/SettingsPage.jsx');
const lib = page.slice(page.indexOf('function ContactsLibrary'), page.indexOf('function TagsManager'));
assert.ok(lib.length > 4000, 'the library panel is still where this test looks');

// ── ORDER BY cannot be parameterised ─────────────────────────────────────────

ok('the sort column comes from a whitelist, never from the query string', () => {
  const fn = route.slice(route.indexOf('function librarySortSql'), route.indexOf("router.get('/contacts/library'"));
  assert.ok(/LIBRARY_SORTS\[key\]/.test(fn), 'looked up, not interpolated');
  // The one thing that must never appear: the client's own string reaching SQL.
  assert.ok(!/\$\{query\.sort\}/.test(route));
  assert.ok(!/\$\{req\.query\.sort\}/.test(route));
  assert.ok(!/\$\{query\.dir\}/.test(route));
  // Direction is a two-way branch, so 'DESC; DROP' cannot be a direction.
  assert.ok(/'asc' \? 'ASC' : 'DESC'/.test(fn));
});

ok('an unknown column falls back instead of erroring', () => {
  const fn = route.slice(route.indexOf('function librarySortSql'), route.indexOf("router.get('/contacts/library'"));
  assert.ok(/if \(!expr \|\| \(TOTALS_SORTS\.has\(key\) && !hasTotals\)\) return 'c\.created_at DESC'/.test(fn),
    'a stale bookmark should show the library, not a 500');
});

ok('an engagement sort is refused without the totals to sort on', () => {
  // Those columns are correlated subqueries behind ?include_totals=1. Sorting
  // by them unconditionally would make the cheap "add from library" picker
  // pay for the expensive query.
  assert.ok(/const TOTALS_SORTS = new Set\(\['total_sent', 'total_replied'\]\)/.test(route));
  assert.ok(/librarySortSql\(req\.query, !!totalsCols\)/.test(route));
});

ok('empty values sort last whichever way the column goes', () => {
  const fn = route.slice(route.indexOf('function librarySortSql'), route.indexOf("router.get('/contacts/library'"));
  assert.ok(/NULLS LAST/.test(fn),
    'a contact with no email is not what you want first when you sort by email');
  assert.ok(/c\.created_at DESC`/.test(fn), 'with a stable tie-break');
});

ok('the query actually uses it', () => {
  const q = route.slice(route.indexOf("router.get('/contacts/library'"), route.indexOf('// "Delete everything matching this filter"'));
  assert.ok(/ORDER BY \$\{orderSql\}/.test(q));
  assert.ok(!/ORDER BY c\.created_at DESC\n\s+LIMIT/.test(q), 'the hardcoded order is gone');
});

// ── The screen ───────────────────────────────────────────────────────────────

ok('the sort is sent to the server, not applied in the browser', () => {
  assert.ok(/p\.set\('sort', sort\.key\)/.test(lib));
  assert.ok(/p\.set\('dir', sort\.dir\)/.test(lib));
  // And a change refetches, or the arrow moves and the rows do not.
  assert.ok(/\}, \[search, activeTags, sort\]\)/.test(lib));
});

ok('a text column starts A-first and a count column starts at most', () => {
  assert.ok(/const ASC_FIRST = new Set\(\['name', 'email', 'outlet', 'country', 'beat'\]\)/.test(lib));
  assert.ok(/dir: ASC_FIRST\.has\(key\) \? 'asc' : 'desc'/.test(lib));
  assert.ok(/s\.dir === 'asc' \? 'desc' : 'asc'/.test(lib), 'and clicking the same column flips it');
});

ok('every column worth sorting is sortable, and the array columns are not', () => {
  for (const c of ['name', 'email', 'outlet', 'country', 'beat', 'total_replied']) {
    assert.ok(new RegExp(`<SortTh col="${c}"`).test(lib), `${c} is sortable`);
  }
  // Sorting a list of tags alphabetically sorts by whichever happens to be
  // first, which is not a sort anybody asked for.
  assert.ok(/<th style=\{\{ textAlign: 'left' \}\}>Tags<\/th>/.test(lib));
  assert.ok(/<th style=\{\{ textAlign: 'left' \}\}>Attached to<\/th>/.test(lib));
});

ok('the whole header label is the hit target', () => {
  const css = read('frontend/src/index.css');
  assert.ok(/\.th-sort \{/.test(css));
  assert.ok(/\.th-sort__pip \{[^}]*min-width/.test(css),
    'the arrow reserves its width, or clicking through headers shuffles the table');
});

// ── The red button ───────────────────────────────────────────────────────────

ok('no library delete runs from a confirm() or a prompt()', () => {
  // prompt() returns null in some embedded views, so the delete silently did
  // nothing and taught you the button was broken rather than guarded.
  assert.ok(!/prompt\(`This will delete/.test(lib));
  assert.ok(!/Type DELETE to confirm/.test(lib), 'a fixed word is muscle memory within a week');
  assert.ok(!/confirm\(`Delete all \$\{total/.test(lib));
  assert.ok(!/confirm\(`Delete \$\{selected\.size\} journalist/.test(lib));
});

ok('both batch deletes go through the typed dialog', () => {
  assert.ok(/function askDeleteAllMatching/.test(lib));
  assert.ok(/function askDeleteSelectedContacts/.test(lib));
  assert.ok(/<DangerConfirm/.test(lib));
  assert.ok(/noun="journalist"/.test(lib));
});

ok('the dialog names the real total and what else goes', () => {
  assert.ok(/count: total,/.test(lib), 'the unbounded match count, not the page');
  assert.ok(/not only the \$\{filtered\.length\.toLocaleString\(\)\} on screen/.test(lib));
  assert.ok(/removed from every client they were attached to/.test(lib));
  assert.ok(/expected_count: pendingDelete\.count/.test(lib),
    'and the server is told the same number the operator typed');
});

console.log(`contacts-sort   ✓ ${passed} assertions passed`);
