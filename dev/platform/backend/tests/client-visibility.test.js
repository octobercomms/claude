/**
 * What the client is shown, on Paid and on Shared.
 *
 * Both screens offer the same control — untick the work you do not want the
 * client to see — and both were asked for in the same sentence. Paid got the
 * column, the filter and the gate. Shared got a tick that lived in the
 * account manager's own browser, so it filtered the next step and the client
 * saw the whole batch anyway: "this didnt seem to removal from the client
 * approval link."
 *
 * These are source-and-schema assertions rather than live queries, because
 * the fault was never in a query's result. It was in a query that did not
 * exist, a column nothing wrote to, and state kept in the wrong place. A
 * test with a database would have passed throughout.
 *
 *   node tests/client-visibility.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
  .filter(f => f.endsWith('.sql'))
  .map(f => read('migrations', f))
  .join('\n');

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label, extra); failures += 1; }
};

// ---- the column exists on both, and defaults to shown --------------------

for (const table of ['ad_creatives', 'social_posts']) {
  const re = new RegExp(`ALTER TABLE\\s+${table}[\\s\\S]{0,200}?ADD COLUMN IF NOT EXISTS show_to_client BOOLEAN NOT NULL DEFAULT TRUE`, 'i');
  ok(re.test(migrations), `${table} has show_to_client, defaulting to shown`);
}
// Default true matters on its own: a migration that defaulted to false would
// silently hide every piece of work from clients already reviewing it.
ok(!/show_to_client BOOLEAN NOT NULL DEFAULT FALSE/i.test(migrations),
  'and nothing defaults it to hidden, which would withdraw work mid-review');

// ---- the approval page filters on it -------------------------------------

const approvals = read('src', 'routes', 'approvals.js');

ok(/FROM social_posts p[\s\S]{0,120}?WHERE p\.batch_id = \$1 AND p\.show_to_client/.test(approvals),
  'the social batch the client opens shows only the posts ticked for them');
ok(/WHERE c\.batch_id = \$1 AND c\.show_to_client/.test(approvals),
  'and the ad batch does the same, as it already did');

// The gate, not only the list. A post withheld from the client must not be
// approvable by anyone who happens to hold its id: an approval recorded
// against work the client never saw is worse than a missing one.
ok(/FROM social_posts[\s\S]{0,160}?WHERE id = \$1 AND batch_id = \$2 AND show_to_client/.test(approvals),
  'and a withheld post cannot be approved by id');

// A post_list link is an explicit choice of posts made when the link was
// created, so it is deliberately not narrowed later by a tick elsewhere.
ok(/a post_list link is an explicit choice/i.test(approvals),
  'the one place that is deliberately not filtered says why');

// ---- the flag can actually be written ------------------------------------

const social = read('src', 'routes', 'social.js');
ok(/show_to_client = COALESCE\(\$8, show_to_client\)/.test(social),
  'the post update route can set it');
ok(/typeof show_to_client === 'boolean' \? show_to_client : null/.test(social),
  'and only a real boolean sets it, so `false` reaches the column instead of reading as "leave alone"');

// ---- the screen reads the post, not this browser -------------------------

const page = read('..', 'frontend', 'src', 'pages', 'ClientSocialPage.jsx');
ok(/filter\(p => p\.show_to_client !== false\)/.test(page),
  'the tick on Refine comes from the post');
ok(/api\.put\(`\/social\/posts\/\$\{p\.id\}`, \{ show_to_client/.test(page),
  'and toggling it is written to the server');
ok(!/usePersistedState\('shared_ticks'/.test(page),
  'the browser-local tick store is gone, so there is one answer and the client shares it');

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
