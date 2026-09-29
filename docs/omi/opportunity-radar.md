# Opportunity Radar: a per-client early-warning pipeline in OMI

**Status:** proposal / build spec. Not built.
**Decision taken:** build it inside OMI as a configurable, multi-client feature.
Not as a WordPress plugin on any client's own site. LOLO is client one.

**The product in one line:** for a client who sells project work, find the
public signals that a buyer's project exists before the brief is written, score
them against that client's niche, and put a short weekly list of named
opportunities in front of the person who chases them.

---

## 1. Why it is a platform feature, not a one-off

The need is generic to any business selling project work to a buyer whose
project becomes public before the brief is written. That is most of October's
book:

| Client | Their signal | Shared with |
|---|---|---|
| **LOLO** (bespoke costume and uniform design) | Hotel, restaurant, spa and attraction openings; funded productions and tours; uniform tenders | Another Country |
| **Your Architect / Tiam** | Planning applications in target postcodes, pre-application enquiries, developer land acquisitions | Hillcroft |
| **Hillcroft Garden Designer** | Planning approvals for extensions and new builds in catchment, 3 to 9 months before landscaping spend | Your Architect |
| **Another Country** | Hotel, restaurant and office fit-outs entering specification | LOLO |
| **ADF / October Events** | New studios, practices and brands worth chasing as exhibitors and sponsors | All of them |

Roughly 70% of the build is machinery none of them see: the planning API
adapter, feed ingestion and re-discovery, cross-source clustering, scoring, the
digest, source health monitoring. Roughly 30% is the client's own profile.

**The design target:** client one costs 8 to 10 days. Client two costs half a
day of configuration and no new code. Section 4 is the contract that makes that
true, and section 5 is the honest list of what breaks it.

---

## 2. Triggers, not keywords

A sector list is a landing page taxonomy. As a search taxonomy it produces
overlapping noise: for LOLO, "Bespoke Café Uniforms", "Bespoke Restaurant
Uniforms" and "Bespoke Server Uniforms" are one buying event, a hospitality
venue opening. Search the event, tag the output with the sector.

The **trigger library** is org-level and shared. Each client subscribes to a
subset, weights them, and sets its own lead time.

| Key | Trigger | Who it serves |
|---|---|---|
| `planning_consent` | Planning application submitted or approved | Architects, garden design, fit-out, uniform, furniture |
| `venue_opening` | A new venue, site or property announced or entering pre-opening | LOLO, Another Country |
| `refurb_rebrand` | Refurbishment, repositioning, flag change, brand relaunch | LOLO, Another Country |
| `funding_confirmed` | A grant, raise or capital programme lands, so the project has money | LOLO (arts grants), any client with funded buyers |
| `production_announced` | A show, season, tour or programme announced | LOLO |
| `dated_event` | A recurring or one-off event with a fixed date and a delivery deadline | LOLO, ADF |
| `asset_delivery` | A vessel, aircraft, fleet or building handed over | LOLO (yacht, jet) |
| `people_change` | A new creative director, GM, brand owner or head of marketing arrives | All. A new decision maker is the most reliable agency buying trigger there is. |
| `tender_notice` | A published procurement notice or framework | All, with different CPV sets |

Each trigger carries a default prompt fragment and a default lead time. A client
profile overrides both.

---

## 3. The shared source library

Sources are **org-level rows**, subscribed to per client with per-client
filters. One client paying for a new feed improves the library for everyone.

| Source | Access | Triggers it feeds | Clients today |
|---|---|---|---|
| **PlanIt** (`planit.org.uk/api/applics/json`) | Free JSON, no key, roughly 420 UK councils | `planning_consent`, `venue_opening` | LOLO, Your Architect, Hillcroft, Another Country |
| **Arts Council England Project Grants** | Free, published monthly | `funding_confirmed`, `production_announced` | LOLO |
| Creative Scotland, Arts Council of Wales, Arts Council Ireland | Free published awards | `funding_confirmed` | LOLO |
| **Trade press pack: hospitality** (Big Hospitality, Propel, Hot Dinners, Boutique Hotelier, Hotel Designs) | RSS, `web_fetch` where RSS is gone | `venue_opening`, `refurb_rebrand`, `people_change` | LOLO, Another Country |
| **Trade press pack: attractions** (Blooloop, Park World, InPark, Attractions Management) | RSS | `venue_opening`, `production_announced` | LOLO |
| **Trade press pack: retail and beauty** (Retail Gazette, Drapers, Professional Beauty, Spa Business) | RSS | `venue_opening`, `refurb_rebrand` | LOLO |
| **Trade press pack: performance** (The Stage, WhatsOnStage, IQ, Music Week) | RSS | `production_announced` | LOLO |
| **Trade press pack: architecture and property** (Dezeen, AJ, Property Week, BD) | RSS | `planning_consent`, `people_change` | Your Architect, Another Country |
| **UK tender portals** (Find a Tender, Contracts Finder, PCS, Sell2Wales) | Live OCDS adapters already in `services/tender/sources/ukPortals.js` | `tender_notice` | All |
| **TED, CanadaBuys** | Live adapters | `tender_notice` | LOLO, October itself |
| **Anthropic `web_search`** | Existing `sources/webSearch.js`, weekly because it is the paid one | Any trigger, as gap cover | All |
| Asset press (SuperYacht Times, Boat International, Cruise Industry News, Corporate Jet Investor) | RSS | `asset_delivery` | LOLO |
| Paid: Sleeper, TOPHOTELPROJECTS, Production Weekly | Subscription | `venue_opening`, `production_announced` | Optional, judge on leads produced |

**Rule for adding a source.** RSS or JSON is configuration, done in the admin UI
in minutes. Anything needing HTML parsing is a half-day adapter on the existing
`fetch() → normalised items` contract. Anything behind a login is refused.

---

## 4. The adaptability contract: the client radar profile

This is the object that makes a new client configuration rather than code. One
row per client, edited in OMI by the account lead.

```jsonc
{
  "client_id": "cli_lolo",
  "what_we_sell": "Bespoke costume and uniform design and manufacture",
  "buyer_types": ["theme park operator", "hotel operator", "restaurant group",
                  "producer", "touring artist", "superyacht management"],
  "geography": { "primary": ["GB"], "secondary": ["AE", "US", "FR"] },
  "min_deal_value_gbp": 15000,

  "triggers": [
    { "key": "venue_opening",       "weight": 5, "lead_time_days": 210 },
    { "key": "refurb_rebrand",      "weight": 4, "lead_time_days": 120 },
    { "key": "production_announced","weight": 4, "lead_time_days": 90  },
    { "key": "funding_confirmed",   "weight": 3, "lead_time_days": 120 },
    { "key": "asset_delivery",      "weight": 3, "lead_time_days": 180 },
    { "key": "dated_event",         "weight": 3, "lead_time_days": 112 },
    { "key": "people_change",       "weight": 2, "lead_time_days": 60  },
    { "key": "tender_notice",       "weight": 1, "lead_time_days": 0   }
  ],

  "sources": {
    "planit":              { "enabled": true,
                             "use_classes": ["C1", "E(b)", "sui generis"],
                             "keywords": ["hotel", "restaurant", "spa", "visitor attraction"],
                             "scale": "major" },
    "trade_press_hospitality": { "enabled": true },
    "trade_press_attractions": { "enabled": true },
    "ace_grants":          { "enabled": true, "disciplines": ["theatre", "dance", "combined arts"],
                             "min_award_gbp": 30000 },
    "tenders_uk":          { "enabled": true,
                             "cpv": ["18000000", "18100000", "18110000", "18410000"],
                             "keywords": ["uniform", "costume", "wardrobe", "front of house"] }
  },

  "tags": ["Hotel Uniforms", "Chef Uniforms", "Ride Attendant Uniforms", "…"],

  "disqualifiers": [
    "operator buys wardrobe on a group-wide contract",
    "commodity PPE or workwear supply, not bespoke design",
    "budget below minimum"
  ],

  "profile_md": "Free text the account lead edits. Won and lost notes, house view on which operators are addressable, reusable boilerplate."
}
```

Three fields carry most of the adaptability:

- **`triggers`** decides which prompt fragments and which lead times apply.
- **`sources`** decides which shared adapters run for this client and with what
  filters. Nothing here is a code path.
- **`disqualifiers`** is what stops a generic radar producing generic rubbish.
  It goes into the scoring prompt verbatim.

### The same shape for three other clients

| Field | Your Architect | Hillcroft | Another Country |
|---|---|---|---|
| Top trigger | `planning_consent` w5, lead 30d | `planning_consent` w5, lead 150d | `venue_opening` w5, lead 240d |
| PlanIt filter | Householder + change of use, target postcodes | Approved householder and new build, catchment postcodes, detached and above | Use class C1 and E(g), major only |
| Second source | Trade press: architecture and property | None needed on day one | Trade press: hospitality |
| Tender CPV | 71200000 architectural services | None | 39100000 furniture |
| Key disqualifier | Applicant already names an architect | Application lists a landscape architect | Operator has a global FF&E contract |

Same table, same adapters, same scorer. Different rows.

---

## 5. What breaks the "half a day per client" promise

State this plainly so it is not discovered in month three.

- **A source with no feed and no API.** A half-day adapter, not configuration.
  Budget it per client rather than pretending the library covers everything.
- **A client whose buyers are invisible.** If a client's work is bought with no
  public precursor, this feature has nothing to sell them. Do not force it.
- **Feed decay.** Trade titles drop RSS, move behind paywalls and change markup.
  `services/rssDiscover.js` re-finds feeds; the radar needs a health check that
  reports a source returning zero items for 14 days. Without it a source dies
  quietly and nobody notices for a quarter.
- **Qualification, not discovery, is the hard part.** A hotel opening is not a
  uniform lead when the operator buys wardrobe on a group contract, and a
  planning approval is not an architecture lead when an architect is already
  named on it. The `disqualifiers` field exists for this and needs tuning
  against real rejections for the first two months.
- **A radar with no chase step is shelfware.** Output has to be signal, buyer
  organisation, named decision maker, contact-by date, drafted opening line,
  wired into `services/prospecting/`. Every client goes live with a named person
  who reviews it weekly, or the client does not go live.

### Honest yield note, carried over

Tenders are the weakest channel for LOLO specifically. Public uniform
procurement is dominated by commodity workwear routed through aggregator
frameworks. Expect a handful of genuinely relevant UK notices a year. Weight
`tender_notice` at 1 for them and let the openings feeds carry the value. Other
clients weight it differently, which is the point of the profile.

---

## 6. Architecture

Reuse, do not rebuild. The gap between the current tender agent and this is
smaller than it looks.

**Reused unchanged**

- `services/tender/http.js`: rate limiting, backoff, honest user agent, public records only
- `services/tender/ingest.js`: poll, normalise, dedupe on `(source_id, external_ref)`, content-hash amendment detection
- `services/tender/sources/*`: `ukPortals`, `ted`, `canadabuys`, `webSearch`
- `services/rssIngest.js`, `services/rssDiscover.js`: feed fetching and feed re-discovery
- `services/tender/digest.js` + `emailService.js`: the weekly email
- `services/scheduler.js`: node-cron, `TZ=Europe/London`
- `services/aiModels.js`: per-feature model routing, so scoring runs on a cheap model
- `services/prospecting/`: contact resolution for the chase step

**New**

| Table | Holds |
|---|---|
| `radar_triggers` | The org-level trigger library: key, label, default prompt fragment, default lead time |
| `radar_sources` | Org-level source rows: adapter, endpoint, config, enabled, last polled, last status |
| `radar_client_profiles` | One row per client: the JSON in section 4 plus `profile_md` |
| `radar_client_sources` | `(client_id, source_id, filters JSONB, enabled)`. The join that makes a shared source a per-client feed |
| `radar_signals` | One row per signal: trigger key, subject organisation, location, source URL, published date, **action_by date** (inferred from the trigger's lead time, not a closing date), tags, score, verdict, state (new / chasing / dismissed / won) |
| `radar_signal_sources` | The cluster: many source rows collapse to one signal |

**Changed**

- **Tenancy.** `tender_org_profile` is a single `id = 1` row and
  `routes/tender.js` has no `client_id`. October's own tender agent stays as it
  is; the radar is a sibling with proper per-client scoping. Do not retrofit the
  tender agent and break October's own bidding.
- **Scoring.** `services/tender/score.js` hardcodes October's PR niche in the
  system prompt. The radar scorer composes its prompt from
  `what_we_sell` + `buyer_types` + the subscribed triggers' fragments +
  `disqualifiers` + `profile_md`. One function, no per-client branches.
- **New adapters** on the existing contract: `sources/planit.js`,
  `sources/artsGrants.js`, `sources/tradePress.js` (RSS batch driven by a pack
  name), `sources/eventCalendar.js` (seeded dates).
- **Clustering.** The same hotel opening appears in four titles. Cluster on
  subject organisation plus trigger within a 90-day window and keep the best
  URL. Without this the digest reads as spam by week three.

---

## 7. Onboarding a new client (the half-day checklist)

1. Name the buyer types and what is sold.
2. Pick triggers from the library, set weights and lead times.
3. Subscribe to sources from the library and set the filters.
4. Write three disqualifiers. Ask the client what a bad lead looks like.
5. Backfill 90 days so the list is not empty on day one.
6. Review the first 30 scored signals with the client and tune the
   disqualifiers against their rejections.
7. Name the person who reviews it weekly and set the digest day.
8. Turn the digest on.

If a step needs code, it belongs in section 5's list of things that break the
promise. Record it there.

---

## 8. Phasing

| Phase | Scope | Estimate |
|---|---|---|
| **0** | Per client: confirm who reviews it weekly and what a bad lead looks like. No commitment to a weekly review means no build. | 1 call each |
| **1** | Trigger library, source library, client profile, `radar_signals`, PlanIt adapter, one trade press pack, tender adapters re-keyed per client. Weekly email digest. **LOLO live.** | 3 to 4 days |
| **2** | Remaining trade press packs, ACE grants adapter, cross-source clustering, OMI Radar page with dismiss and chase states, source health check. | 3 to 4 days |
| **3** | Contact resolution and a drafted opening line per signal, wired to outreach. Seeded event calendar. | 3 to 4 days |
| **4** | **Second and third clients** (Your Architect, Hillcroft) as configuration only. This phase is the test of whether section 4 worked. | 0.5 day each |
| **5** | Optional public-facing surface: a WordPress plugin on the `dev/october-mi-wp` pairing pattern rendering radar data as gated content, for example a "2027 openings pipeline" lead magnet on a client's own site. Display only, engine stays in OMI. | 2 days |
| **Ongoing** | Source health, prompt tuning against what clients chase. | 2 hours a month |

Phase 1 ships something LOLO read on a Monday morning. Stop after phase 1 if the
open rate says they are not reading it. Phase 4 is where the platform decision
pays for itself, so do not skip it for a fourth feature in phase 3.

## 9. Running cost

| Item | Estimate |
|---|---|
| Scoring on a cheap model, roughly 200 to 400 items a day per client at ~150 output tokens | Single-digit GBP a month per client |
| Anthropic `web_search`, weekly targeted passes | Low single-digit GBP a month |
| PlanIt, arts grant data, RSS | Free |
| One paid trade subscription | Three figures a year, optional, judge on leads produced |
| Infrastructure | None. It runs on the existing OMI box. |

Order of magnitude. The real cost is build time.

## 10. Commercial model

Once phase 4 proves configuration-only onboarding, this is a retainer line, not
a favour:

- Set-up fee covering profile, trigger tuning, source selection and the first
  30-signal review.
- Monthly fee for the digest, the Radar page and prompt tuning.
- The value story is a single won project. One bespoke uniform programme, one
  extension, one garden pays for years of the retainer, so the pitch is a
  probability argument rather than a feature list.

Price it against what clients do today, which is reading trade press by hand and
hearing about projects once the brief is already written.
