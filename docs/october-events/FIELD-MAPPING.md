# Field mapping and migration: JetEngine CPTs → event model

Status: scoping (migration source). Owner: Daniel. Plugin: `dev/october-events`.
Companion to [`EVENT-MODEL.md`](EVENT-MODEL.md). Source field definitions captured
from the live sites are in [`reference/`](reference/):
`adf-cpt-definitions.json` / `adf-cpt-report.md` (atlantadesignfestival.net) and
`atus-cpt-definitions.json` / `atus-cpt-report.md` (architecturetours.us).

## Key finding: ADF already is the capability-pack model

ADF's `events` CPT is a single event type with on/off **switchers** that reveal
field groups, exactly the packs in `EVENT-MODEL.md`:

| Switcher (meta key) | Reveals | → Pack |
|---|---|---|
| `tickets-section-onoff` | ticket price fields | Tickets (display) |
| `conference-page-switcher` | about, speakers, past-speakers, sessions, accommodation | Conference |
| `exhibition-page-switcher` | `exhibitor` repeater | Exhibition |
| `tours-page-switcher` (archived) | city, tour locations link/PDF | Tour |

So the native model formalizes what already exists. Note ADF's "Tickets" fields are
**display prices only** (text); the plugin's real Tickets capability (orders, QR,
checkout) is a separate engine the migration does not replace.

## Pack field sets (confirmed from source)

Base and per-pack targets. Full field lists and types are in the `reference/`
JSON; meta keys below are the migration anchors.

- **Base event:** `event-details` (desc), `date-time` + `start-date`/`start-time`/
  `end-date`/`end-time`, `event-price` + `price-sale`, `event-location`, `gallery`,
  `external-url`/`external_event_link`, `registration-link` (+ button text),
  `youtube`, `company` + `company-logo-switcher` + `company-logo-1..3`,
  `virtual-event`, `parking`.
- **Tickets (display):** `tickets-section-onoff`; single/group/student tiers with
  early-bird/sale/description (`single-ticket*`, `group_ticket*`, `student-ticket*`).
- **Conference:** `conference-page-switcher`; `about-the-event`, `about-image`;
  `speakers` repeater (photo/name/title/linkedin/instagram/website); `past-speakers`
  repeater (photo/name/title); schedule — `sessions-section-onoff`,
  `session-descriptions`, per-day `schedule-day-N-date`/`-theme` + `sessions-day-N`
  repeater; accommodation — `accomodation_section_onoff`, image/logo/name/
  description/link.
- **Exhibition:** `exhibition-page-switcher`; `exhibitor` repeater (photo/name/
  description/linkedin/instagram/website).
- **Tour event (ATUS `events`-keyed):** `city`, `tour-locations-google-map`,
  `tour_locations_google_map_embed`, `download-tour-locations-pdf`, `accommodation`
  (+ photo), plus the `GuidedTours` slot engine.
- **Tour Locations (ATUS `portfolio`-keyed, theme-registered):** the per-location
  sub-items the slot engine books against. Fields: credits block (`architect`,
  `interior_designer`, `landscape_architect`, `developer`, `construction`,
  `photographer`), `address`, `parking`, `google_maps`, `gallery`, `city`, `date`
  (stored as **text** → migrate to a real date), `sat_only`/`sun_only` (two
  switchers → one availability field), `alert` (textarea), `guided_tour` switcher
  + `guided-tour-external-link`. **Plugin owning this type removes its current
  theme dependency** (it orphans on a theme change today). DB prefix here is
  `wp_rjrh_`.
- **Directory (ATUS, already `oe_directory`):** `_description`, `quote`, `website`,
  `address`, `email-address`, `instagram`/`facebook`/`pinterest`/`houzz`, `gallery`.

## Volunteers and staff (decided)

- **Volunteering is an event capability (Volunteers pack):** a "needs volunteers"
  switch on the event → shifts → the existing `oe_volunteer_signups` table.
  **Retire the standalone `volunteer` CPT**; the opportunity becomes an event with
  the pack on (tickets may be off). Festival-wide roles are the same, just not
  ticketed.
- **Shift vs non-shift roles:** ADF `volunteer-type` splits into shift-based
  (Docent, Meet & Greet) → Volunteers pack, and non-shift (Social Media, Event
  Coordinator) → a **role page + apply-by-email form** (the lightweight entry to
  `CREW-MODULE.md`; full lifecycle later).
- **Commit before publish:** a volunteers-enabled event accepts signups via a
  private link while unpublished, plus a general availability/interest form (the
  volunteer pool) captured before events are finalized, then allocated.

## Data cleanup on migrate (do not copy the faults across)

- **ATUS city** has leading spaces on six values (" Austin TX" …) — trim; likely
  the silent city-filter bug.
- **ADF conditional logic broken:** `virtual-event` (Yes/No) can never equal
  "In-Person Event", so Location/Parking never show; tickets + schedule fields are
  wired to `conference-page-switcher` not their own on/off. Native packs fix this.
- **Volunteer `date`** hardcoded to 2025 → real date field.
- **Schedule Day 1 vs Day 2** structured differently (gallery vs five media
  fields) → normalize in the sessions pack.
- **Naming** mixes hyphens/underscores (`basic_listing` vs `key-details`,
  `accommodation-tab` vs `accomodation_section_onoff` misspelled) → map to
  consistent `_oe_*` keys; keep the old key as the read fallback in adoption mode.
- **CPT keyed `events` on both sites** → the plugin owning the CPT per tenant
  removes the cross-site collision.
- **Directory `_description`** is protected meta (leading underscore) → map
  explicitly; it holds the listing body.

## Outstanding input

- **The Tours ↔ Tour Locations relation** — how a location attaches to a tour is
  **not** in the CPT captures (it is a JetEngine Relation or a meta field, not a
  post-type definition). Without it the two sets are unconnected, so every tour
  page hardcodes its locations. This is the one piece still needed to migrate the
  multi-location structure (capture the JetEngine Relations, or describe how a
  location is linked to its tour today).
- Taxonomy terms (e.g. city / year) for the native filters are not captured; grab
  them when building the filter layer. Listings/meta boxes are intentionally not
  needed (replaced natively).
