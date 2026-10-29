// The PR → backlinks leaderboard answers nothing unless it is handed an array
// of client ids.
//
// pressAttribution.leaderboard() opens with
//   if (!Array.isArray(visibleClientIds) || !visibleClientIds.length) return [];
// because its SQL binds `= ANY($1::uuid[])`. An admin's visibleClientIds is
// null — the "all clients" sentinel used everywhere else in the codebase —
// so the route's unscoped call returned an empty leaderboard to an admin every
// time, and the panel on the old Dashboard read "no campaign has earned a
// referring domain yet" whatever the data said.
//
// The route now takes ?client_id= and turns it into [client_id], after an
// access check. These tests pin that translation and the access check, which
// is the part a refactor could quietly drop.
//
//   node tests/pr-leaderboard-scope.test.js

const users = require('../src/services/users');
const { leaderboardScope } = require('../src/services/pressAttribution');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';

// The real decision the route makes, not a copy of it.
const scopeFor = (queryClientId, visibleClientIds) =>
  leaderboardScope(queryClientId, visibleClientIds, users.canAccessClient);

// What the service does with a scope it is given.
function serviceWouldAnswer(scope) {
  return (!Array.isArray(scope) || !scope.length) ? 'empty' : 'queried';
}

check('an admin asking for one client gets a real query, not an empty list',
  serviceWouldAnswer(scopeFor(ADMIN, null).scope) === 'queried');

check('an admin with no client_id still gets nothing — the unscoped call is the old bug',
  serviceWouldAnswer(scopeFor(undefined, null).scope) === 'empty');

check('a viewer asking for a client they hold gets a real query',
  serviceWouldAnswer(scopeFor(ADMIN, [ADMIN, OTHER]).scope) === 'queried');

check('a viewer asking for a client they do not hold is refused, not silently emptied',
  scopeFor(OTHER, [ADMIN]).status === 403);

check('a viewer with no clients at all is refused rather than queried',
  scopeFor(ADMIN, []).status === 403);

check('the scope passed on is a one-element array, not the bare id',
  Array.isArray(scopeFor(ADMIN, null).scope) && scopeFor(ADMIN, null).scope.length === 1
    && scopeFor(ADMIN, null).scope[0] === ADMIN);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
