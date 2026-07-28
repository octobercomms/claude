# OMI — AI Sniper Funnel (client acquisition funnel, orchestrated)

Scope/decision record for incorporating the **"AI Sniper ad funnel"** into OMI as a
per-client capability: an ICP-intelligence → resonant-creative → qualify-then-book →
nurture → closed-loop feedback funnel that **chains modules OMI already runs**, rather
than a new product. Companion to the teardown in
[`docs/ai-sniper-ad-funnel/README.md`](../ai-sniper-ad-funnel/README.md) — read that
first for what's real vs overstated in the underlying method.

Status: **scope — awaiting sign-off before build.**

---

## The idea in OMI terms

For a client whose goal is *acquiring their own B2B/agency customers*, OMI runs one
guided funnel:

```
ICP Intelligence Pack ──► Sniper creative ──► Broad paid delivery
      ▲                                              │
      │                                              ▼
 Closed-loop feedback ◄─ booked calls ◄─ qualify-then-book LP + form
      ▲                                              │
      └───────────── nurture (email/CRM) ◄───────────┘
```

The pitch's real edge isn't targeting — it's **LLM-compressed customer research feeding
creative that does the targeting for you** (Meta removed most detailed targeting in June
2026; creative is now the delivery signal — see the teardown §3). OMI is unusually
well-placed to productise this because it already owns almost every stage; the missing
piece is the **orchestration and the intelligence layer that seeds it all**.

---

## What already exists vs what's new

| Funnel stage | Today in OMI | This build |
|---|---|---|
| Client brief / kickstart | `clientKickstart.js` (data-first, AI fills empty fields), `strategyTemplates.js` (SOSTAC playbooks), `brandVoice.js` | **New:** an **ICP Intelligence Pack** built on the same pattern — ingests call transcripts + service info, outputs awareness-stage map, market-sophistication level, VoC pains/desires, competitor angle. |
| Ad creative | `adCreative.js`, `adCreatives.js` route, `ClientAdsPage`, `swipeFile.js`, `competitorAds.js`, `adAudit.js` | Seed creative generation **from the Intelligence Pack** (angle + awareness stage → hook). Mostly wiring. |
| Audience / delivery | `audienceInsights.js`, `audiences.js`, `ClientAudiencesPage` | Add the "broad delivery, creative is the signal" guidance + a LinkedIn/detailed fallback note for low-volume clients. Copy/guardrail, not new infra. |
| Landing page + qualify | `octoberForms.js` route (oc-forms), `landing-pages`, `cro` skill | **Reuse:** a qualify-then-book form template with a **revenue gate** + booking hand-off. Config, not new module. |
| Nurture / CRM | `emailService.js`, `outreachSender.js`, `campaignReadiness.js`, contacts library, `sesWebhook`/`bounceHandler`/`unsubscribe` | Reuse the outreach sequence engine for a pre-call warm-up + booking reminders; gate launch with `campaignReadiness`. |
| Qualification / scoring | `leadScoring.js`, `leadEnrichment.js`, `leads.js`, `LeadsPage` | Score inbound form leads against the ICP Pack; route only qualified to "book a call." |
| Feedback loop | `salesTraffic.js`, `ClientSalesTrafficPage`, `usageTracking.js`, `costLog.js` | **New:** a **closed-loop feedback** step — booked/qualified/closed outcomes flow back to (a) the ad platform as offline conversions and (b) the Intelligence Pack to sharpen the next round. |

**Net new work is two modules — the ICP Intelligence Pack and Closed-loop feedback.**
Everything between them is orchestration over modules that already ship.

---

## The two new pieces

### 1. ICP Intelligence Pack (`icpIntelligence.js`)

The real IP, and the thing the pitch actually sells ("feed Claude these templates").
Follows the `clientKickstart` + `strategyTemplates` pattern: data-first, AI fills gaps,
snapshotted per client so edits never wipe progress.

- **Inputs:** call transcripts / win-loss notes, service description, existing brief,
  competitor domains (already on the client record).
- **Outputs (one JSON snapshot per client):**
  - `awareness_map` — which of Schwartz's 5 stages the cold audience sits in → dictates
    ad directness.
  - `sophistication_level` — 1–5 → dictates whether to lead with claim, bigger claim,
    mechanism, new mechanism, or identity.
  - `voc` — pains, desired situation, worldview in the prospect's own words (extracted,
    not invented — degrade to "insufficient input" rather than hallucinate).
  - `competitor_angle` — the gap to position into.
- **Surface:** a new panel on the client dashboard (Setup → Overview, beside
  `ClientStrategyPanel`), with a **Tailor with Claude** action mirroring the strategy
  template flow. Empty-only fill; never overwrites the AM.
- **Guardrail:** if transcripts are thin, the Pack must say so — the whole funnel is
  garbage-in-garbage-out on this step (teardown §5).

### 2. Closed-loop feedback (`funnelFeedback.js`)

- Captures outcome per lead: form-qualified → booked → showed → closed.
- Pushes offline conversions back to Meta/Google so broad delivery optimises to
  *qualified* events, not cheap clicks — the fix for the CPQL trap (teardown §4).
- Feeds aggregate outcomes back into the ICP Pack ("which angle produced closed deals")
  so round N+1 is sharper. This is the "system gets stronger over time" claim, made real.

---

## Model sketch (new migration)

- **`client_icp_intelligence`** — per client: `{ awareness_map, sophistication_level,
  voc:{pains,desires,worldview}, competitor_angle, sources:[...], generated_at }`.
  Snapshot semantics like `client_strategy`.
- **`funnel_runs`** — one funnel instance per client: links the ICP snapshot → creative
  set → form → sequence, plus stage counters for the feedback loop.
- **`funnel_lead_outcomes`** — per inbound lead: `{ qualified, booked, showed, closed,
  value, angle_id }` — the offline-conversion + learning source.

## API sketch

`/api/funnel` (authed, per-client access-controlled), mirroring `/api/strategy`:
- `GET|PUT /clients/:id/icp` · `POST /clients/:id/icp/tailor`
- `POST /clients/:id/funnel` (assemble a run from ICP → creative → form → sequence)
- `GET /clients/:id/funnel/:runId/readiness` (reuse the `campaignReadiness` blocker/
  warning/stats shape before go-live)
- `POST /clients/:id/funnel/:runId/outcomes` (feedback ingest)

## UI sketch

A **Funnel** view on the client dashboard that stitches the existing tabs into one
ordered flow with a readiness gate at launch: `ICP → Creative → Audience → Page & Form
→ Nurture → Live → Results`. Each step deep-links to the module that already renders it
(`ClientAdsPage`, `ClientAudiencesPage`, oc-forms, outreach, `ClientSalesTrafficPage`)
so we're adding a **spine**, not duplicating panels.

---

## Build sequence (phased, each shippable)

1. **ICP Intelligence Pack** — the seed everything else consumes. Ships standalone value
   (better briefs) even before the funnel spine exists.
2. **Creative seeding** — wire the Pack into `adCreative` so hooks derive from
   awareness/sophistication.
3. **Funnel spine + readiness gate** — the ordered view over existing modules + oc-forms
   qualify-then-book template.
4. **Nurture wiring** — outreach sequence for warm-up + reminders.
5. **Closed-loop feedback** — offline conversions + learning back into the Pack.

Start at 1; ship 1–3 as an MVP funnel; 4–5 turn it into the self-improving system.

---

## Risks specific to the OMI build

- **Don't rebuild what exists.** The temptation is a big new "funnel engine"; the right
  move is a thin orchestrator + two modules. If a step wants new infra, check whether a
  service above already does it.
- **Signal starvation** (teardown §5): low-volume clients can't feed broad delivery —
  the funnel view should surface the LinkedIn/detailed fallback for them.
- **Per-client access control** must wrap every `/api/funnel` route, same as
  `/api/strategy`.
- **Naming:** this is an OMI feature — do **not** brand it "nvelope" (per repo
  `CLAUDE.md`); nvelope is the separate lead-gen platform.

---

## Decision needed

Sign-off to build **Phase 1 (ICP Intelligence Pack)** as the first increment, or to
scope the full 1–5 sequence. Phase 1 is low-risk, reuses the `clientKickstart` pattern,
and delivers value on its own.
