# AI Sniper Ad Funnel — Research Brief

**Status:** Research / teardown (not yet a build)
**Date:** 2026-07-28
**Purpose:** Decode the "AI Sniper ad funnel for B2B agencies" pitch, separate what's
real from what's overstated, ground it in current (2026) ad reality, and map how
October could actually build it from assets we already own.

---

## 1. What the pitch actually is (plain English)

Stripped of the "AI Sniper" branding, this is a **classic direct-response paid-ads
lead funnel for a B2B service business**, with an LLM (Claude) used to do the
research and copy work that an expensive strategist would otherwise do by hand.

The claimed flow:

```
Deep ICP research (Claude)  →  resonant ad creative  →  landing page w/ qualification form
        ↑                                                          │
        │                                                          ▼
   feedback loop  ◄──  CRM + email nurture  ◄──  qualified leads only book a call
```

Five moving parts:

1. **ICP intelligence layer** — feed Claude your past client calls, service info, and
   templates covering: customer psychology, awareness stage, market sophistication,
   desired situation, problems/pain, worldview, and competitor analysis.
2. **Creative layer** — Claude turns that intelligence into ads built from case
   studies and testimonials, written to resonate with one specific ICP.
3. **Landing page + qualification form** — more detail on the service, plus a form
   that screens on revenue (and other fit criteria) so unqualified leads self-filter.
4. **Booking + nurture layer** — qualified leads book a call; email nurture + CRM
   warm them before the call; a defined sales process closes.
5. **Feedback loop** — call/lead data flows back into the ICP layer so targeting and
   messaging sharpen over time.

**Verdict in one line:** the *architecture* is sound and well-worn; the *"hyper-specific
targeting"* framing is the part that's dated (see §3). The genuine edge is using an LLM
to compress weeks of customer research + copy into hours.

---

## 2. What's genuinely real here

The pitch rests on legitimate direct-response frameworks, mostly traceable to Eugene
Schwartz's *Breakthrough Advertising*:

| Pitch term | Established concept | Why it matters |
|---|---|---|
| "Awareness stages" | Schwartz's **5 stages of awareness** (Unaware → Problem-Aware → Solution-Aware → Product-Aware → Most Aware) | Determines how direct the ad/LP can be. Cold B2B traffic is usually Problem- or Solution-Aware, so lead-with-the-pain, not lead-with-the-offer. |
| "Sophistication of the market" | Schwartz's **5 levels of market sophistication** | Tells you whether to lead with a raw claim, a bigger claim, a mechanism, a *new* mechanism, or pure identity/resonance. Agency markets are late-stage → you compete on mechanism + identity, not "we get leads." |
| "Desired situation / problems / pain / worldview" | Standard **ICP / VoC (voice-of-customer) research** | This is the real fuel. Ads that quote the prospect's own language outperform clever copy. |
| "In-depth competition analysis" | Positioning / **category design** | Needed precisely because agency markets are saturated (high sophistication). |
| Qualify-then-book | **Lead qualification / SQL gating** | Filtering on revenue before a call is the single biggest lever on sales-team efficiency. |
| Feedback loop | **Closed-loop attribution / offline conversion feedback** | Feeding real outcomes back to the ad platform + your research is how modern accounts actually improve. |

None of this is snake oil. It's the standard playbook — the novelty is the LLM doing
the synthesis. This maps almost 1:1 onto skills already in this repo:
`customer-research`, `marketing-psychology`, `ads`, `ad-creative`, `copywriting`,
`cro`, `prospecting`, `emails`, `revops`.

---

## 3. What's overstated or dated

**The core claim — "hyper-specific ICP targeting" via the ad platform — is the weakest
part, and in 2026 it's backwards.**

- As of **June 2026, Meta removed thousands of detailed-targeting options** and made
  **broad targeting / Advantage+ Audiences the default**. Meta's own guidance: *"creative
  is now the primary targeting signal"* — its Andromeda system processes 10,000+ signals
  per impression, so the ad (not the audience picker) finds the right person.
  ([Adligator](https://adligator.com/blog/meta-broad-targeting-advantage-plus-audiences-2026),
  [kecg.co](https://kecg.co/meta-ads-targeting/))
- So the "sniper" precision does **not** come from narrow audience settings. It comes
  from **message-market fit in the creative** — which is exactly what the ICP-intelligence
  layer produces. The pitch is *right about the method and wrong about the mechanism.*
  Reframe it as **"sniper creative on broad delivery,"** not "hyper-targeting."
- **LinkedIn** is the one platform where job-title/company/seniority targeting is still
  the lever for B2B — but it's expensive (see §4).
- **Signal-volume caveat:** B2B funnels generating only 20–30 leads/week often **can't
  feed Advantage+ enough conversion signal** to optimize reliably. Below that, a focused
  manual/detailed-targeting start (or LinkedIn) can beat broad AI delivery.
  ([Involve Digital](https://www.involvedigital.com/insights/meta-ads-b2b-lead-generation-strategy))
- **"Without spending hours on manual outreach"** — true that ads replace *outreach hours*,
  but they add *ad-spend risk + creative-iteration hours + a working offer*. It's a
  different cost structure, not a free lunch. Paid lead-gen needs a proven offer and a
  budget floor before it beats outreach; for a brand-new agency with no case studies,
  outreach is usually still cheaper to start.

---

## 4. Benchmarks (so expectations are grounded)

B2B cost-per-lead, 2025–2026 (blended ≈ **$198**; SaaS paid ≈ **$310**):

| Channel | ~CPL | Notes |
|---|---|---|
| **Meta** | **~$22 CPL** | High volume, cheapest raw leads — but leads are colder; qualification form is doing heavy lifting. |
| **Google Search** | **~$49 CPL** | Higher intent; ~3.75% conv. Good when the ICP is actively searching. |
| **LinkedIn** | **~$408 CPL** (up to $800+) | Best B2B targeting, premium price. Justified only at high deal values. |
| SaaS qualified lead | ~$150–$250 | |

**The number that matters most — Cost Per Qualified Lead (CPQL):**
if raw CPL is $100 and only 10–15% qualify, your true CPQL is **~$700–$1,000**.
The whole "qualification form" step exists to protect the *sales team's time*, not to
lower CPL — it deliberately throws away cheap-but-unfit leads. Model the economics on
CPQL and closed deal value, never on CPL.

Sources:
[Sopro](https://sopro.io/resources/blog/b2b-cost-per-lead-benchmarks/),
[Flyweel](https://www.flyweel.co/blog/lead-gen-cpl-cac-benchmark-index-2025),
[SalesHive](https://saleshive.com/blog/b2b-lead-benchmarks-digital-marketing-gen).

---

## 5. Where it breaks (risk register)

| Risk | Why | Mitigation |
|---|---|---|
| **No proven offer** | Ads amplify an offer; they don't create one. A weak offer just burns spend faster. | Validate the offer via outreach/organic *first*; only then pour ad spend on it. |
| **Garbage-in ICP layer** | LLM output is only as good as the call transcripts/VoC fed in. Thin input → generic ads. | Require real transcripts + win/loss notes before generating creative. This is the `customer-research` step. |
| **Signal starvation** | Low weekly lead volume can't train broad delivery. | Start LinkedIn or detailed-targeting; graduate to Advantage+ once volume supports it. |
| **CPQL blindness** | Optimizing to cheap CPL attracts unqualified leads that clog the calendar. | Optimize to booked-qualified-calls / pipeline, feed offline conversions back. |
| **Qualification too aggressive** | A revenue gate that's too tight starves the funnel. | A/B the form threshold; track drop-off per field (`cro`). |
| **Nurture gap** | "Book a call" with no warm-up → low show rates. | Confirmation + reminder + pre-call value sequence (`emails`). |
| **Compliance / claims** | Testimonial/earnings-style claims in B2B agency ads can trip platform review. | Keep claims specific, documented, and non-guaranteed. |
| **Attribution honesty** | Platform-reported leads are inflated. | Blended CAC + UTM + GA4 cross-check (`analytics`). |

---

## 6. How October could build this from assets we already own

This is not a greenfield build — most pieces exist in the repo:

| Funnel layer | Existing asset | Gap to close |
|---|---|---|
| ICP intelligence | `customer-research`, `marketing-psychology`, `product-marketing` skills → produce `.agents/product-marketing.md` | A repeatable **template pack** (the "feed Claude these" templates the pitch sells): awareness-stage worksheet, sophistication grader, VoC extractor, competitor teardown. |
| Prospect/ICP definition | `prospecting` skill (`b2b-prospecting`, `saas-prospecting`) | — |
| Ad creative | `ad-creative` + `ads` skills; `dev/meta-ads` (Meta integration); `dev/oc-ad-manager` | Wire creative gen → Meta ad manager. |
| Landing page + qual form | `dev/oc-forms`, `dev/landing-pages`, `cro` + `copywriting` skills | A reusable **qualify-then-book** LP template with revenue gating. |
| Email nurture + CRM | `dev/oc-mail`, `emails` skill; `dev/platform` (OMI) for CRM/contacts | Pre-call warm-up sequence + booking reminders. |
| Feedback loop | `dev/platform` (OMI) contacts intelligence + `revops` skill | Offline-conversion feedback wiring back to Meta/analytics. |

**If we productize it,** the natural home is either:
- a **template pack** under `docs/ai-sniper-ad-funnel/` + a thin skill that orchestrates
  the existing marketing skills in order, or
- a **funnel-in-a-box** feature inside OMI (`dev/platform`) that runs the sequence end
  to end.

> Note: per repo `CLAUDE.md`, code for any build goes in `dev/<app-name>/` and docs stay
> here in `docs/ai-sniper-ad-funnel/`. Don't brand any OMI-side feature "nvelope."

---

## 7. Bottom line

- **Architecture:** legitimate, proven direct-response funnel. Worth building.
- **The "AI" edge is real but narrow:** the win is LLM-compressed customer research +
  copy, *not* magic targeting.
- **Fix the framing:** it's **"sniper creative on broad delivery,"** not hyper-targeting —
  the 2026 platforms target *for* you off the creative signal.
- **Guard the economics on CPQL and pipeline,** not CPL.
- **Sequencing matters:** prove the offer → build the ICP intelligence layer → generate
  creative → qualify → nurture → close → feed data back. Ads are step 3, not step 1.

**Suggested next step:** decide whether we want (a) just this teardown, (b) the reusable
**template pack**, or (c) a full **OMI funnel-in-a-box** build. Each is a distinct scope.

---

*Sources are linked inline. Frameworks referenced: Eugene Schwartz, Breakthrough
Advertising (awareness stages, market sophistication).*
