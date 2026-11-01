/**
 * The authority fill runs on the last evening of the month.
 *
 * It used to run at 07:00 on the 1st, one hour before the monthly reports go
 * out at 08:00 — two crons that know nothing about each other, with an hour
 * between them. Moz being slow, a rate limit, or a failure that morning
 * would send every client's report carrying last month's domain authority,
 * and nobody would be told. Daniel asked whether it could fetch on the last
 * day instead, "ready for the report on the 1st". It can.
 *
 * node-cron has no `L`, so the job fires on days 28 to 31 and leaves unless
 * tomorrow is the 1st. These pin that rule, the leap years either side of
 * it, and the timezone the day is read in.
 *
 *   node tests/month-end.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { lastDayOfMonth } = require('../src/utils/monthEnd');

const at = (iso) => new Date(iso);
const TZ = 'Europe/London';

test('the last evening of a 31-day month fires, the one before does not', () => {
  assert.equal(lastDayOfMonth(TZ, at('2026-10-31T22:00:00Z')), true);
  assert.equal(lastDayOfMonth(TZ, at('2026-10-30T22:00:00Z')), false);
  assert.equal(lastDayOfMonth(TZ, at('2026-10-29T22:00:00Z')), false);
});

test('a 30-day month ends on the 30th', () => {
  assert.equal(lastDayOfMonth(TZ, at('2026-11-30T22:00:00Z')), true);
  assert.equal(lastDayOfMonth(TZ, at('2026-11-29T22:00:00Z')), false);
});

test('February is right in a common year and in a leap year', () => {
  // The rule most hand-written month-length tables get wrong, and the reason
  // this asks "is tomorrow the 1st" rather than counting days.
  assert.equal(lastDayOfMonth(TZ, at('2026-02-28T22:00:00Z')), true, '2026 is not a leap year');
  assert.equal(lastDayOfMonth(TZ, at('2028-02-28T22:00:00Z')), false, '2028 is');
  assert.equal(lastDayOfMonth(TZ, at('2028-02-29T22:00:00Z')), true);
  assert.equal(lastDayOfMonth(TZ, at('2100-02-28T22:00:00Z')), true, '2100 is divisible by 100, so not a leap year');
  assert.equal(lastDayOfMonth(TZ, at('2000-02-28T22:00:00Z')), false, '2000 is divisible by 400, so it is');
});

test('December into January crosses the year', () => {
  assert.equal(lastDayOfMonth(TZ, at('2026-12-31T22:00:00Z')), true);
  assert.equal(lastDayOfMonth(TZ, at('2027-01-31T22:00:00Z')), true);
});

test('the day is read in the platform timezone, not the server one', () => {
  // 23:30 UTC on the 31st is already the 1st in Sydney and still the 31st in
  // London. A job on London time must not fire or skip on another zone's
  // idea of the date.
  const edge = at('2026-10-31T23:30:00Z');
  assert.equal(lastDayOfMonth('Europe/London', edge), true, 'still the 31st in London');
  assert.equal(lastDayOfMonth('Australia/Sydney', edge), false,
    'already the 1st in Sydney, so its "tomorrow" is the 2nd');
});

test('British Summer Time does not shift the answer', () => {
  // 22:00 London in summer is 21:00 UTC: the same date, which is why the old
  // 07:00 schedule never showed this. Asserted so a later time change does.
  assert.equal(lastDayOfMonth(TZ, at('2026-07-31T21:00:00Z')), true);
  assert.equal(lastDayOfMonth(TZ, at('2026-07-30T21:00:00Z')), false);
});

test('the scheduler actually uses it, on the days that can be the last', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'scheduler.js'), 'utf8');
  assert.match(src, /cron\.schedule\('0 22 28-31 \* \*'/,
    'the authority fill fires on each day that could be the last of the month');
  assert.match(src, /if \(!lastDayOfMonth\(PLATFORM_TZ\)\) return;/,
    'and leaves immediately unless tomorrow is the 1st, in the platform timezone');
  assert.ok(!/cron\.schedule\('0 7 1 \* \*'/.test(src),
    'the old morning-of-the-1st schedule is gone, not left running alongside');
  // The report it exists to feed still goes out on the 1st.
  assert.match(src, /cron\.schedule\('0 8 1 \* \*'/,
    'the monthly reports still run on the 1st, which is what this is early for');
});
