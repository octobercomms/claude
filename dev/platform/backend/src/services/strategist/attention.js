// Which clients are slipping, across the whole book.
//
// The per-client queue answers "what is open for Falcon". The question an
// agency owner actually has on a Monday is "which of my fourteen clients has
// something on fire", and no per-client screen answers that however well it is
// placed. This turns every client's open crucial items into one ranked list
// for the Clients page.
//
// Only crucial items count. The whole point of the crucial/nice split is that
// crucial means it moves the needle in the next 30 days; letting nice-to-haves
// raise an alarm would make the alarm meaningless within a month, which is how
// a "needs attention" number becomes one nobody looks at.

// A crucial item open this long is slipping rather than simply in progress.
// Two weeks is deliberately longer than the panel's own seven-day age badge:
// the badge is a nudge while you are already looking at that client, this is
// an interruption across all of them, and an interruption has to earn itself.
const STALE_DAYS = 14;

// Whole days, floored, never negative. Null for anything unparseable, so a bad
// timestamp reads as unknown rather than as a wrong age.
function ageInDays(since, now = new Date()) {
  if (!since) return null;
  const t = since instanceof Date ? since.getTime() : Date.parse(since);
  if (!Number.isFinite(t)) return null;
  const ms = now.getTime() - t;
  if (ms < 0) return 0;
  return Math.floor(ms / 86400000);
}

// `rows` is one row per client that has open crucial items:
//   { client_id, client_name, slug, crucial_open, oldest_raised_at }
//
// Returns { clients, stale, total } where:
//   clients  every client with an open crucial item, worst first, each with
//            its age in days and whether it has crossed the threshold
//   stale    how many have crossed it — the number on the tile
//   total    how many have any open crucial item at all
//
// Worst first means oldest first, then most items. A client with one item open
// 30 days is in more trouble than one with four raised yesterday: age is the
// signal that something is being avoided rather than worked.
function summariseAttention(rows, { now = new Date(), staleDays = STALE_DAYS } = {}) {
  const clients = (rows || [])
    .map(r => {
      const days = ageInDays(r.oldest_raised_at, now);
      return {
        client_id: r.client_id,
        client_name: r.client_name,
        slug: r.slug || null,
        crucial_open: Number(r.crucial_open) || 0,
        oldest_days: days,
        // An unknown age cannot be called stale. Saying nothing is the right
        // answer when the data does not support saying something.
        stale: days != null && days >= staleDays,
      };
    })
    .filter(c => c.crucial_open > 0)
    .sort((a, b) => {
      const ad = a.oldest_days == null ? -1 : a.oldest_days;
      const bd = b.oldest_days == null ? -1 : b.oldest_days;
      if (bd !== ad) return bd - ad;
      return b.crucial_open - a.crucial_open;
    });

  return {
    clients,
    stale: clients.filter(c => c.stale).length,
    total: clients.length,
    stale_days: staleDays,
  };
}

module.exports = { summariseAttention, ageInDays, STALE_DAYS };
