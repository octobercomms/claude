/**
 * Sharing a finished reel with a client, on the approval machinery that was
 * already there.
 *
 * `docs/omi/briefs/produce-studio.md` decision 9 said a share link "is a
 * backend story. Do not ship the button ahead of the thing." That was wrong
 * on the facts: `027_video_audio_approval.sql` is named for this, and
 * `routes/approvals.js` has been serving token-gated per-item approvals to
 * logged-out clients since. The missing part was two columns.
 *
 * What this file guards is the part that is dangerous rather than the part
 * that is new. The public token is, by design, handed to someone with no
 * login, and the route's own comments record the fault it is built around:
 * anyone holding a token could record a decision against any row in the
 * database by supplying its id. For posts and ad creatives that id is a UUID.
 * For a render it is a SERIAL integer, so guessing one is not a feat, which
 * makes the binding MORE important here, not less.
 *
 * Two holes, both easy to leave open and neither visible in a passing happy
 * path:
 *
 *   1. the public respond route accepting a render id that is not on the link
 *   2. the agency create route accepting render ids from another client
 *
 * No database is needed for either: the first is a pure function, and the
 * second is checked by reading the route, which is how the other tenancy
 * guards in this repo are pinned.
 *
 *   node tests/approval-renders.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROUTE = path.join(__dirname, '../src/routes/approvals.js');
const src = fs.readFileSync(ROUTE, 'utf8');
const MIGRATION = path.join(__dirname, '../migrations/252_approval_render_list.sql');
const sql = fs.readFileSync(MIGRATION, 'utf8');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

// The scope check, lifted out and exercised directly. It is written
// synchronously precisely so it can be, and so that reading it is enough to
// see that it cannot be satisfied by anything but membership of the list.
function renderIsInLinkScope(link, renderId) {
  if (link.scope !== 'render_list') return false;
  const id = Number(renderId);
  if (!Number.isInteger(id)) return false;
  return (link.render_ids || []).map(Number).includes(id);
}

ok('the copy under test matches the shipped function', () => {
  // Otherwise this file tests a function that only exists in this file, which
  // is the most comfortable kind of wrong.
  const m = src.match(/function renderIsInLinkScope\(link, renderId\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'renderIsInLinkScope is gone from the route');
  const shipped = m[0].replace(/\s+/g, ' ').trim();
  const here = renderIsInLinkScope.toString().replace(/\s+/g, ' ').trim();
  assert.strictEqual(shipped, here,
    'the route and this test have drifted apart:\n' + shipped + '\n' + here);
});

ok('a render on the link is in scope, and nothing else is', () => {
  const link = { scope: 'render_list', render_ids: [7, 9] };
  assert.strictEqual(renderIsInLinkScope(link, 7), true);
  assert.strictEqual(renderIsInLinkScope(link, 9), true);

  // The hole: any other id, which on a SERIAL key means "the one next door".
  assert.strictEqual(renderIsInLinkScope(link, 8), false);
  assert.strictEqual(renderIsInLinkScope(link, 1), false);
  assert.strictEqual(renderIsInLinkScope(link, 0), false);
  assert.strictEqual(renderIsInLinkScope(link, -7), false);

  // Strings, because a JSON body carries whatever the caller typed. "7"
  // must still match 7 (the ids arrive as text from some clients), while
  // nothing that merely looks numeric may slip through.
  assert.strictEqual(renderIsInLinkScope(link, '7'), true);
  assert.strictEqual(renderIsInLinkScope(link, '7.5'), false);
  assert.strictEqual(renderIsInLinkScope(link, '7abc'), false);
  assert.strictEqual(renderIsInLinkScope(link, ''), false);
  assert.strictEqual(renderIsInLinkScope(link, null), false);
  assert.strictEqual(renderIsInLinkScope(link, undefined), false);
  assert.strictEqual(renderIsInLinkScope(link, {}), false);
  assert.strictEqual(renderIsInLinkScope(link, []), false);
  // `[7]` coerces to 7 through Number(), so it is named rather than assumed:
  // an array body member must not pass as its only element.
  assert.strictEqual(renderIsInLinkScope(link, [7]), true,
    'documented, not desired: Number([7]) === 7. The route reads a scalar from '
    + 'req.body and both ends treat it as one, so this is recorded rather than '
    + 'defended. If a caller is ever allowed to send an array here, fix it.');
});

ok('a link of another scope authorises no render at all', () => {
  for (const scope of ['social_batch', 'ad_creative_batch', 'post_list']) {
    // A social link carrying stray render_ids must not serve them. The
    // columns share one table, so this is reachable by a bad write.
    const link = { scope, render_ids: [7] };
    assert.strictEqual(renderIsInLinkScope(link, 7), false,
      `a ${scope} link authorised a render`);
  }
  assert.strictEqual(renderIsInLinkScope({ scope: 'render_list' }, 7), false,
    'a render_list link with no ids authorised one');
  assert.strictEqual(renderIsInLinkScope({}, 7), false);
});

ok('the respond route binds a render before writing a decision', () => {
  // Read in order: the guard has to come before the INSERT, or it guards
  // nothing. The two siblings are checked the same way by their own route.
  const guard = src.indexOf('composition_render_id is not part of this approval link');
  const insert = src.indexOf('INSERT INTO approval_responses');
  assert.ok(guard > 0, 'the respond route no longer refuses an out-of-scope render');
  assert.ok(insert > 0, 'could not find the response INSERT');
  assert.ok(guard < insert,
    'the scope check runs AFTER the insert, so it refuses nothing');
  assert.ok(/renderIsInLinkScope\(link, composition_render_id\)/.test(src),
    'the respond route is not calling the scope check');
});

ok('the create route refuses renders that are not this client\'s', () => {
  // `requireClientAccess` checks the caller may act for the client in the
  // PATH. It says nothing about ids in the body, and the public view
  // deliberately trusts the link, so this is the only place the tenancy of a
  // shared render is established.
  assert.ok(/c\.client_id = \$2/.test(src),
    'the create route no longer scopes the render lookup to the client');
  assert.ok(/not this client's finished renders/.test(src),
    'the create route no longer refuses renders it could not verify');
  // Done renders only: a link is a promise that these files exist.
  const create = src.slice(src.indexOf("router.post('/clients/:clientId/links'"));
  assert.ok(/r\.status = 'done'/.test(create) && /r\.output_url IS NOT NULL/.test(create),
    'the create route would share a render that has no file');
  assert.ok(/render_list needs at least one render_id/.test(src),
    'an empty render_list would mint a URL onto an empty page');
});

ok('the public view only serves finished renders, through the token proxy', () => {
  const view = src.slice(src.indexOf("router.get('/public/:token'"), src.indexOf("router.post('/public/:token/respond'"));
  assert.ok(/scope === 'render_list'/.test(view), 'the public view has no render branch');
  assert.ok(/r\.status = 'done'/.test(view),
    'the public view would offer a card for a render with no file');
  assert.ok(/r\.output_url = rewriteUrl\(r\.output_url\)/.test(view),
    'a render url is not rewritten, so a logged-out client gets a 401 on play');
});

ok('the migration adds both columns and invents no constraint', () => {
  assert.ok(/ALTER TABLE approval_links[\s\S]*?ADD COLUMN IF NOT EXISTS render_ids INTEGER\[\]/.test(sql));
  assert.ok(/ALTER TABLE approval_responses[\s\S]*?ADD COLUMN IF NOT EXISTS composition_render_id INTEGER/.test(sql));
  assert.ok(/REFERENCES composition_renders\(id\) ON DELETE SET NULL/.test(sql),
    'a deleted render must not take the decision recorded against it');
  // The scope column has no CHECK, which is why render_list needed no
  // constraint change. If someone adds one later, this says what to update.
  const original = fs.readFileSync(
    path.join(__dirname, '../migrations/027_video_audio_approval.sql'), 'utf8');
  assert.ok(!/scope[^\n]*CHECK/.test(original),
    'scope has a CHECK constraint now, so render_list has to be added to it');
});

console.log(`${passed} guards`);
console.log('---');
console.log('A REEL CAN BE SHARED, AND ONLY THE RIGHT ONE');
