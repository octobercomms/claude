// A deadline alert has to be about deadlines that are due.
//
// From Daniel's inbox on 18 November 2026: "Tax deadlines: 23 due within 14
// days", over a table whose soonest row was 58 days past and whose oldest was
// 269, every one of them labelled "upcoming". He had been getting it every
// morning. "I keep getting these every day. How can I get the system to
// recognise they are done?"
//
// Three faults, each with a guard here:
//
//   1. `getUpcoming` has no lower bound — `due_date <= now() + 14 days`
//      matches everything since the beginning of time. The alert treated that
//      list as "due soon".
//   2. The email printed `status`, the raw column, which still reads
//      "upcoming" on a deadline nine months past. `effective_status` is the
//      field that knows.
//   3. Nothing stopped it sending the same overdue list every day forever.
//
// The real numbers below are from that email, so a regression reproduces the
// exact thing he saw rather than an invented case.
//
//   node tests/tax-deadline-alert.test.js

const assert = require('assert');
const path = require('path');
const Module = require('module');

// The module requires ../../db at load time, which would try to connect.
// Stub it before requiring: none of these tests touch the database, they
// drive the pure functions and a sendAlerts whose query is intercepted.
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [] }) } };

const deadlines = require('../src/services/accounts/deadlines');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };

// The nine-month-old rows from the real email, plus one genuinely due.
const NOW = new Date('2026-11-18T08:15:00Z');
const mk = (type, label, due) => ({
  tax_type: type, period_label: label, due_date: new Date(due), status: 'upcoming',
});
const REAL_ROWS = [
  mk('PENSION', 'Pension Jan 2026', '2026-02-22'),   // -269 days
  mk('PAYE', 'PAYE Jan 2026', '2026-02-22'),
  mk('VAT', 'VAT Q1 2026', '2026-05-05'),            // -196
  mk('PAYE', 'PAYE Aug 2026', '2026-09-20'),         // -58
];

function withDaysUntil(rows, now = NOW) {
  return rows.map((r, i) => ({
    id: r.id || i + 1,
    ...r,
    days_until: Math.ceil((r.due_date - now) / 86400000),
    effective_status: r.due_date < now ? 'overdue' : 'upcoming',
  }));
}

ok('overdue deadlines are separated from deadlines that are due', () => {
  const { overdue, dueSoon } = deadlines.partitionByDue(withDaysUntil(REAL_ROWS));
  assert.strictEqual(dueSoon.length, 0,
    'a deadline months past is still being counted as due soon — this is the '
    + 'bug that produced "23 due within 14 days" over a 269-day-old list');
  assert.strictEqual(overdue.length, 4);
  assert.strictEqual(overdue[0].period_label, 'Pension Jan 2026',
    'the most overdue should lead, being the one most likely to be a record '
    + 'that was never closed');
});

ok('a genuinely due deadline is not swallowed by the overdue pile', () => {
  const soon = mk('VAT', 'VAT Q3 2026', '2026-11-25'); // +7 days from NOW
  const { overdue, dueSoon } = deadlines.partitionByDue(withDaysUntil([...REAL_ROWS, soon]));
  assert.strictEqual(dueSoon.length, 1, 'the one real deadline was lost');
  assert.strictEqual(dueSoon[0].period_label, 'VAT Q3 2026');
  assert.strictEqual(overdue.length, 4);
});

// sendAlerts, with the query and the mailer intercepted.
function runAlert(rows, { now, weeklyDay = 1 } = {}) {
  const sent = [];
  const settingsPath = require.resolve('../src/routes/settings');
  const prevSettings = require.cache[settingsPath];
  require.cache[settingsPath] = {
    id: settingsPath, filename: settingsPath, loaded: true,
    exports: { buildTransporter: () => ({ sendMail: async (m) => { sent.push(m); } }) },
  };
  require.cache[dbPath].exports.query = async () => ({ rows });

  const prevTo = process.env.ACCOUNTS_DIGEST_EMAIL;
  process.env.ACCOUNTS_DIGEST_EMAIL = 'reports@example.com';

  return deadlines.sendAlerts(14, { now, weeklyDay }).then(r => {
    if (prevSettings) require.cache[settingsPath] = prevSettings;
    else delete require.cache[settingsPath];
    if (prevTo === undefined) delete process.env.ACCOUNTS_DIGEST_EMAIL;
    else process.env.ACCOUNTS_DIGEST_EMAIL = prevTo;
    return { result: r, mail: sent[0] };
  });
}

(async () => {
  // 18 Nov 2026 is a Wednesday, so a weeklyDay of Monday means no send.
  const onlyOverdue = await runAlert(REAL_ROWS, { now: NOW, weeklyDay: 1 });
  ok('nothing due means no daily email, however much is overdue', () => {
    assert.strictEqual(onlyOverdue.result.sent, false,
      'it still emails every day about deadlines that are months past — the '
      + 'exact complaint from 18 November');
    assert.strictEqual(onlyOverdue.result.overdue, 4,
      'the overdue count should still be reported to the caller even when no '
      + 'email goes out, or the scheduler log says nothing happened');
  });

  const weekly = await runAlert(REAL_ROWS, { now: NOW, weeklyDay: NOW.getDay() });
  ok('overdue items still get one reminder a week', () => {
    assert.strictEqual(weekly.result.sent, true, 'the weekly nudge never fires');
    assert.ok(/4 overdue/.test(weekly.mail.subject),
      `the subject should say what is actually true, got: ${weekly.mail.subject}`);
    assert.ok(!/due within/.test(weekly.mail.subject),
      'the subject still claims these are due soon');
  });

  const soon = mk('VAT', 'VAT Q3 2026', '2026-11-25');
  const mixed = await runAlert([...REAL_ROWS, soon], { now: NOW, weeklyDay: 1 });
  ok('a real deadline sends, and carries the overdue list with it', () => {
    assert.strictEqual(mixed.result.sent, true, 'a genuine deadline did not alert');
    assert.strictEqual(mixed.result.dueSoon, 1);
    assert.strictEqual(mixed.result.overdue, 4);
    assert.ok(/1 due within 14 days/.test(mixed.mail.subject),
      `the subject should count only what is due, got: ${mixed.mail.subject}`);
    assert.ok(/4 overdue/.test(mixed.mail.subject),
      'the overdue count vanished from the subject');
  });

  ok('the email says overdue, not upcoming, and counts days the right way', () => {
    const html = mixed.mail.html;
    const splitAt = html.indexOf('already overdue');
    assert.ok(splitAt > 0, 'the overdue section is gone from the email');
    const dueSoonSection = html.slice(0, splitAt);
    const overdueSection = html.slice(splitAt);

    // The claim, not a marker: every row in the overdue section says overdue,
    // and none of them says upcoming. The old email labelled all 23 "upcoming"
    // because it printed `status` rather than `effective_status`.
    const overdueRows = overdueSection.match(/<tr><td>(?!<\/)[^]*?<\/tr>/g) || [];
    assert.strictEqual(overdueRows.length, 4,
      `expected the four overdue rows, found ${overdueRows.length}`);
    for (const r of overdueRows) {
      assert.ok(/<td>overdue<\/td>/.test(r),
        `a deadline months past is not labelled overdue: ${r}`);
      assert.ok(!/upcoming/.test(r),
        `a deadline months past is still labelled "upcoming": ${r}`);
    }

    // And the genuinely upcoming one is above, labelled for what it is.
    assert.ok(/VAT Q3 2026/.test(dueSoonSection),
      'the deadline that is actually due is not in the due-soon section');
    assert.ok(!/VAT Q3 2026/.test(overdueSection),
      'a deadline a week away is being reported as overdue');

    assert.ok(/269 days late/.test(html),
      'a 269-day-old deadline is not described as late — the old email printed '
      + '"-269 days" in a column headed Remaining');
    assert.ok(!/-269/.test(html), 'a negative day count is still being printed raw');
  });

  // Awaited out here on purpose. `ok` calls its callback synchronously, so an
  // async callback's failed assertion becomes an unhandled rejection after
  // PASS has already printed — a test that cannot fail is not a test.
  const none = await runAlert([], { now: NOW, weeklyDay: NOW.getDay() });
  ok('an empty list sends nothing at all', () => {
    assert.strictEqual(none.result.sent, false);
    assert.strictEqual(none.result.reason, 'nothing due');
  });

  // ── the same deadline must not be reported every weekday ────────────────
  //
  // The 18 November fix stopped the alert calling nine-month-old entries "due
  // within 14 days" and left a true one repeating: the gate asked only "is
  // anything due", with no memory, so one genuine deadline in the window
  // emailed every weekday until it passed. Ten emails about one deadline
  // trains you to ignore the eleventh.

  const { urgencyBucket } = deadlines._internals;

  ok('urgency is banded, so an approaching deadline re-alerts on crossing', () => {
    assert.strictEqual(urgencyBucket(-1), 'overdue');
    assert.strictEqual(urgencyBucket(0), 'today');
    assert.strictEqual(urgencyBucket(3), 'days_3');
    assert.strictEqual(urgencyBucket(4), 'days_7');
    assert.strictEqual(urgencyBucket(7), 'days_7');
    assert.strictEqual(urgencyBucket(8), 'days_14');
    // The bands have to be distinct, or crossing one is not news.
    const bands = [1, 5, 10].map(urgencyBucket);
    assert.strictEqual(new Set(bands).size, 3,
      'two of the bands collapse, so a deadline moving between them never re-alerts');
  });

  const soonRow = { ...mk('VAT', 'VAT Q3 2026', '2026-11-25'), id: 99 };

  // Already told about it at this urgency.
  const repeat = await runAlert([{ ...soonRow, last_alert_bucket: 'days_7' }], { now: NOW, weeklyDay: 1 });
  ok('a deadline already reported at this urgency sends nothing', () => {
    assert.strictEqual(repeat.result.sent, false,
      'the same deadline was emailed again with nothing changed — this is the daily '
      + 'repetition the 18 November fix left behind');
    assert.strictEqual(repeat.result.reason, 'already alerted at this urgency');
    assert.strictEqual(repeat.result.dueSoon, 1,
      'the caller should still be told what is outstanding even when no email goes');
  });

  // Never mentioned.
  const first = await runAlert([{ ...soonRow, last_alert_bucket: null }], { now: NOW, weeklyDay: 1 });
  ok('a deadline nobody has been told about always sends', () => {
    assert.strictEqual(first.result.sent, true, 'a brand new deadline was suppressed');
  });

  // Mentioned a fortnight ago, now closer.
  const crossed = await runAlert([{ ...soonRow, last_alert_bucket: 'days_14' }], { now: NOW, weeklyDay: 1 });
  ok('a deadline that has become more urgent sends again', () => {
    assert.strictEqual(crossed.result.sent, true,
      'a deadline that moved from "within 14 days" to "within 7" sent nothing, so the '
      + 'one alert that matters most never arrives');
    assert.strictEqual(crossed.result.newsCount, 1);
  });

  // One stale, one new: the new one still carries the email.
  const mixedNews = await runAlert([
    { ...soonRow, last_alert_bucket: 'days_7' },
    { ...mk('PAYE', 'PAYE Nov 2026', '2026-11-24'), id: 98, last_alert_bucket: null },
  ], { now: NOW, weeklyDay: 1 });
  ok('one unreported deadline still sends, and carries the rest with it', () => {
    assert.strictEqual(mixedNews.result.sent, true,
      'a new deadline was suppressed because an older one had already been reported');
    assert.strictEqual(mixedNews.result.newsCount, 1, 'only the new one should count as news');
    assert.strictEqual(mixedNews.result.dueSoon, 2, 'but both belong in the email');
  });

  // The weekly overdue nudge is deliberately exempt.
  const overdueWeekly = await runAlert(
    REAL_ROWS.map(r => ({ ...r, last_alert_bucket: 'overdue' })),
    { now: NOW, weeklyDay: NOW.getDay() }
  );
  ok('the weekly overdue nudge still fires even though nothing changed', () => {
    assert.strictEqual(overdueWeekly.result.sent, true,
      'suppression swallowed the weekly nudge; it is already once a week, and its '
      + 'whole purpose is to keep asking about things nobody has closed');
  });

  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e.message); process.exit(1); });
