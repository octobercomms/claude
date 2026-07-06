# Meta Ads Targeting: A Practical Guide for Another Country

## The Problem

Another Country's Meta spend is returning zero attributed revenue. The ads are running, the clicks are happening (4,333 in February alone), but nothing is converting. The issue is almost certainly audience quality, not creative. You're spending against people who have no meaningful purchase intent for a £600+ made-to-order sofa.

The sarah.roizman post is correct in its diagnosis, even if the £43 course wrapping it is unnecessary. The fix is building audiences from people who already want what you sell, not hoping the algorithm works it out from scratch.

---

## Why the Current Approach is Failing

Another Country's Meta campaigns are generating £0 attributed revenue despite consistent ad spend. There are a few structural reasons for this.

**No first-party signal.** The GA4 tag fires twice, which corrupts attribution data and likely degrades Meta's pixel signal quality. Without clean conversion events flowing back to Meta, the algorithm has nothing to optimise against. It defaults to optimising for clicks, not buyers.

**Advantage+ without conversion history.** Meta's own guidance is clear: Advantage+ works best with 500+ conversion events in the past 30 days. Another Country has 12 orders in February across all channels. The algorithm is operating blind and defaulting to the cheapest CPCs, not the highest-intent audiences.

**Broad audiences with low purchase signal.** Without a strong seed audience or clean pixel data, the campaigns are effectively running as interest-based prospecting against people who may loosely relate to "interiors" or "design" but have no demonstrated purchase behaviour.

---

## The Methodology That Actually Works

There are three audience types worth building, in order of priority.

### 1. Value-Based Lookalike from Existing Buyers

This is the highest-leverage move available, and it requires no ad spend to set up.

Export Another Country's buyer list from WooCommerce. Include email addresses and, where available, total lifetime spend per customer. Upload this to Meta as a Custom Audience with the value column populated. Meta will build a Lookalike weighted toward users who resemble your highest-spending customers, not just anyone who has ever placed an order.

Key points from the research:

- A lookalike seeded from 500 real buyers consistently outperforms one built from 10,000 newsletter subscribers. Quality of seed matters more than size.
- Use only the top 20-25% of customers by average order value. Another Country's AOV is £641 in 2026. Seed with buyers at or above that threshold.
- Rebuild the seed audience every 30-60 days. Lookalikes are static; as your customer base grows, refresh the source.
- Start at 1% similarity. Validate it converts before expanding to 2-3%. Higher percentages dilute quality.

**For Another Country specifically:** The customer list from Cin7/WooCommerce is the starting point. Even 200-300 buyers is enough to create a meaningful seed if they're high-value. The consultative purchase model means customers who convert tend to be high-intent; that signal is worth extracting.

---

### 2. Competitor-Adjacent Audience Targeting

This is the core argument of the sarah.roizman post and it is sound.

The logic: people who follow Benchmark Furniture, Tom Raffield, Pinch, or Loaf on Instagram have already self-selected as design-conscious furniture buyers. They don't need to be educated on why handmade or considered furniture matters. They're already in the market.

**How to build this:**

Meta doesn't always index smaller brand pages as targetable interests. The practical approach:

1. Search competitor brand names in Meta Ads Manager under Detailed Targeting. Test which ones appear as targetable interests.
2. For brands not indexed (common for brands with under 50,000 followers), target adjacent publications and communities instead: Wallpaper, Dezeen, The World of Interiors, Livingetc, The Modern House.
3. Layer with income or behavioural signals: "Engaged Shoppers," "Luxury goods buyers," or homeowners in relevant postcodes (SW, W, EC, and equivalents in Edinburgh, Bristol, Manchester).

**Note on January 2026 changes:** Meta removed a significant number of detailed interest categories in January 2026. Some niche interest targeting options no longer exist. This makes competitor-adjacent publication targeting more important than direct brand targeting.

---

### 3. Engagement-Based Retargeting

Before spending on cold prospecting, exhaust the warm audiences already built organically.

Build custom audiences from:

- Instagram profile visitors (last 90 days)
- People who engaged with any post or reel (last 90 days)
- Website visitors who viewed product pages but did not reach checkout (Meta pixel, once tracking is clean)
- Video viewers who watched 75%+ of any content

These audiences are small for Another Country right now, but they're the highest-conversion pool available. Even at low volume, they validate creative and messaging before spending against cold audiences.

---

## The Blocking Issue: Pixel Signal

None of the above works properly without clean conversion data flowing to Meta.

The GA4 double-firing issue that corrupts analytics also affects the Meta pixel if they share a tag implementation. Before scaling any Meta spend, confirm:

1. The Meta pixel fires once per event, via a direct implementation or properly deduplicated GTM setup.
2. The Conversions API (CAPI) is implemented via server-side, sending purchase events directly from WooCommerce to Meta. This recovers 15-30% of conversion events lost to iOS tracking restrictions.
3. Purchase events are firing with value passed correctly so the algorithm can optimise for revenue, not just clicks.

WooCommerce has a native Meta for WooCommerce plugin that handles CAPI without custom development. Luke should be able to implement this in under a day.

Without this in place, any budget increase is being optimised against flawed signals.

---

## Implementation Sequence

| Priority | Action | Who | Time Required |
|---|---|---|---|
| 1 | Audit Meta pixel — confirm single-fire, check CAPI status | Luke | 2-4 hours |
| 2 | Export buyer list from WooCommerce/Cin7, segment by AOV | Rachel / Daniel | 1 hour |
| 3 | Upload to Meta, build value-based lookalike at 1% | Daniel | 30 minutes |
| 4 | Test competitor-adjacent interest targeting | Daniel | 1 hour |
| 5 | Build engagement retargeting audiences from Instagram and website | Daniel | 30 minutes |
| 6 | Run split test: lookalike vs. competitor-adjacent vs. engagement retarget | Daniel | Ongoing |

---

## Budget Logic

Another Country's current spend is roughly £1,000-£1,200 per month across Meta. At that level, with zero attributed return, the problem is audience quality and signal, not spend volume.

The right approach for the next 90 days:

- Pause Advantage+ campaigns entirely until CAPI is in place and pixel is clean.
- Allocate 60% of budget to lookalike prospecting once the seed audience is built.
- Allocate 30% to competitor-adjacent interest targeting as a parallel test.
- Allocate 10% to engagement retargeting; scale this as warm audiences grow.

Do not increase total spend until at least one audience type shows a positive ROAS. The current trajectory is burning budget against an algorithm that has no idea what a qualified Another Country buyer looks like.

---

## What the sarah.roizman Course Is Actually Selling

The core insight is legitimate: go where buyers already are, rather than waiting for Meta to find them. But the methodology described is standard audience-building practice. You don't need a £43 course to implement it. What you need is:

- A clean buyer list from Cin7
- A working pixel with CAPI
- 2-3 hours in Meta Ads Manager

The framing around "Andromeda" is real. Meta's algorithm shift has made broad Advantage+ targeting less reliable for accounts without strong conversion history. The response isn't more spend or more creative testing; it's sharper audience inputs so the algorithm has something meaningful to work from on day one.

---

<!-- ─────────────────────────────────────────────────────────────────────── -->

## OMI editor's note — corrections & how this is wired into the platform

_Added by the October team when this brief was folded into OMI. The client-facing
guidance above is preserved verbatim; the notes below are the operational version
we actually run on._

**Two figures to treat as soft, not literal:**

1. **"Advantage+ works best with 500+ conversions / 30 days."** That's a
   best-practice *threshold*, not a hard requirement. Meta's actual learning-phase
   exit is roughly **50 conversions per ad set per week**. Another Country is well
   below either, so the conclusion (Advantage+ is flying blind) still holds — just
   don't quote "500" as a rule.
2. **"£0 attributed revenue."** With GA4 double-firing *and* no CAPI, a zero
   attribution read is partly a **measurement artefact**, not proof the channel is
   dead. Fix tracking (pixel single-fire + CAPI) before declaring Meta a write-off
   or killing spend on the strength of that number.

One nuance on "pause Advantage+ entirely": pause it **now**, while the signal is
blind — but once a value-based lookalike seed exists, feeding that lookalike *into*
an Advantage+ Shopping campaign is often better than a manual ad set. It's "pause
until you have a seed", not "never use ASC again".

**Where this lives in OMI:**

- **Strategist** — the methodology is distilled into the `meta-audiences` playbook
  fragment (`dev/platform/backend/src/data/marketingPlaybooks/meta-audiences.md`)
  and injected into every Strategist briefing alongside the general `ads` playbook,
  so recommendations are grounded in it automatically.
- **Paid → Audiences tab** — the panel carries a methodology card that walks the
  AM through the priority order (value-based lookalike → competitor-adjacent →
  engagement retargeting) and ties each move to the tools already there
  (customer-list upload → Meta Custom Audience export → build the 1% lookalike in
  Meta).
