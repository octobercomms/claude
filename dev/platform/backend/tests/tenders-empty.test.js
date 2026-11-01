// "Tenders list empty" had four causes and one message.
//
// The screen said "Nothing ingested yet. Hit Run scan now" whenever the list
// came back empty. That sentence was right for exactly one of the four
// reasons a list can be empty, and it sent you to re-scan feeds in the other
// three.
//
// The reason it could not tell them apart: `counts.total` is computed over
// the rows the SQL already returned, and the WHERE clause had dropped every
// closed notice (upcoming=1) and every dismissed one before counting. A table
// holding 200 expired notices therefore reported total = 0, which is
// indistinguishable from an empty table.
//
// Worse, both filters were hard-coded into the request and had no control on
// screen, so a notice you dismissed by mistake could not be reached again
// from anywhere in the UI, and a passed deadline took the whole record with
// it.
//
// Now: the route returns unconditional totals, the empty state names which of
// the four it is, and both filters are switches carrying their counts.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const panel = fs.readFileSync(path.join(FE, 'src/components/TendersPanel.jsx'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'tender.js'), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

ok('the route counts what the filter removed, not what survived it', () => {
  const body = route.slice(route.indexOf("router.get('/notices'"), route.indexOf("router.post('/notices/add-url'"));
  assert.ok(/COUNT\(\*\)::int AS stored/.test(body), 'it counts every stored notice');
  assert.ok(/FILTER \(WHERE closing_at IS NOT NULL AND closing_at < NOW\(\)\)::int AS closed/.test(body),
    'and how many have closed');
  assert.ok(/FILTER \(WHERE dismissed = true\)::int AS dismissed/.test(body),
    'and how many were dismissed');
  assert.ok(/res\.json\(\{ notices: keep\.slice\(0, limit\), counts, vcounts, totals \}\)/.test(body),
    'and sends them');
  // The count must not inherit the clause that caused the bug.
  const totalsQuery = body.slice(body.indexOf('AS stored') - 200, body.indexOf('const totals'));
  assert.ok(!/closing_at >= NOW\(\)/.test(totalsQuery), 'the totals query is not filtered to open notices');
  assert.ok(!/dismissed = false/.test(totalsQuery), 'nor to undismissed ones');
});

ok('the totals respect the market filter, and only that', () => {
  // A market-filtered view saying "200 stored" when 198 belong to another
  // market is a new wrong number in place of the old one.
  const body = route.slice(route.indexOf("router.get('/notices'"), route.indexOf("router.post('/notices/add-url'"));
  assert.ok(/market \? 'LEFT JOIN tender_sources s ON s\.id = n\.source_id WHERE s\.market = \$1' : ''/.test(body),
    'the join and predicate are added only when a market is set');
  assert.ok(/market \? \[market\] : \[\]/.test(body), 'and the parameter goes with it');
});

ok('the empty state has a branch per cause', () => {
  const empty = panel.slice(panel.indexOf('!notices.length ?'), panel.indexOf('md-table-wrap'));
  assert.ok(/counts && counts\.total > 0/.test(empty), 'filtered out by the dropdowns');
  assert.ok(/totals && totals\.stored > 0/.test(empty), 'stored but not open');
  // The comment above the branches quotes the old message, so anchor the
  // scan branch on its markup, which only the live JSX has.
  assert.ok(/<strong>Run scan now<\/strong>/.test(empty), 'genuinely nothing');
  assert.ok(/totals\.closed > 0 &&/.test(empty), 'and it says how many closed');
  assert.ok(/totals\.dismissed > 0 &&/.test(empty), 'and how many were dismissed');
  // Order matters: stored-but-hidden must be tested before the scan message,
  // or the scan message swallows it again.
  assert.ok(empty.indexOf('totals && totals.stored > 0') < empty.indexOf('<strong>Run scan now</strong>'),
    'the stored branch is reached before the scan message');
});

ok('both hidden filters became switches', () => {
  assert.ok(/const \[showClosed, setShowClosed\] = useState\(false\)/.test(panel), 'closed is state');
  assert.ok(/const \[showDismissed, setShowDismissed\] = useState\(false\)/.test(panel), 'dismissed is state');
  assert.ok(/upcoming: showClosed \? '0' : '1'/.test(panel), 'closed drives the request');
  assert.ok(/if \(showDismissed\) params\.set\('dismissed', '1'\)/.test(panel), 'dismissed drives the request');
  assert.ok(!/upcoming: '1'/.test(panel), 'and the hard-coded value is gone');
});

ok('and ticking one reloads the list', () => {
  // State that the request reads but the effect does not watch is a switch
  // that does nothing, which is worse than no switch.
  const m = panel.match(/useEffect\(\(\) => \{ loadNotices\(\); \}, \[([^\]]+)\]/);
  assert.ok(m, 'the list has a reload effect');
  const deps = m[1].split(',').map(s => s.trim());
  for (const d of ['market', 'relevance', 'verdict', 'showClosed', 'showDismissed']) {
    assert.ok(deps.includes(d), `${d} is in the dependency list`);
  }
});

ok('the labels carry the counts, so the shape reads without ticking', () => {
  assert.ok(/Include closed\{totals && totals\.closed \? ` \(\$\{totals\.closed\}\)` : ''\}/.test(panel),
    'closed shows its count');
  assert.ok(/Include dismissed\{totals && totals\.dismissed \? ` \(\$\{totals\.dismissed\}\)` : ''\}/.test(panel),
    'dismissed shows its count');
  assert.ok(/setTotals\(res\.totals \|\| null\)/.test(panel), 'and the panel stores what the route sent');
});

console.log(`${passed} guards`);
console.log('---');
console.log('AN EMPTY TENDER LIST SAYS WHY');
