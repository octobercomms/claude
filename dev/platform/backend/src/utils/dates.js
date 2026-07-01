// Format a Date as YYYY-MM-DD using its LOCAL calendar components.
//
// Do NOT reach for `date.toISOString().split('T')[0]` to do this. toISOString()
// converts to UTC, so a Date sitting at local midnight — which is how both
// `new Date(year, month, day)` and node-postgres' DATE parser produce values —
// rolls back to the *previous day* whenever the process clock runs ahead of
// UTC. Under TZ=Europe/London during BST, local midnight on 1 June becomes
// 31 May 23:00 UTC, i.e. "2026-05-31". That one-day slip crosses the month
// boundary and shifted whole monthly reporting periods back a month
// (a report run on 1 July reported on May instead of June).
//
// Reading the LOCAL components instead is timezone-safe for pure date values.
function toYmdLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

module.exports = { toYmdLocal };
