// Who gets the Monday briefing, and what the email says.
//
// Three things were wrong and all three were silent:
//
//   1. The cron generated `strategistReport`, the older ads-only write-up,
//      while the Strategy tab showed the cross-PESO briefing. The panel said
//      "emailed to you every Monday" about a document nothing emailed.
//   2. It only selected clients with an active meta_ads or google_ads
//      connector, left over from when the briefing was ads-only. A client on
//      GA4 and Shopify alone got no Monday email at all and nothing said so.
//   3. It never read `strategist_active`, so the "Weekly email" checkbox on
//      the Strategy tab did nothing. Unticking it still sent the email.
//
// None of that shows up in a browser or a build. This reads the cron's own
// source, which is blunt but is the only thing that fails when someone
// reintroduces the ads-only filter.
//
//   node tests/strategist-weekly.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'scheduler.js'), 'utf8');

// The Monday 07:00 job, from its cron line to the end of its handler.
const start = src.indexOf("cron.schedule('0 7 * * 1'");
assert.ok(start > -1, 'the Monday strategist cron is gone entirely');
const end = src.indexOf("weekly job failed", start);
assert.ok(end > -1, 'could not find the end of the Monday job');
const job = src.slice(start, end);

console.log('the Monday briefing job');

check('generates the briefing the platform shows, not the old report', () => {
  assert.ok(/briefing\.generate\(/.test(job),
    'the job must call briefing.generate — the cross-PESO briefing');
  assert.ok(!/strategistReport\.generate\(/.test(job),
    'strategistReport is the old ads-only write-up; emailing it means the inbox '
    + 'and the screen disagree');
});

check('reads from strategist_briefings, not strategist_reports', () => {
  assert.ok(/FROM strategist_briefings/.test(job));
  assert.ok(!/FROM strategist_reports/.test(job));
});

check('honours the Weekly email toggle', () => {
  assert.ok(/strategist_active\s*=\s*true/.test(job),
    'without this the checkbox on the Strategy tab does nothing and unticking '
    + 'it still sends the email');
});

check('still skips inactive clients', () => {
  assert.ok(/active\s*=\s*true/.test(job));
});

check('does not filter to ads connectors only', () => {
  assert.ok(!/meta_ads/.test(job) && !/google_ads/.test(job),
    'the briefing is cross-PESO: a client on GA4 and Shopify alone must still '
    + 'get one');
  assert.ok(/status = 'active'/.test(job),
    'but it should still require at least one working connector, or the '
    + 'briefing has nothing to read');
});

check('emails only the open items', () => {
  assert.ok(/done = false/.test(job),
    'a ticked item is history and does not belong in Monday\'s email');
});

check('crucial items lead', () => {
  assert.ok(/priority = 'crucial'/.test(job) && /ORDER BY/.test(job));
});

check('the link goes to the Strategy tab, where the briefing now lives', () => {
  assert.ok(/tab=strategy/.test(job),
    'the old link pointed at /ads?tab=strategist, which no longer exists');
  assert.ok(!/tab=strategist/.test(job));
});

check('a client with no recipients is skipped rather than erroring', () => {
  assert.ok(/no recipients for/.test(job));
  assert.ok(/continue;/.test(job));
});

check('one client failing does not stop the rest', () => {
  // The per-client try/catch is what keeps a single bad client from costing
  // every other client their Monday email.
  const perClient = job.slice(job.indexOf('for (const cl of clients)'));
  assert.ok(/catch \(err\)/.test(perClient), 'the per-client loop needs its own catch');
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
