// A report held for review must not reach the client.
//
// generateReport called sendReport directly at each of its three paths, so a
// scheduled report was written, rendered and delivered in one pass with nobody
// able to read it in between. For a month whose numbers need a sentence of
// context, the choice was to let it go bare or to turn scheduling off.
//
// The failure mode this guards is one-directional and expensive. A held report
// that goes out anyway has reached a client and cannot be recalled; a sent
// report that gets held is a nudge nobody acted on. So every ambiguous case
// here resolves towards holding, including the one that looks like a bug:
// review is on and no reviewer address is configured. Sending because the
// nudge cannot be delivered would do precisely the opposite of what the
// setting asks.
//
//   node tests/report-review-hold.test.js

const assert = require('assert');

// The db has to answer sendReport's own lookup, because deliverOrHold calls
// sendReport inside the module and it cannot be stubbed from outside. That is
// the better test anyway: what matters is whether the CLIENT received an
// email, not whether an internal function was called.
const dbPath = require.resolve('../src/db');
let reportRow = null;
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: async (sql) => {
      if (/FROM reports r JOIN clients c/.test(sql)) return { rows: reportRow ? [reportRow] : [] };
      return { rows: [], rowCount: 0 };
    },
  },
};

const settingsPath = require.resolve('../src/utils/settings');
let settingValue = null;
require.cache[settingsPath] = {
  id: settingsPath, filename: settingsPath, loaded: true,
  exports: { getSetting: async () => settingValue },
};

const emailPath = require.resolve('../src/services/emailService');
const sent = { client: [], review: [] };
require.cache[emailPath] = {
  id: emailPath, filename: emailPath, loaded: true,
  exports: {
    sendMonthlyReport: async (a) => { sent.client.push({ kind: 'monthly', ...a }); },
    sendWeeklyReport: async (a) => { sent.client.push({ kind: 'weekly', ...a }); },
    sendReportReview: async (a) => { sent.review.push(a); },
  },
};

const reportService = require('../src/services/reportService');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };

function reset() {
  sent.client.length = 0;
  sent.review.length = 0;
  settingValue = null;
  delete process.env.REPORTS_REVIEW_EMAIL;
  delete process.env.ALERT_EMAIL;
}

const report = (over = {}) => ({
  id: 'r-1',
  client_id: 'c-1',
  client_name: 'Forgeworks',
  report_type: 'monthly',
  period_start: new Date('2026-10-01'),
  period_end: new Date('2026-10-31'),
  review_before_send: false,
  ...over,
});

// `stubSend` only arms the row sendReport will read. Whether the client got
// anything is read off the email stubs.
function stubSend(row) { reportRow = row; }
const clientGotEmail = () => sent.client.length;

(async () => {
  // ── review off: unchanged behaviour ────────────────────────────────────────

  reset();
  stubSend(report({ review_before_send: false, report_recipients: { monthly: ['client@example.com'], weekly: [] } }));
  const auto = await reportService.deliverOrHold(
    report({ review_before_send: false }),
    { metrics: [{ label: 'Sessions', value: '1,204' }] }
  );

  ok('a client without review set still gets its report straight away', () => {
    assert.strictEqual(clientGotEmail(), 1,
      'the report was held for a client who has not asked for review, which turns every '
      + 'scheduled report into a task');
    assert.strictEqual(sent.client[0].to[0], 'client@example.com');
    assert.deepStrictEqual(sent.client[0].metrics, [{ label: 'Sessions', value: '1,204' }],
      'the metrics generateReport computed were dropped on the way through, so the client '
      + 'got the bare "see the attached PDF" fallback');
    assert.strictEqual(sent.review.length, 0, 'a reviewer was emailed for a client not under review');
    assert.ok(!auto || !auto.held, 'an auto-sent report reported itself as held');
  });

  // ── review on: held, reviewer nudged ───────────────────────────────────────

  reset();
  stubSend(report({ review_before_send: true, report_recipients: { monthly: ['client@example.com'], weekly: [] } }));
  process.env.REPORTS_REVIEW_EMAIL = 'reviewer@example.com';
  const held = await reportService.deliverOrHold(report({ review_before_send: true }), { metrics: [1] });

  ok('a client under review has nothing sent to them', () => {
    assert.strictEqual(clientGotEmail(), 0,
      'the report went to the client despite review being on — this is the failure that '
      + 'cannot be undone');
    assert.strictEqual(held.held, true);
  });

  ok('the reviewer is emailed instead, and told it has not gone out', () => {
    assert.strictEqual(sent.review.length, 1, 'nobody was nudged, so the report waits unseen forever');
    const n = sent.review[0];
    assert.strictEqual(n.to, 'reviewer@example.com');
    assert.strictEqual(n.clientName, 'Forgeworks');
    assert.strictEqual(n.clientId, 'c-1',
      'the client id did not travel, so the link cannot reach that client\'s reports');
    assert.ok(n.period, 'the nudge does not say which period it is about');
  });

  // ── the setting beats the environment ──────────────────────────────────────

  reset();
  stubSend(report({ review_before_send: true, report_recipients: { monthly: ['client@example.com'], weekly: [] } }));
  settingValue = 'from-settings@example.com';
  process.env.REPORTS_REVIEW_EMAIL = 'from-env@example.com';
  await reportService.deliverOrHold(report({ review_before_send: true }), {});

  ok('the Settings value wins over the environment', () => {
    assert.strictEqual(sent.review[0].to, 'from-settings@example.com',
      'the environment overrode Settings, so changing the reviewer in the UI does nothing');
  });

  // ── review on, no reviewer: still held ─────────────────────────────────────

  reset();
  stubSend(report({ review_before_send: true, report_recipients: { monthly: ['client@example.com'], weekly: [] } }));
  const noReviewer = await reportService.deliverOrHold(report({ review_before_send: true }), {});

  ok('no reviewer configured holds the report rather than sending it', () => {
    assert.strictEqual(clientGotEmail(), 0,
      'with review on and no reviewer address, the report was sent to the client. '
      + 'A missing address is a misconfiguration; delivering because of it does the '
      + 'opposite of what the setting asks, to the one audience that cannot unsee it');
    assert.strictEqual(noReviewer.held, true);
    assert.strictEqual(noReviewer.reviewer, null);
    assert.ok(/no reviewer/i.test(noReviewer.reason || ''),
      'the result does not say why nothing happened, so the silence looks like success');
  });

  // ── a failed nudge must not send, and must not fail the report ─────────────

  reset();
  stubSend(report({ review_before_send: true, report_recipients: { monthly: ['client@example.com'], weekly: [] } }));
  process.env.REPORTS_REVIEW_EMAIL = 'reviewer@example.com';
  require.cache[emailPath].exports.sendReportReview = async () => { throw new Error('SMTP down'); };
  const nudgeFailed = await reportService.deliverOrHold(report({ review_before_send: true }), {});
  require.cache[emailPath].exports.sendReportReview = async (a) => { sent.review.push(a); };

  ok('a nudge that fails to send does not release the report', () => {
    assert.strictEqual(clientGotEmail(), 0,
      'a failed reviewer email fell through to sending the client their report');
    assert.strictEqual(nudgeFailed.held, true,
      'the report is still generated and waiting; a failed nudge must not mark it otherwise');
  });

  // ── every generate path goes through the gate ──────────────────────────────

  ok('all three generate paths route through the gate, not around it', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/services/reportService.js'), 'utf8');
    const body = src.slice(0, src.indexOf('async function deliverOrHold'));
    // Inside generateReport and its helpers, every delivery must be the gate.
    // A direct sendReport call left behind is a path that keeps auto-sending,
    // and it would be the one nobody notices until a client has had it.
    const direct = (body.match(/await sendReport\(/g) || []).length;
    assert.strictEqual(direct, 0,
      `${direct} generate path(s) still call sendReport directly, bypassing the review hold`);
    const gated = (src.match(/await deliverOrHold\(/g) || []).length;
    assert.strictEqual(gated, 3,
      `expected all three generate paths to call deliverOrHold, found ${gated}`);
  });

  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e.message); process.exit(1); });
