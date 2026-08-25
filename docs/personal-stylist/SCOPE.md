# Personal Stylist — Full Technical Scope

**Companion to:** [`BRIEF.md`](./BRIEF.md) (concept & feature rationale)
**Status:** Scope / pre-build
**Target host:** 20i shared hosting (free tier) — PHP 8 + MySQL
**Code:** `dev/personal-stylist/` · **Docs:** `docs/personal-stylist/`

This document turns the concept into a buildable spec: architecture, stack,
database schema, the styling engine, screens, API surface, integrations,
security/privacy, and a phased plan. Where a choice is the owner's to make it's
flagged **[CONFIRM]**; everything else is a recommended default.

---

## 1. Design principles

- **Single user.** No multi-tenancy, no social features, no scale pressure. This
  simplifies everything — but the app holds sensitive data (body photos,
  calendar, home locations, API keys), so **privacy and secret-handling are the
  hard requirements**, not scale.
- **Server holds all secrets.** Claude/vision key, Google OAuth secret, weather
  calls that need keys — all server-side. The browser never sees a secret.
- **Keep it boring and buildless where possible.** Shared hosting rewards a
  simple deploy (git pull or file upload), minimal dependencies, and no heavy
  build step. Favour vanilla PHP + PDO and a light frontend over a framework
  that fights the host.
- **The intelligence is a rubric, not vibes.** Styling quality comes from an
  explicit reasoning framework (occasion → weather → silhouette → colour →
  personal taste) applied over the real wardrobe, not generic colour rules.
- **The purpose: dress good to feel good — keep the owner choosing.** The app
  exists to arrest *drift* into slob, not just to answer "what do I wear." The
  slob slide is never a decision; it's the absence of one. So the app takes a
  gentle side: put-together is the default (see the effort baseline), Comfy is a
  choice you make, not gravity. Its **voice is on your side** — encouraging,
  never nagging or shaming — but it *notices*: a run of low-effort days earns a
  light nudge ("fancy dialling it up tomorrow?"), and effort should feel like it
  builds (light momentum), because the whole point is felt, not just functional.

## 2. Architecture & stack

```
┌─────────────────────────────────────────────────────────┐
│  Browser (PWA — installable to phone home screen)        │
│  HTML + Tailwind + Alpine.js · camera capture · offline  │
│  shell. Talks to the backend over a JSON API.            │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTPS (same origin)
┌───────────────────────────▼─────────────────────────────┐
│  PHP 8 backend on 20i                                    │
│  • Thin router → JSON API endpoints                      │
│  • PDO → MySQL (catalogue, profiles, state)              │
│  • Image store on disk OUTSIDE web root, served via an    │
│    authenticated proxy script (private, non-guessable)   │
│  • Server-side calls out to Claude / Google / weather    │
│  • PHP session auth (single user), CSRF, bcrypt          │
│  • CLI scripts run by cron (briefing, reminders)         │
└───────┬───────────────┬───────────────┬─────────────────┘
        │               │               │
   Claude API      Google Calendar   Open-Meteo
   (vision +       (OAuth 2.0,       (free, no key —
   reasoning)      read-only)        forecast + geocode)
```

**Stack decisions**

| Layer | Choice | Why |
|---|---|---|
| Runtime | **PHP 8.x** | 20i shared hosting is PHP-first; zero extra cost |
| DB | **MySQL / MariaDB** via PDO | Bundled with 20i; prepared statements |
| Router | Vanilla PHP thin router (optional Slim if Composer available) | Minimal deps on shared hosting |
| Frontend | **PWA**: HTML + Tailwind + Alpine.js, **small committed build step** | Photo-heavy + mobile-first; installable. Precompiled Tailwind + bundled JS committed to the repo for lean, fast pages; deploy is still a git pull |
| Images | Files outside web root + GD/Imagick thumbnails | Private storage; auth proxy for body photos |
| Auth | PHP sessions + bcrypt + "remember me" | Single user; simple and safe |
| Jobs | 20i **cron** → PHP CLI scripts | Monthly briefing, nightly maintenance, wash reminders |
| LLM/vision | **Anthropic Claude API** | Vision tags garments; text does the styling reasoning |
| Calendar | **Google Calendar API** (OAuth 2.0, read-only) | Owner's single mixed calendar |
| Weather | **Open-Meteo** | Free, no API key, forecast + geocoding — ideal for a free build |

**Pre-build checks on the 20i plan** (control panel): PHP 8.x available;
outbound HTTPS/`curl` not blocked (needed to reach APIs); cron available;
enough disk for a few hundred photos + thumbnails (hundreds of MB — fine).

## 3. Data model

Full schema (MySQL). Timestamps `created_at`/`updated_at` on every table.

```
users                    -- single row; owner login
  id, email, password_hash, remember_token

settings                 -- app-wide prefs
  id, key, value                       -- home locations, units, briefing day, budget

locations                -- the two homes (+ "packed"/in-transit as a state)
  id, name, lat, lon                   -- London, Margate

items                    -- one garment
  id, name, type, subtype
  colours (json), pattern, fabric, warmth, formality, seasons (json)
  care (json)                          -- wash temp, dry-clean, delicate
  location_id                          -- where it physically is
  wash_state                           -- clean | worn_ok | basket | washing
  committed_to_outfit_id               -- nullable; reserved for a planned outfit
  wear_count, last_worn_at, last_worn_location_id
  status                               -- active | stored | archived
  notes

item_photos
  id, item_id, path, is_primary, width, height

outfits                  -- a saved or planned combination
  id, name, planned_date, occasion, location_id
  weather_context (json), rationale, rating, source   -- ai | manual

outfit_items             -- many-to-many
  outfit_id, item_id, role                -- top | bottom | outer | shoes | accessory

wear_log                 -- history feeds the variety engine
  id, item_id, worn_on, location_id, weather (json), outfit_id

trips                    -- a planned time away
  id, destination_location_id, start_date, end_date, notes

trip_events              -- what's happening on the trip (from calendar or manual)
  id, trip_id, date, title, formality, source

packing_lists
  id, trip_id, generated_at, items (json), rationale

body_profile             -- PRIVATE (see §7)
  id, height_cm, weight_kg, measurements (json), photo_paths (json), notes

style_profile            -- learned taste
  id, archetypes (json), preferences (json), likes (json), dislikes (json),
  rating_signal (json)                    -- aggregated from outfit ratings

shopping_suggestions
  id, generated_at, description, fills_gap (json), pairs_with (json), status

calendar_tokens          -- Google OAuth (server-side only, encrypted at rest)
  id, access_token, refresh_token, expires_at, scope

calendar_events_cache    -- pulled from Google, refreshed periodically
  id, external_id, date, title, inferred_formality, location_text, raw (json)

weather_cache
  id, location_id, date, forecast (json), fetched_at
```

## 4. The availability model (core logic)

An item is **wearable on a given date at a given location** iff all three hold:

1. **Location** — item's `location_id` == where the user will be that day
   (accounting for planned trips moving items).
2. **Wash state** — `clean` or `worn_ok`; `basket`/`washing` are excluded *unless*
   there's time to launder before the date (then it's surfaced with a
   "run a load by X" flag rather than hidden).
3. **Not committed** — `committed_to_outfit_id` is null, or committed to *this*
   outfit.

This single predicate drives daily suggestions, packing, and laundry flags.
Implemented as one query + a small rules layer, reused everywhere.

## 5. The styling engine

**Inputs assembled server-side:**
- Candidate items (already filtered by the §4 availability predicate).
- Event context (occasion + inferred formality) for the date.
- Weather for the date/location (from Open-Meteo).
- Body profile (proportions) and style profile (taste, likes/dislikes).
- Recent `wear_log` + recent outfit combos (to drive **variety**).

**Call:** Claude API with a **styling-rubric system prompt** (the §2/BRIEF
framework as explicit rules) and **structured output** (tool use → JSON), so the
result is machine-usable, not prose to parse.

**Output shape (per recommendation):**
```json
{
  "items": [ { "item_id": 12, "role": "top" }, ... ],
  "rationale": "charcoal merino + oxford — client meeting, 9°C and drizzle",
  "weather_fit": "warm mid-layer, no rain risk to the fabric",
  "variety_note": "you've not worn the merino in 3 weeks"
}
```

**Variety enforcement:** pass wear counts + recent combinations; the rubric
rewards under-worn pieces and penalises repeats. Belt-and-braces: reject a
generated outfit that exactly matches one worn in the last N days and re-ask.

**Vision tagging** uses the same API: garment photo in → attributes JSON out
(type, colours, pattern, fabric, warmth, formality, seasons, care), user confirms.

### The effort dial — not every day is equal

A per-day **effort level (1–5): Comfy → Casual → Smart → Sharp → Full.** Most
days are low (WFH gym-shorts) and shouldn't burn a hero outfit or clean laundry.
Two controls, resolving the tension between "don't waste an outfit" and "I want
to dress better for me":
- **Daily dial** — **auto-set** from the day's calendar occasion + weather (WFH →
  low, client pitch → high), **user-overridable** for days the calendar can't
  know ("feel like making an effort today").
- **Baseline floor** (a `settings` value) — **defaults to *Smart*, not Casual.**
  A normal day is "put-together" by default; *Comfy* is a deliberate dial-*down*,
  never the gravity you drift into. You have to actively choose slob — it is
  never the resting state.

It feeds the styling engine as an input: the level sets the formality
floor/ceiling and how far to reach into "hero" pieces. **Low genuinely means low**
— at *Comfy* it recommends the comfortable option and *conserves* good pieces +
clean laundry for the days (and trips) that matter, tying straight into the
availability and pack-light systems.

Data model additions: `settings.effort_baseline`; each day/`Event` carries a
derived `effort_default` and an optional user `effort_override`; a saved
`Outfit` records the `effort_level` it was built for.

## 6. Screens & flows

1. **Wardrobe** — grid; filter by location / type / availability; wear-count badges.
2. **Add item** — camera or upload → auto-tag → confirm/correct → save.
3. **Item detail** — edit tags; set location; set wash state; wear log.
4. **Today** — the day's suggested outfit + one-line why; swap/accept; "wore this".
5. **Monthly briefing** *(hero)* — the month's trips, pre-positioning advice, and
   varied outfit directions for notable days.
6. **Trip planner** — pick destination + dates → pulls events → **packing list**
   ("bring these 9; Margate already has the rest").
7. **Shopping brief** — gap-analysis that names **specific products with buy
   links** (budget- and taste-bounded), not just a described gap.
8. **Body & style profile** *(private)* — measurements, optional photo, taste.
9. **Settings** — connect Google Calendar, home locations, units, briefing day.

## 7. Security & privacy (non-negotiable)

Run the repo's **`october-security`** skill before "real" use. Requirements:
- **Secrets** in config outside web root / server env; never committed. `.env`
  and the image store git-ignored.
- **Body photos & measurements** are the most protected data: stored outside web
  root, served only through an authenticated proxy (no public/guessable URLs),
  **one-tap delete**, never sent to any third party — **except** the optional
  virtual try-on feature (§12), which is explicit opt-in and, by choice, may use
  an avatar stand-in instead of a real photo. (Vision tagging runs on *garment*
  photos, not body photos.)
- **Auth:** bcrypt, PHP session hardening, CSRF tokens on all mutating requests,
  rate-limit + lockout on login.
- **Transport:** HTTPS enforced; secure/HttpOnly/SameSite cookies.
- **Google tokens:** stored server-side, encrypted at rest, read-only scope,
  revocable from Settings.
- **DB:** PDO prepared statements throughout (no string-built SQL).

## 8. External integration notes

- **Google Calendar:** OAuth 2.0 web flow, `calendar.readonly` scope, offline
  access for a refresh token; nightly sync into `calendar_events_cache`; map
  event keywords → inferred formality (tunable rules + LLM assist).
- **Weather (Open-Meteo):** geocode the two homes once (store lat/lon); fetch
  daily forecast per location/date; cache in `weather_cache` to limit calls.
- **Claude API:** one server-side wrapper for both vision tagging and styling
  reasoning; centralise the key, retries, and structured-output handling.

## 9. Phased build plan

| Phase | Deliverable | Host needed? |
|---|---|---|
| **0** ✅ | **Static monthly-briefing prototype** (seeded 2-location wardrobe) — validate that the styling *reads as smart* before building anything. **Delivered:** `dev/personal-stylist/index.html`, Clueless-themed mobile mockup (today's outfit + reasoning, week strip, pack-light Margate trip, laundry flag) | No — local/artifact |
| 1 | Skeleton on 20i: auth, DB schema, wardrobe CRUD, photo upload, manual tagging | Yes |
| 2 | Vision auto-tagging (Claude) | Yes |
| 3 | Availability model (location × wash × committed) + wardrobe filters | Yes |
| 4 | Styling engine + **Today** view + save/rate outfits | Yes |
| 5 | Google Calendar + Open-Meteo integration | Yes |
| 6 | **Monthly briefing** generation via cron + variety engine | Yes |
| 7 | Trip planner + **pack-light optimiser** | Yes |
| 8 | Shopping brief (gap analysis) | Yes |
| 9 | Body & style profile + silhouette reasoning | Yes |
| 10 | Security hardening pass (`october-security`), PWA polish, house design system | Yes |

Phase 0 is the cheapest way to de-risk the whole idea — no backend, no cost,
and it answers the one question that matters: *does the advice feel like a
stylist or like a colour-matcher?* The **Clueless theme (§11)** applies from
Phase 1 onward; **virtual try-on (§12)** slots in after Phase 9 as optional.

## 10. Decisions (resolved)

1. **Taste-learning → Both.** A short onboarding quiz *seeds* the style profile;
   thumbs up/down on outfits *refines* it over time. Needs both the quiz flow
   (Phase 9) and the `ratings → style_profile.rating_signal` loop (Phase 4).
2. **Briefing delivery → In-app only.** The monthly cron generates the briefing;
   the user opens the app to read it. No email/push plumbing in scope for v1.
3. **Shopping brief → Suggest specific products with buy links.** Beyond
   describing the gap, name concrete items to buy. Adds a **product-search step**
   (see below) to Phase 8 — the LLM proposes what fills the gap, then a product
   lookup resolves real products + links, budget- and taste-bounded.
4. **Frontend → Small committed build step.** Precompiled Tailwind + bundled JS
   committed to the repo; deploy stays a git pull. (Not buildless.)

**Follow-on from decision 3 — product search.** Naming real products needs a
source of truth for products/links. Options to settle at Phase 8: a shopping/
product-search API, affiliate feeds, or a curated retailer set. **[CONFIRM at
Phase 8]** which source — it's the only new external dependency these decisions
introduce, and it doesn't block Phases 0–7.

## 11. Visual design — **chosen: classy fashion-app** (whisper of Clueless)

**Decision: ship the classy direction.** `dev/personal-stylist/index.html` is the
classy prototype. It's a premium fashion-app aesthetic:
- **Type:** Bodoni Moda (Didone masthead/headlines) + DM Sans (UI/body).
- **Palette:** warm chalk `#EFEBE3` / surface `#F8F5EF`, ink `#211E1B`, taupe
  secondary `#7B7469`, aubergine accent `#5B3A55`, muted gold `#B8934A`.
- **Layout:** airy, hairline dividers, refined figure, ink-fill / outline buttons.
- **The Clueless soul, kept to a whisper:** a single plaid hairline under the
  wordmark, and the **Auto Dress / Dress Me** verbs. No leopard, no CRT font,
  no chrome.

The full-kitsch Clueless variant was explored and set aside (see §13 — moot for a
private app; chosen on personal taste). Original film reference stills remain in
`docs/personal-stylist/` for the plaid/verb nods.

### (Archived) The full-Clueless theme

The app's inspiration is Cher Horowitz's wardrobe computer in *Clueless* (1995),
and the homage is deliberate because the film's UI **maps onto the real feature
set**:

| Clueless element | This app |
|---|---|
| **"Auto Dress"** button | AI assembles a full outfit for you |
| **"Dress Me"** button | Dress me *for this* — occasion + weather driven |
| Rotating paper-doll figure in the outfit | The outfit preview (and try-on, §12) |
| Category tabs (Shoes, Jewelry, Scarves, Pants, Sweaters…) | Wardrobe filters by type |
| Leopard-print trim, chrome buttons, yellow-plaid energy | Theme skin |

**Direction: Clueless-*inspired*, not a pixel-copy.** Keep the joy — leopard
trim, chunky chrome buttons, the paper-doll avatar, the palette — on a modern,
touch-first, responsive layout underneath. A literal 90s CRT UI is charming
briefly and painful to use on a phone; capture the spirit, keep the usability.
As a **personal** app it is *not* bound by the repo's house design system and
carries its own identity. Reference stills live in `docs/personal-stylist/`.

## 12. Virtual try-on (fal.ai) — optional, paid, privacy-gated

**Feasible and strong.** fal.ai hosts production try-on models: person image +
garment image → a composited image of the user wearing the item.
- **Model:** FASHN v1.6 (~$0.075/generation) renders patterns/plaid accurately
  from flat-lay garment photos — exactly the photos the app already stores.
  Alternatives: FLUX 2 try-on, Kling. Python/JS SDKs; one server-side call.
- **💷 Cost:** the **only** paid piece in an otherwise-free stack. Small but
  per-image — **cap it**: render only outfits the user is actively considering,
  not every suggestion. Server-side key, usage budget.
- **🔒 Privacy → resolved: opt-in real photo.** Owner is comfortable sending a
  real photo to fal.ai for the render. Still gated behind an explicit opt-in
  toggle, and we verify fal/FASHN data-retention terms before shipping. The
  avatar stand-in stays available as a later option but is not the default.
- **Placement:** a later, optional phase (after core styling works). Not on the
  critical path; the app is fully useful without it.

## 13. Competitive landscape — clueless.clothing

A shipping paid competitor, **clueless.clothing** (iOS + Android, £/$9.99·mo /
~$70·yr, no free tier), already covers much of the core loop:
- AI stylist persona ("Katire") that **plans 7 days** from closet + forecast +
  **calendar**; weather-aware; thumbs up/down taste learning; swap/regenerate.
- **Wardrobe intelligence** (gaps, underused pieces); **travel** = pick what
  you're packing, it mixes-and-matches a capsule.

**What this validates:** the concept and the exact taste-learning loop we chose
(quiz-seed was ours; ratings-refine matches them). A named stylist voice works.

**Our uncovered wedge (they do *not* do these):**
- **Two physical homes** — items *live* in London/Margate; "already in Margate";
  pack only the gap. Their travel assumes one closet.
- **Laundry / availability** state + plan-ahead ("run a load by Wednesday").
- **Wear-vs-pack conflict** across the horizon.
- **See-it-on-me try-on** (fal.ai, §12).
- **Shopping brief → specific buyable products** (they surface gaps only).

**Identity implication — moot for this project.** The owner has confirmed this
is a **private, personal app, not for public launch.** So the "avoid looking
derivative of clueless.clothing" and name-collision concerns do **not** apply:
the design choice is purely personal taste, and the name **"AS IF"** stays.
Both prototype variants (kitsch Clueless vs. classy fashion-app) are valid —
pick whichever the owner most enjoys using daily; the winner becomes
`dev/personal-stylist/index.html`. The competitor remains useful only as an
idea source (named stylist voice, thumbs up/down learning). The differentiating
features (two homes, laundry, pack-light, try-on) are built because they're
personally useful, not for competitive edge.
