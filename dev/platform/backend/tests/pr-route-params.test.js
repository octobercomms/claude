// A route parameter name in pr.js is not just a label — it selects a lookup.
//
// This router registers `router.param('searchId')`, which resolves the id
// against **pr_coverage_searches** and 404s when it is not there. Express
// applies that to every route in the router using `:searchId`, whatever the
// route is actually about.
//
// So the media lists, which live in a different table, cannot use that name.
// They did for about ten minutes: `/pitch-searches/:searchId` was
// looked up in the coverage table, found nothing, and returned
// "Search not found" for every id that existed. Nothing threw, no test
// covered it, and the failure reads like a missing record rather than like
// routing.
//
// Two things called a search in one section was the underlying trap, which is
// why the saved Match results are now called media lists:
// pr_coverage_searches is a standing query run against the open web on a
// cadence, and a media list is the journalists you picked for one story.
//
//   node tests/pr-route-params.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/routes/pr.js'), 'utf8');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };

// Every `router.<verb>('<path>'` in the file.
function routePaths() {
  return [...SRC.matchAll(/^router\.(get|post|put|patch|delete)\(\s*'([^']+)'/gm)].map(m => m[2]);
}

// Which param names have a router.param() resolver, and what each one reads.
//
// Anchored to the start of a line. Without that, the first version of this
// matched the sentence in the comment above — which names the resolver and
// then mentions another table a few lines later — and read the wrong answer
// out of its own explanation.
function paramResolvers() {
  const out = {};
  for (const m of SRC.matchAll(/^router\.param\(\s*'([^']+)'[\s\S]{0,400}?FROM\s+(\w+)/gm)) {
    out[m[1]] = m[2];
  }
  return out;
}

const resolvers = paramResolvers();
const paths = routePaths();

ok('the searchId resolver still reads the coverage table', () => {
  // The premise of everything below. If this is ever repointed, the rule
  // changes and this test should be the thing that says so.
  assert.strictEqual(resolvers.searchId, 'pr_coverage_searches',
    `router.param('searchId') now reads ${resolvers.searchId || 'nothing'}; the collision rule below `
    + 'was written against pr_coverage_searches and needs rethinking');
});

ok('no media-list route borrows the coverage resolver', () => {
  const borrowed = paths.filter(p => p.includes('media-lists') && /:searchId\b/.test(p));
  assert.deepStrictEqual(borrowed, [],
    `these routes use :searchId, so router.param('searchId') resolves them against `
    + `pr_coverage_searches and every real id 404s: ${borrowed.join(', ')}`);
});

ok('the media-list routes exist and use their own parameter', () => {
  const lists = paths.filter(p => p.includes('media-lists'));
  assert.ok(lists.length >= 4,
    `expected the list, create, read, ran and delete routes; found ${lists.length}: ${lists.join(', ')}`);
  const byId = lists.filter(p => /\/media-lists\/:/.test(p));
  assert.ok(byId.length >= 3, 'no by-id media-list routes found');
  for (const p of byId) {
    assert.ok(/:listId\b/.test(p),
      `${p} does not use :listId, so it is either colliding or inventing a second name`);
  }
});

ok('a param with a resolver is never used for an unrelated resource', () => {
  // The general form of the bug. For each resolved param, every route using
  // it has to be about the same thing the resolver looks up. Checked by the
  // route path mentioning the resolver's own noun.
  const NOUN = { pr_coverage_searches: 'searches', pr_editorial_log: 'editorial-log', pr_press_releases: 'press-releases' };
  const problems = [];
  for (const [param, table] of Object.entries(resolvers)) {
    const noun = NOUN[table];
    if (!noun) continue;                       // resolver we have no expectation for
    for (const p of paths) {
      if (!new RegExp(`:${param}\\b`).test(p)) continue;
      if (!p.includes(noun)) problems.push(`${p} uses :${param}, which is resolved against ${table}`);
    }
  }
  assert.deepStrictEqual(problems, [],
    'a route is borrowing a parameter resolver for a resource it does not own:\n  ' + problems.join('\n  '));
});

console.log(`\n${passed} passed, 0 failed`);
