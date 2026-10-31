/**
 * The Shared autopilot is off unless somebody turned it on.
 *
 * It is the one thing in OMI that acts without a human clicking go, and it
 * was kept rather than deleted on exactly that condition. The column
 * defaulted to false — not paused, i.e. live — so every client created since
 * migration 046 was on a cron that posts to Instagram, Facebook and LinkedIn
 * on its own. This guard is what stops that coming back.
 *
 *   node tests/autopilot-off.test.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label, extra); failures += 1; }
};

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// --- the default ----------------------------------------------------------
const migrations = fs.readdirSync(path.join(root, 'migrations')).filter(f => f.endsWith('.sql'));
const flips = migrations.filter(f => /ALTER COLUMN social_autopilot_paused SET DEFAULT true/.test(read(`migrations/${f}`)));
ok(flips.length === 1, 'exactly one migration sets the paused default to true', JSON.stringify(flips));
const flip = read(`migrations/${flips[0] || migrations[0]}`);
ok(/UPDATE clients SET social_autopilot_paused = true/.test(flip),
  'and it pauses the clients the old default had already switched on');
// A later migration putting it back would make the one above pointless.
const unflips = migrations.filter(f => /ALTER COLUMN social_autopilot_paused SET DEFAULT false/.test(read(`migrations/${f}`)));
ok(unflips.length === 0, 'and nothing sets it back to false', JSON.stringify(unflips));

// --- the publisher ---------------------------------------------------------
const publisher = read('src/services/socialPublisher.js');
ok(/social_autopilot_paused\s*=\s*false/.test(publisher),
  'the publisher only picks up plans for clients it is switched on for');
// The filter has to be in the query that selects what to publish, not in a
// comment or a different statement. Checked by position: it sits inside a
// SELECT whose FROM reaches social_post_plans.
const due = publisher.slice(0, publisher.indexOf('social_autopilot_paused = false'));
ok(/social_post_plans/.test(due.slice(due.lastIndexOf('SELECT'))),
  'in the query that chooses the plans, not somewhere else in the file');

// --- the screen ------------------------------------------------------------
// Off is the normal state, so the page must not dress it as a fault. A
// warning callout on every client by default trains people to ignore
// callouts.
const overview = read('../frontend/src/components/SocialSuiteOverview.jsx');
ok(!/Autopilot is paused/.test(overview),
  'and the page does not warn about the default state');
ok(/social_autopilot_paused \? 'Off'/.test(overview),
  'it reports it as off rather than paused');

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
