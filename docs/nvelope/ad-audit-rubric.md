# Ad Audit Rubric

The scoring rubric behind the Strategist's ad-health score. Methodology adapted
from [AgriciDaniel/claude-ads](https://github.com/AgriciDaniel/claude-ads)
(**MIT License**) and scoped to the campaign-performance aggregates the
platform already pulls (Meta Ads + Google Ads).

- Machine-readable rubric: `dev/platform/backend/src/data/adAuditRubric.json`
- Scorer: `dev/platform/backend/src/services/adAudit.js` (`scoreSnapshot()`)
- Consumed by: `dev/platform/backend/src/services/strategistReport.js` (wiring
  lands in claude-ads slice 2)

## What we took, and what we didn't

claude-ads runs 250+ checks across many platforms, including creative,
account-structure, and tracking-config audits. Most of those require data we
don't yet ingest (ad-level creative, conversion-action config, account
settings). We took the **transferable part**: the idea of weighted categories
scored to 0–100, and defensible benchmarks — applied to the per-campaign Meta +
Google numbers the Strategist snapshot already contains. As the platform
ingests more (e.g. creative-level data, GTM/CAPI config), categories can be
added without changing the scoring machinery.

## How scoring works

1. The Strategist's snapshot (per-campaign Meta + Google rows + totals) is
   flattened to a common shape.
2. Each **check** evaluates the data and returns a status:
   `strong` / `healthy` / `mixed` / `weak` / `broken`, or `na` (not enough data
   — excluded from scoring).
3. A **category** score is the mean of its applicable checks' scores.
4. The **overall** 0–100 score is the category scores weighted by the category
   weights below (categories with no applicable checks drop out of the
   denominator, so a thin account isn't unfairly penalised).
5. Confidence is `low` when spend is below the judgement threshold or the window
   is under a week.

Status → score: strong 1.0, healthy 0.85, mixed 0.55, weak 0.30, broken 0.0
(individual checks may override for nuance). Overall status bands: ≥80 strong,
≥60 healthy, ≥40 mixed, ≥20 weak, else broken.

## Categories, weights, and checks

| Category | Weight | Checks |
|---|---:|---|
| **Efficiency & ROI** | 30 | Blended ROAS vs benchmark; spend on zero-conversion campaigns (drain) |
| **Conversion & tracking signal** | 20 | Any conversions recorded (catches broken tracking); Meta add-to-cart → purchase rate |
| **Engagement & creative health** | 20 | Spend-weighted CTR vs benchmark; Meta frequency / creative fatigue |
| **Budget allocation** | 15 | Spend concentration in a single campaign (risk if it isn't performing) |
| **Scale & data sufficiency** | 15 | Enough spend to judge the account |

Every finding cites the number it fired on (e.g. *"Blended ROAS 2.30x (£4,600
value on £2,000 spend)"*), so the Strategist's scorecard is evidence-backed
rather than free-form.

## Benchmarks (editable defaults)

Conservative UK retail/ecommerce defaults, stored in `adAuditRubric.json` so
they can be tuned (and later made per-client) without touching code:

| Benchmark | Value |
|---|---|
| ROAS — good / weak / break-even | 4.0x / 2.0x / 1.0x |
| CTR — good / weak | 1.0% / 0.4% |
| Meta frequency — weak / broken | 3.0 / 5.0 |
| Add-to-cart → purchase — good / weak | 25% / 10% |
| Min spend to judge the account | £100 |
| Min campaign spend to count as a drain | £50 |
| Single-campaign spend concentration flag | 60% |

## Why deterministic

The scorer makes **no Claude call** — it's a pure function of the snapshot, so
the same data always yields the same score. In the Strategist, this rubric
supplies the *score and the scorecard skeleton*; Claude still writes the
narrative and recommendations around it. Paired with the marketingskills
playbooks (Integration 3), the rubric gives the *score* and the playbook gives
the *methodology* behind the advice.
