// A pillar's share has to be a share of the whole account.
//
// The failure that matters here is quiet: if a channel stops matching the
// mapping (GA4 renames one, or returns different casing), its traffic silently
// drops out of its pillar and the pillar reads smaller than it is. Nothing on
// screen would say so — the number would just be wrong, and wrong downward,
// which is the direction nobody questions.
//
//   node tests/channel-pillars.test.js

const assert = require('assert');
const { summarisePillars, pillarFor } = require('../src/services/channelPillars');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('pillarFor');

check('every GA4 paid channel lands in Paid', () => {
  for (const c of ['Paid Search', 'Paid Social', 'Paid Shopping', 'Paid Video', 'Paid Other', 'Display', 'Cross-network']) {
    assert.strictEqual(pillarFor(c), 'paid', c);
  }
});

check('organic search is Owned, organic social is Shared', () => {
  assert.strictEqual(pillarFor('Organic Search'), 'owned');
  assert.strictEqual(pillarFor('Organic Shopping'), 'owned');
  assert.strictEqual(pillarFor('Organic Social'), 'shared');
  assert.strictEqual(pillarFor('Organic Video'), 'shared');
});

check('referral is Earned', () => {
  assert.strictEqual(pillarFor('Referral'), 'earned');
});

check('casing and whitespace do not break the mapping', () => {
  // GA4 has changed casing on these before; a miss would silently shrink a
  // pillar rather than erroring.
  for (const c of ['paid search', 'PAID SEARCH', '  Paid Search  ', 'Paid search']) {
    assert.strictEqual(pillarFor(c), 'paid', JSON.stringify(c));
  }
});

check('Direct is deliberately unmapped', () => {
  // Counting Direct as Earned would flatter PR with traffic it may have had
  // nothing to do with.
  assert.strictEqual(pillarFor('Direct'), null);
});

check('Email, Affiliates and Unassigned are unmapped', () => {
  for (const c of ['Email', 'Affiliates', 'Unassigned', 'Audio', 'SMS']) {
    assert.strictEqual(pillarFor(c), null, c);
  }
});

check('a missing or unknown channel is null, not a crash', () => {
  for (const c of [null, undefined, '', 'Something New GA4 Invented', 123, {}]) {
    assert.strictEqual(pillarFor(c), null, String(c));
  }
});

console.log('\nsummarisePillars');

const rows = [
  { channel: 'Organic Search', sessions: 4000, orders: 80, revenue: 20000 },
  { channel: 'Paid Search',    sessions: 1500, orders: 40, revenue: 12000 },
  { channel: 'Paid Social',    sessions: 500,  orders: 10, revenue: 3000 },
  { channel: 'Organic Social', sessions: 600,  orders: 5,  revenue: 1200 },
  { channel: 'Referral',       sessions: 400,  orders: 8,  revenue: 2400 },
  { channel: 'Direct',         sessions: 3000, orders: 60, revenue: 18000 },
];

check('each pillar sums its own channels', () => {
  const r = summarisePillars(rows);
  assert.strictEqual(r.paid.sessions, 2000, 'Paid Search + Paid Social');
  assert.strictEqual(r.paid.orders, 50);
  assert.strictEqual(r.paid.revenue, 15000);
  assert.strictEqual(r.owned.sessions, 4000);
  assert.strictEqual(r.shared.sessions, 600);
  assert.strictEqual(r.earned.sessions, 400);
});

check('the total is the whole account, including unmapped', () => {
  const r = summarisePillars(rows);
  assert.strictEqual(r.total.sessions, 10000);
  assert.strictEqual(r.total.revenue, 56600);
  assert.strictEqual(r.unmapped.sessions, 3000, 'Direct');
});

check('share is of the account, not of the mapped subset', () => {
  const r = summarisePillars(rows);
  // Paid is 2000 of 10000 sessions. Of the mapped-only subset (7000) it
  // would read 28.6%, which would overstate it by flattering away Direct.
  assert.strictEqual(Math.round(r.paid.share.sessions), 20);
  assert.strictEqual(Math.round(r.owned.share.sessions), 40);
  assert.strictEqual(Math.round(r.paid.share.revenue), 27);
});

check('a pillar carries its own channels, biggest first', () => {
  const r = summarisePillars(rows);
  assert.deepStrictEqual(r.paid.channels.map(c => c.channel), ['Paid Search', 'Paid Social']);
});

check('a pillar with nothing reads zero, with a zero share', () => {
  const r = summarisePillars([{ channel: 'Organic Search', sessions: 10, orders: 1, revenue: 100 }]);
  assert.strictEqual(r.paid.sessions, 0);
  assert.strictEqual(r.paid.share.sessions, 0);
  assert.deepStrictEqual(r.paid.channels, []);
});

check('no rows at all is zeroes and null shares, not a divide by zero', () => {
  for (const empty of [[], null, undefined]) {
    const r = summarisePillars(empty);
    assert.strictEqual(r.total.sessions, 0);
    assert.strictEqual(r.paid.sessions, 0);
    // Null, not 0 and not NaN: with no sessions at all there is no share to
    // state, and 0% would be a claim the data does not support.
    assert.strictEqual(r.paid.share.sessions, null, String(empty));
  }
});

check('missing numbers count as zero rather than poisoning the total', () => {
  const r = summarisePillars([
    { channel: 'Paid Search', sessions: 100 },
    { channel: 'Organic Search', sessions: null, orders: undefined, revenue: 'nonsense' },
  ]);
  assert.strictEqual(r.paid.sessions, 100);
  assert.strictEqual(r.owned.sessions, 0);
  assert.ok(Number.isFinite(r.total.revenue), 'a junk revenue must not make the total NaN');
  assert.strictEqual(r.total.revenue, 0);
});

check('an unknown channel lands in unmapped rather than vanishing', () => {
  const r = summarisePillars([
    { channel: 'Organic Search', sessions: 100, orders: 1, revenue: 500 },
    { channel: 'Some New GA4 Channel', sessions: 900, orders: 9, revenue: 4500 },
  ]);
  assert.strictEqual(r.unmapped.sessions, 900, 'it must still count toward the account');
  assert.strictEqual(r.total.sessions, 1000);
  assert.strictEqual(Math.round(r.owned.share.sessions), 10,
    'Owned is 10% of the account, not 100% of what we recognised');
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
