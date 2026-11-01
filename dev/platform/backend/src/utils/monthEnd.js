/**
 * Is today the last day of the month, in the platform's own timezone?
 *
 * node-cron has no `L`, so a job that must run on the last evening of the
 * month fires on every day that could be the last one (28 to 31) and leaves
 * immediately unless tomorrow is the 1st.
 *
 * The timezone matters and is the part that is easy to get wrong. The crons
 * fire on Europe/London, but `new Date().getDate()` reads the server's own
 * clock, and a server on UTC is on a different date from London for an hour
 * of every summer evening. At 22:00 London in July it is 21:00 UTC and the
 * same day, which is why this has never bitten; move the job later and it
 * would. Reading the day through `Intl` in the named zone removes the
 * question rather than relying on the gap staying small.
 */
function lastDayOfMonth(tz = 'Europe/London', now = new Date()) {
  const dayIn = (d) => Number(new Intl.DateTimeFormat('en-GB',
    { timeZone: tz, day: 'numeric' }).format(d));
  // Tomorrow being the 1st is the definition, and it needs no table of
  // month lengths and no leap-year rule.
  return dayIn(new Date(now.getTime() + 24 * 60 * 60 * 1000)) === 1;
}

module.exports = { lastDayOfMonth };
