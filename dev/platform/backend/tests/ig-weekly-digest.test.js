// Instagram discovery reports once a week, in one email, for everyone.
//
// It used to send one email per client, per saved search, every morning at
// 08:00. With several active searches that is several emails a day about a
// handful of public profiles nobody was going to DM before the weekend, and
// the result is the same as any other daily alert nobody can act on: it stops
// being read.
//
// The split that matters: discovery stays DAILY, because a public profile can
// appear and disappear and finding it late is finding it never. Only the
// reporting moved to weekly. So the digest has to read found_at over a window
// rather than one run's return value, or six days in seven are thrown away.
//
//   node tests/ig-weekly-digest.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dbPath = require.resolve('../src/db');
let lastQuery = null;
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: async (sql, params) => {
      lastQuery = { sql, params };
      return { rows: require.cache[dbPath].exports._rows || [] };
    },
    _rows: [],
  },
};

const ig = require('../src/services/igOutreach');
const SCHED = fs.readFileSync(path.join(__dirname, '../src/services/scheduler.js'), 'utf8');
const EMAIL = fs.readFileSync(path.join(__dirname, '../src/services/emailService.js'), 'utf8');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };

const row = (client, clientName, username, found) => ({
  client_id: client, client_name: clientName, username,
  display_name: username, bio: 'architect', profile_url: `https://instagram.com/${username}`,
  status: 'new', found_at: found,
});

(async () => {
  // ── the query ──────────────────────────────────────────────────────────────

  require.cache[dbPath].exports._rows = [
    row('c1', 'Forgeworks', 'studio_a', '2026-11-20'),
    row('c1', 'Forgeworks', 'studio_b', '2026-11-18'),
    row('c2', 'Tiam', 'studio_c', '2026-11-19'),
  ];
  const grouped = await ig.recentProspectsByClient({ days: 7 });

  ok('a week of prospects comes back grouped by client', () => {
    assert.strictEqual(grouped.length, 2, 'the rows were not grouped by client');
    const names = grouped.map(g => g.clientName).sort();
    assert.deepStrictEqual(names, ['Forgeworks', 'Tiam']);
    const fw = grouped.find(g => g.clientName === 'Forgeworks');
    assert.strictEqual(fw.prospects.length, 2, 'a client lost one of its prospects in grouping');
  });

  ok('the window is read from found_at, not from one run', () => {
    assert.ok(/found_at\s*>=/.test(lastQuery.sql),
      'the digest is not filtering on found_at, so it can only see what the last discovery '
      + 'run happened to return, and six days in seven are thrown away');
    assert.deepStrictEqual(lastQuery.params, ['7'], 'the window is not being passed through');
  });

  // Awaited out here, not inside ok().
  //
  // `ok` calls its callback synchronously, so an async callback's assertion
  // runs after PASS has printed and fails as an unhandled rejection — or, as
  // happened first time here, asserts against the PREVIOUS call's state and
  // silently checks nothing. Do the work, then assert on the result.
  await ig.recentProspectsByClient({ days: 0 });
  const clampedParams = lastQuery.params;

  ok('a nonsense window becomes the default week, consistently', () => {
    // A zero-day window would return nothing and read as a quiet week rather
    // than as a bug. The first version of this mixed two rules — 0 fell
    // through to 7 while -5 clamped to 1 — so the same class of caller error
    // produced two different wrong answers.
    assert.deepStrictEqual(clampedParams, ['7'], 'a zero-day window did not fall back to a week');
    const { windowDays } = ig._internals;
    for (const bad of [0, -5, NaN, null, undefined, 'soon', Infinity]) {
      assert.strictEqual(windowDays(bad), 7, `windowDays(${String(bad)}) should be the default week`);
    }
    assert.strictEqual(windowDays(14), 14, 'a real window should be respected');
    assert.strictEqual(windowDays(7.9), 7, 'a fractional window should floor rather than reach the query raw');
  });

  require.cache[dbPath].exports._rows = [];
  const empty = await ig.recentProspectsByClient({ days: 7 });

  ok('no prospects means an empty list, not a throw', () => {
    assert.deepStrictEqual(empty, []);
  });

  // ── the schedule ───────────────────────────────────────────────────────────

  ok('discovery still runs daily', () => {
    assert.ok(/cron\.schedule\('0 8 \* \* \*'/.test(SCHED),
      'the daily discovery run is gone. A public profile can appear and disappear, so '
      + 'discovering weekly means missing people entirely');
  });

  ok('the daily run no longer emails anything', () => {
    const start = SCHED.indexOf("cron.schedule('0 8 * * *'");
    const end = SCHED.indexOf('cron.schedule', start + 10);
    const daily = SCHED.slice(start, end);
    assert.ok(!/emailService\.send/.test(daily),
      'the daily discovery job is emailing again, which is the thing being fixed: one '
      + 'message per client per search, every morning');
  });

  ok('the digest is weekly, and is one email', () => {
    assert.ok(/cron\.schedule\('30 8 \* \* 1'/.test(SCHED),
      'there is no weekly digest job');
    const start = SCHED.indexOf("cron.schedule('30 8 * * 1'");
    const end = SCHED.indexOf('cron.schedule', start + 10);
    const weekly = SCHED.slice(start, end === -1 ? undefined : end);
    assert.ok(/sendIgWeeklyDigest/.test(weekly), 'the weekly job does not send the digest');
    assert.ok(!/for \(|\.forEach\(|\.map\(.*send/.test(weekly),
      'the weekly job is looping over something and sending per iteration, which is the '
      + 'per-client email in a weekly costume');
  });

  ok('a quiet week sends nothing at all', () => {
    const start = SCHED.indexOf("cron.schedule('30 8 * * 1'");
    const weekly = SCHED.slice(start, start + 900);
    assert.ok(/if \(!total\)/.test(weekly),
      'an empty week still sends an email saying nothing happened, which is the same '
      + 'noise with better manners');
  });

  // ── the email ──────────────────────────────────────────────────────────────

  ok('the email function takes every client at once', () => {
    assert.ok(/async function sendIgWeeklyDigest\(\{ clients/.test(EMAIL),
      'sendIgWeeklyDigest does not take a set of clients, so it cannot be one email');
    assert.ok(!/async function sendIgDiscoveryDigest\(/.test(EMAIL),
      'the old per-client-per-search function is still defined; leaving it invites a '
      + 'future caller to reinstate the daily flood');
  });

  ok('a client with nothing new is left out rather than shown empty', () => {
    const start = EMAIL.indexOf('async function sendIgWeeklyDigest');
    const body = EMAIL.slice(start, start + 2200);
    assert.ok(/filter\(c => c\.prospects && c\.prospects\.length\)/.test(body),
      'clients with no new prospects are not filtered out, so the email lists them with '
      + 'nothing under them');
  });

  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e.message); process.exit(1); });
