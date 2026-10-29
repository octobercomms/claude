// A report with nowhere to go must not be generated.
//
// Until 29 Oct 2026 the recipients check lived only in sendReport, which runs
// after generateReport has pulled every connector, written a Claude narrative
// and rendered a PDF. A client with an empty report_recipients therefore paid
// for a full report every Monday and received nothing: 9 of 10 weekly reports
// at the time this was found.
//
// runScheduledReports now asks recipientsFor() before spending anything, and
// sendReport asks the same function again at send time. The danger in that
// arrangement is drift — if the two ever read report_recipients differently,
// the scheduler skips a client who would have been delivered, or builds one
// that gets binned anyway. These tests pin the reading.
//
//   node tests/report-recipients.test.js

const { recipientsFor } = require('../src/services/reportService');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

const has = (recipients, type) => recipientsFor(recipients, type).length > 0;

check('a configured weekly list is deliverable',
  has({ weekly: ['am@october.co'] }, 'weekly'));

check('a configured monthly list is deliverable',
  has({ monthly: ['client@example.com'] }, 'monthly'));

check('the two lists are independent — weekly set, monthly not',
  has({ weekly: ['am@october.co'] }, 'weekly') && !has({ weekly: ['am@october.co'] }, 'monthly'));

check('and the other way round',
  has({ monthly: ['am@october.co'] }, 'monthly') && !has({ monthly: ['am@october.co'] }, 'weekly'));

// The nine clients this was found on: report_recipients is {} or absent.
check('an empty recipients object is not deliverable', !has({}, 'weekly'));
check('a null recipients column is not deliverable', !has(null, 'weekly'));
check('undefined is not deliverable', !has(undefined, 'weekly'));
check('an empty array is not deliverable', !has({ weekly: [] }, 'weekly'));

// The shapes that have a length but no address in them.
check('a list of blank strings is not deliverable',
  !has({ weekly: ['', '   '] }, 'weekly'),
  'a length of 2 and nowhere to send');
check('non-string entries are dropped',
  !has({ weekly: [null, 0, false, {}] }, 'weekly'));
check('a real address survives alongside blanks',
  recipientsFor({ weekly: ['', 'am@october.co', '  '] }, 'weekly').length === 1);

// A string where a list belongs is a misconfiguration, not one recipient:
// sendReport spreads the result into an email `to`, and a string would
// become an array of characters.
check('a bare string is not treated as a list',
  !has({ weekly: 'am@october.co' }, 'weekly'));

// Anything that is not 'monthly' reads the weekly list, matching how
// runScheduledReports classifies a report.
check('an unknown report type reads the weekly list',
  has({ weekly: ['am@october.co'] }, 'quarterly'));

// ── Delivery classification ─────────────────────────────────────────────
//
// What /reports/delivery and the Setup readiness item both have to get right.
// runScheduledReports defaults weekly_day to Monday, so every active client is
// due a weekly report; monthly only runs when monthly_day is set.
const deliveryFor = (client) => {
  const schedule = client.report_schedule || {};
  const weeklyTo = recipientsFor(client.report_recipients, 'weekly');
  const monthlyTo = recipientsFor(client.report_recipients, 'monthly');
  const monthlyScheduled = !!schedule.monthly_day;
  return {
    weekly: { recipients: weeklyTo.length, scheduled: true, delivers: weeklyTo.length > 0 },
    monthly: { recipients: monthlyTo.length, scheduled: monthlyScheduled, delivers: monthlyScheduled && monthlyTo.length > 0 },
  };
};

check('a client with no report_schedule at all is still due a weekly report',
  deliveryFor({ report_recipients: { weekly: ['am@october.co'] } }).weekly.scheduled === true,
  'weekly_day defaults to Monday — an empty schedule is not "off"');

check('monthly is only due when monthly_day is set',
  deliveryFor({ report_recipients: { monthly: ['c@x.com'] } }).monthly.scheduled === false
    && deliveryFor({ report_schedule: { monthly_day: 1 }, report_recipients: { monthly: ['c@x.com'] } }).monthly.scheduled === true);

// The case the old readiness check scored as "ok": it summed both lists, so
// monthly recipients masked an empty weekly list while every weekly report
// was still being binned.
const monthlyOnly = deliveryFor({ report_schedule: { monthly_day: 1 }, report_recipients: { monthly: ['c@x.com'] } });
check('monthly recipients do not cover for an empty weekly list',
  monthlyOnly.monthly.delivers === true && monthlyOnly.weekly.delivers === false,
  'the client receives a monthly report and no weekly one');

check('a fully configured client delivers on both',
  (() => {
    const d = deliveryFor({ report_schedule: { monthly_day: 1 }, report_recipients: { weekly: ['a@x.com'], monthly: ['b@x.com'] } });
    return d.weekly.delivers && d.monthly.delivers;
  })());

check('the nine: an empty recipients object delivers nothing',
  (() => {
    const d = deliveryFor({ report_recipients: {} });
    return !d.weekly.delivers && !d.monthly.delivers && d.weekly.scheduled;
  })(),
  'scheduled weekly, nobody to send to');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
