// GA4's channel grouping, folded into PESO.
//
// Measure lives on the client Dashboard and answers "how is the account
// doing". Each PESO page needs the same question narrowed to itself: what did
// Paid actually drive, and is that a lot or a little? A number without that
// second half is just a number.
//
// So the frame on every pillar page is the same: this pillar's sessions,
// orders and revenue, and its share of the account over the same range.
//
// The data costs nothing extra. `salesTraffic` already asks GA4 for sessions,
// users, transactions and revenue grouped by `sessionDefaultChannelGroup`,
// then throws away everything but sessions when it builds `channels`. This
// keeps what was already fetched.

// GA4's default channel group names, lowercased for matching. The casing and
// punctuation GA4 returns has moved before ("Paid Social" vs "paid social"),
// so match on a normalised key rather than the literal.
const PILLAR_BY_CHANNEL = {
  // Paid — anything bought. Cross-network is Performance Max and similar,
  // which is paid by definition even though it spans placements.
  'paid search': 'paid',
  'paid social': 'paid',
  'paid shopping': 'paid',
  'paid video': 'paid',
  'paid other': 'paid',
  'display': 'paid',
  'cross-network': 'paid',

  // Owned — the site's own pulling power. Owned is SEO in this platform's
  // vocabulary, so it is organic search alone; email has its own section.
  'organic search': 'owned',
  'organic shopping': 'owned',

  // Shared — social that was not bought.
  'organic social': 'shared',
  'organic video': 'shared',

  // Earned — someone else's site sending traffic, which is what coverage
  // looks like in GA4.
  'referral': 'earned',
};

// Deliberately unmapped, and each for a reason:
//
//   Direct     Returning customers, bookmarks, dark social and everything
//              GA4 could not attribute. Counting it as Earned would flatter
//              PR with traffic it may have had nothing to do with.
//   Email      Its own channel in OMI, not one of the four pillars.
//   Affiliates A commercial arrangement rather than a PESO activity.
//   Unassigned GA4 saying it does not know.
//
// They still count toward the account total, so a pillar's share is a share
// of everything, not of the mapped subset. A pillar that looks small next to
// a large Direct number is a true reading, not a rounding artefact.

function pillarFor(channel) {
  if (!channel) return null;
  return PILLAR_BY_CHANNEL[String(channel).trim().toLowerCase()] || null;
}

// `rows` is [{ channel, sessions, orders, revenue }], one per channel.
// Returns { paid, earned, shared, owned, unmapped, total }, each
// { sessions, orders, revenue, channels } plus a `share` of the account on
// the four pillars.
function summarisePillars(rows) {
  const blank = () => ({ sessions: 0, orders: 0, revenue: 0, channels: [] });
  const out = { paid: blank(), earned: blank(), shared: blank(), owned: blank(), unmapped: blank() };
  const total = { sessions: 0, orders: 0, revenue: 0 };

  for (const r of rows || []) {
    const sessions = Number(r.sessions) || 0;
    const orders = Number(r.orders) || 0;
    const revenue = Number(r.revenue) || 0;
    total.sessions += sessions;
    total.orders += orders;
    total.revenue += revenue;

    const key = pillarFor(r.channel) || 'unmapped';
    const b = out[key];
    b.sessions += sessions;
    b.orders += orders;
    b.revenue += revenue;
    if (r.channel) b.channels.push({ channel: r.channel, sessions, orders, revenue });
  }

  for (const key of ['paid', 'earned', 'shared', 'owned', 'unmapped']) {
    const b = out[key];
    b.revenue = Math.round(b.revenue);
    b.channels.sort((a, c) => c.sessions - a.sessions);
    // Share of the account, not of the mapped subset: a pillar sitting next
    // to a large Direct number should read small, because it is.
    b.share = {
      sessions: total.sessions ? (b.sessions / total.sessions) * 100 : null,
      orders: total.orders ? (b.orders / total.orders) * 100 : null,
      revenue: total.revenue ? (b.revenue / Math.round(total.revenue)) * 100 : null,
    };
  }

  return { ...out, total: { ...total, revenue: Math.round(total.revenue) } };
}

module.exports = { summarisePillars, pillarFor, PILLAR_BY_CHANNEL };
