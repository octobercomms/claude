# Opportunity Radar: early-warning pipeline for client sectors (LOLO first)

**Status:** proposal / build spec. Not built.
**Origin:** LOLO (lolo.design, bespoke costume and uniform design, London) asked on
a call how they find out about projects they should be pitching for. They work
across 38 declared sectors, from theme park ride attendant uniforms to private
jet crew wardrobe.

The obvious answer was "OMI already does tender search and RSS mining, point it
at LOLO". This document argues for a narrower and more useful build than that,
and against putting the engine in a WordPress plugin on the client's own site.

---

## 1. Verdict in three lines

1. **Build the engine inside OMI**, per client, reusing the tender agent
   pipeline (`ingest → normalise → classify → score → digest`) and the RSS
   pipeline. Do not rebuild it in PHP.
2. **Search buying triggers, not the 38 sector names.** The sector list is a
   marketing taxonomy for landing pages. As a search taxonomy it produces noise.
   Six triggers cover all 38.
3. **Tenders are the low-yield channel for LOLO.** Most public uniform notices
   are commodity workwear. The high-yield channel is pre-opening, refurbishment,
   rebrand and funded-production signals, which arrive 6 to 24 months before the
   wardrobe budget is spent.

---

## 2. Why not a WordPress plugin as the engine

A plugin on lolo.design that polls sources and runs classification fails on five
counts:

| Problem | Detail |
|---|---|
| Scheduling | WP-Cron fires on page traffic, not on a clock. A low-traffic studio site polls unpredictably. Real cron on the server is a hosting-support conversation with their host, every time it breaks. |
| Cost and keys | Classification needs an LLM key. Either LOLO hold an Anthropic account and the bill, or October's key sits in a client's `wp_options` table. Neither is clean. |
| Blocking | Trade press and portals block server-side fetches from shared hosting far more often than from a known VPS with a descriptive user agent and rate limiting (`services/tender/http.js` already handles this). |
| Support surface | A scraper inside a client's website becomes October's problem the first time a plugin update or a PHP bump breaks it. |
| Asset ownership | The engine is the asset. Shipping it as a plugin on the client's server hands the asset over and turns a retainer into a one-off build fee. |

**What a plugin does well:** read-only display. `dev/october-mi-wp` already has
the pairing, HMAC signing and settings pattern for a WordPress site talking to
`platform.octobercomms.com`. A thin plugin that pulls a scored opportunity list
into wp-admin is a two-day job on top of the real build.

**Order of delivery, by value per hour of build time:**

1. **Weekly email digest** to LOLO. Day-one value, no UI, reuses
   `services/tender/digest.js` and `emailService.js`.
2. **OMI client login** to a Radar page. They see the full list, dismiss, and
   flag what they chased.
3. **WordPress plugin**, only if LOLO live in wp-admin and will not log into a
   second system. Ask them before building it.

---

## 3. The 38 sectors are the wrong search unit

Running 38 keyword sets across 30 sources produces overlapping, mostly worthless
hits. "Bespoke Café Uniforms" and "Bespoke Restaurant Uniforms" and "Bespoke
Server Uniforms" are the same buying event: a hospitality venue opens or
refurbishes. Collapse to the event.

### The six triggers

| # | Trigger | Buying event | Typical lead time to wardrobe spend | Sectors it covers |
|---|---|---|---|---|
| **T1** | **New venue opening** | Hotel, restaurant, café, spa, salon, retail, attraction, waterpark pre-opening | 6 to 9 months before opening; the announcement lands 12 to 24 months out | Hotel, Café, Restaurant, Server, Retail, Spa, Salon, Beauty, Massage, Therapist, Chef, Waterpark, Park F&B, Park Retail, Ride Attendant, Queue Host, Show Ops, VIP Tour Guide |
| **T2** | **Refurbishment or rebrand** | Repositioning, flag change, brand relaunch, new creative director | 3 to 6 months | Same as T1, plus Brand Ambassador, Photo Team, Meet & Greet |
| **T3** | **Funded production or season** | A show, tour, season or company programme with confirmed money | 2 to 6 months | Dance Company, Circus & Acrobat, Concert, Tour Wardrobe, Immersive Event, Stage Crew, Parade, Festival Performer, TV & Broadcast, Music Video |
| **T4** | **Dated event with a wardrobe need** | Awards ceremony, parade, festival, brand activation, corporate event | 2 to 4 months, on a fixed annual calendar | Awards Ceremony, Red Carpet Crew, Corporate Event, Presenter & Host, Parade, Festival |
| **T5** | **Asset delivery or fit-out** | Superyacht launch, private jet completion, cruise newbuild, new private residence staff | 3 to 9 months before delivery | Private Yacht, Private Jet, Private Home Staff |
| **T6** | **Formal tender** | A published procurement notice for uniform or costume supply | Deadline-driven, 3 to 8 weeks | Public bodies: councils, museums, transport, NHS, leisure trusts, national institutions |

Each trigger carries its own prompt, its own sources and its own scoring rules.
The 38 sector names stay as **tags on the output**, so LOLO see "this is a hotel
uniform lead", and so the lead links to the matching service page on their site.

---

## 4. Trigger to source map

### T1 / T2. openings, refurbishments, rebrands

| Source | Access | Note |
|---|---|---|
| UK planning applications via **PlanIt** (`planit.org.uk/api/applics/json`) | Free JSON API, no key, roughly 420 councils | The earliest signal there is. Filter on use-class change to hotel/restaurant/leisure and on description keywords. 12 to 24 months ahead of opening. |
| Hospitality trade press: Big Hospitality, Propel, Hot Dinners, Eater London, Boutique Hotelier, Hotel Designs | RSS where it exists, `web_fetch` where it does not | Confirms the planning signal and names the operator. |
| Attractions trade press: Blooloop, Park World, InPark, Attractions Management | RSS | T1 for the theme park sectors, which is LOLO's strongest ground. |
| Retail and beauty: Retail Gazette, Drapers, Professional Beauty, Spa Business | RSS / fetch | Store and salon opening announcements. |
| Sleeper, TOPHOTELPROJECTS | Paid | Do not pretend free feeds cover the hotel pipeline. Price a single subscription in year one and judge it on leads produced. |

### T3. funded productions

| Source | Access | Note |
|---|---|---|
| **Arts Council England Project Grants data** | Free spreadsheet, published monthly | The single best T3 source. A named organisation with confirmed money and a stated project. Filter on discipline (theatre, dance, combined arts) and award size. |
| Creative Scotland, Arts Council of Wales, Arts Council Ireland | Free published award data | Same logic, smaller volume. |
| The Stage, WhatsOnStage, IQ Magazine, Music Week, Pollstar | RSS | Season, tour and production announcements. |
| Broadcast commissions, KFTV, Production Weekly | Mixed, Production Weekly is paid | TV and broadcast costume work. |

### T4. dated events

Mostly a **seeded calendar**, not a feed. Roughly 60 to 100 recurring UK and
international events with fixed months (awards season, carnival season, major
festivals). The radar surfaces each one on a rule: "contact 16 weeks before the
date". Feeds add the new and one-off events on top.

### T5. asset delivery

SuperYacht Times, Boat International new-build listings, Cruise Industry News
newbuild pipeline, Corporate Jet Investor. Low volume, high value per lead.

### T6. tenders

Reuse the live adapters in `dev/platform/backend/src/services/tender/sources/`
(`ukPortals.js`, `ted.js`, `canadabuys.js`, `webSearch.js`) with a LOLO keyword
and CPV set instead of October's PR set:

- CPV `18100000` occupational clothing, special workwear and accessories
- CPV `18110000` occupational clothing
- CPV `18410000` special clothing
- CPV `18000000` clothing, footwear, luggage articles and accessories
- Keyword layer for the bespoke end: costume, wardrobe, uniform design, theatrical
  costume, character costume, front-of-house uniform, crew wardrobe

---

## 5. Honest yield, and where this does not work

**T6 is the weakest channel.** Public uniform procurement is dominated by
commodity supply: hi-vis, scrubs, school uniform, PPE frameworks, usually routed
through aggregator frameworks such as YPO. Bespoke design notices are rare. Set
the expectation at a handful of genuinely relevant UK notices a year, and treat
anything more as upside. Building the radar around tenders alone would be a
waste of money.

**T1 has a qualification problem.** A hotel opening is not a uniform lead if the
operator buys wardrobe through a group contract. Independents, first properties,
brand launches and repositionings are the addressable ones. The scoring prompt
has to ask "who chooses the wardrobe here" and mark group-contract
operators down.

**Feeds decay.** Trade titles drop RSS, move behind paywalls and change markup.
`services/rssDiscover.js` already re-finds feeds; the radar needs a health check
that reports a source returning zero items for 14 days, or it silently goes dead
and nobody notices for a quarter.

**The radar is worthless without a chase step.** A list nobody works is
shelfware. The output has to be: signal, named buyer organisation, named
decision maker, suggested contact date, drafted opening line. OMI already has
contact resolution and outreach in `services/prospecting/` and the press
outreach module. Wire the radar into that, and hold LOLO to a 20-minute weekly
review. If they will not commit to the review, do not build this.

---

## 6. Architecture

Reuse, do not rebuild. The gap between the current tender agent and this is
smaller than it looks.

**What already exists and is reused unchanged**

- `services/tender/http.js`: rate limiting, backoff, honest user agent
- `services/tender/ingest.js`: poll, normalise, dedupe on `(source_id, external_ref)`, content-hash amendment detection
- `services/tender/normalise.js`, `classify.js`, `score.js`: the go/no-go qualifier shape
- `services/tender/digest.js` + `emailService.js`: the weekly email
- `services/rssIngest.js`, `rssDiscover.js`: feed fetching and feed re-discovery
- `services/scheduler.js`: node-cron, `TZ=Europe/London`
- `services/aiModels.js`: per-feature model routing, so classification runs on a cheap model

**What has to change**

| Change | Why |
|---|---|
| **Tenancy.** The tender agent is org-level: `tender_org_profile` is a single row with `id = 1`, and `routes/tender.js` has no `client_id`. | The radar is per client. Add `radar_profiles` keyed on `client_id`, holding the trigger set, sector tags, geography and an editable markdown profile in the same shape as `tender/profile.js`. |
| **Trigger-aware scoring.** `score.js` hardcodes October's PR niche in the system prompt. | Make the niche a parameter read from the client's radar profile, with one prompt variant per trigger. |
| **Signal table.** `tender_notices` assumes a notice with a closing date. | A new `radar_signals` table: trigger type, subject organisation, location, source URL, published date, an inferred **action-by date** rather than a closing date, sector tags, score, verdict, state (new / chasing / dismissed / won). |
| **Non-tender adapters.** | `sources/planit.js`, `sources/artsGrants.js`, `sources/tradePress.js` (RSS batch), `sources/eventCalendar.js` (seeded). Same `fetch() → normalised items` contract as the existing adapters, so `config.resolveAdapter` extends without surgery. |
| **Dedupe across sources.** The same hotel opening appears in four titles. | Cluster on subject organisation plus trigger within a 90-day window, and keep the best URL. Without this the digest reads as spam by week three. |

---

## 7. Phasing

| Phase | Scope | Estimate |
|---|---|---|
| **0** | Confirm with LOLO: who reviews it, how often, and which three sectors they most want to win. Build only if they commit to a weekly review. | 1 call |
| **1** | Per-client tenancy, `radar_signals`, radar profile, T1 (PlanIt + 6 hospitality and attractions feeds) and T6 (existing tender adapters re-keyed to uniform CPVs). Weekly email digest. | 3 to 4 days |
| **2** | T3 (ACE grants + trade press) and T2, trigger-aware scoring, cross-source clustering, OMI Radar page with dismiss and chase states. | 3 to 4 days |
| **3** | T4 seeded calendar and T5. Contact resolution and a drafted opening line per signal, wired to the existing outreach module. | 3 to 4 days |
| **4** | Optional read-only WordPress plugin for lolo.design wp-admin, on the `dev/october-mi-wp` pairing pattern. Build only on request. | 2 days |
| **Ongoing** | Source health monitoring, prompt tuning against what LOLO chase. | 2 hours a month |

Phase 1 ships something LOLO read on a Monday morning. Stop after phase 1 if the
open rate says they are not reading it.

## 8. Running cost

| Item | Estimate |
|---|---|
| Classification, cheap model, roughly 200 to 400 items a day at ~150 output tokens | Single-digit GBP a month |
| Anthropic `web_search`, weekly targeted passes (the existing tender agent already runs this weekly for cost reasons) | Low single-digit GBP a month |
| Feeds, PlanIt API, ACE grant data | Free |
| One paid trade subscription (Sleeper or TOPHOTELPROJECTS class) | Three figures a year, optional, judge on leads |
| Infrastructure | None. It runs on the existing OMI box. |

Treat these as order-of-magnitude. The real cost is build time, not runtime.

## 9. Commercial model

The engine is client-agnostic. Once the tenancy change lands, pointing it at an
architecture practice, a furniture brand or a hospitality design studio is a
profile edit and a source list, not a build. That makes it a productised
retainer line rather than a favour to one client:

- Set-up fee for profile, trigger tuning and source selection.
- Monthly fee for the digest, the OMI Radar page and prompt tuning.
- The value story is a single won project. One bespoke uniform programme for a
  hotel opening pays for several years of the retainer, so the pitch is a
  probability argument, not a features list.

Price it against the alternative LOLO have today, which is reading trade press
by hand and hearing about projects when the brief is already written.
