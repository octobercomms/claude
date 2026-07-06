<!-- Distilled from October's Another Country Meta-targeting brief (docs/anothercountry-meta-targeting) — house methodology, not marketingskills. -->
## Meta audience & targeting methodology

Goal: feed Meta's algorithm sharp audience inputs so it optimises for buyers, not the cheapest clicks. On low-conversion accounts the problem is almost always audience quality and signal, not creative or spend volume. Fix the inputs before touching budget.

**Signal comes first — nothing below works without it.** Before recommending any audience or budget move, check that conversion tracking is clean: pixel fires once per event (no GA4/GTM double-fire), Conversions API (CAPI) is sending server-side purchase events, and purchase *value* is passed so the algorithm can optimise for revenue. WooCommerce/Shopify have native CAPI plugins — no custom dev. Zero recorded conversions on real spend usually means broken tracking, not a dead channel; say so and fix tracking before declaring the channel a write-off.

**Advantage+ / broad without conversion history flies blind.** Meta's learning phase wants ~50 conversions per ad set per week to exit (the "500 conversions/30 days" figure is a best-practice threshold, not a hard rule). Below that, broad Advantage+ defaults to the cheapest CPCs, not the highest-intent buyers. Pause broad ASC while signal is blind — but once a value-based lookalike seed exists, feeding *that* lookalike into an Advantage+ Shopping campaign beats a manual ad set.

**Three audience types, in priority order:**

1. **Value-based lookalike from real buyers** — highest leverage, no spend to set up. Seed from the customer list (emails + lifetime spend), using only the **top 20–25% by AOV**. Quality of seed beats size: 200–500 high-value buyers outperform 10,000 newsletter subscribers. Start at **1% similarity**, validate it converts, then expand to 2–3%. Rebuild the seed every **30–60 days** as the customer base grows.
2. **Competitor-adjacent interest targeting** — target people already in-market. When Meta won't index smaller competitor brand pages as interests (common under ~50k followers), target adjacent publications/communities instead, then layer income/behaviour/postcode signals. Note: Meta cut many detailed-interest categories in Jan 2026, which makes publication-level targeting more reliable than direct brand targeting.
3. **Engagement retargeting** — exhaust warm audiences before cold prospecting: social profile visitors + post/reel engagers (last 90 days), product-page viewers who didn't checkout, 75%+ video viewers. Small but the highest-conversion pool; use it to validate creative before spending cold.

**Budget split when signal is clean** (typical starting point): ~60% value-based lookalike prospecting, ~30% competitor-adjacent as a parallel test, ~10% engagement retargeting (scale as warm audiences grow). Don't raise total spend until at least one audience type shows positive ROAS.

**Always exclude** existing customers and recent converters from prospecting — spending to reach people who already bought is waste.

**Attribution caveat** — platform-reported conversions are inflated and double-count across platforms; reason in blended terms and cross-check against GA4. A broken-tracking zero is not the same as a genuine zero.
