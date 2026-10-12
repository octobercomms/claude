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
  `photographer`, **`realtor`** — new), `address`, `parking`, `google_maps`,
  `gallery`, `city`, `date` (stored as **text** → real date), `sat_only`/`sun_only`
  (two switchers → one availability field), `alert` (textarea), `guided_tour`
  switcher + `guided-tour-external-link`. **Plugin owning this type removes its
  current theme dependency** (it orphans on a theme change today). DB prefix here
  is `wp_rjrh_`. Taxonomies on it: `tour-cities`, `tour-years` (these carry the
  tour relation, see below) and **Portfolios Categories** (Residential /
  Commercial / Hospitality / Public Space / Workplace — a building-type filter). A
  **Volunteers** box already exists on the location editor ("needs volunteers",
  slots, This-site / Partner-site host toggle), confirming volunteers-as-capability
  + cross-site partner hosting.
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

## The Tours ↔ Tour Locations relation (resolved)

There is **no stored relation** (no JetEngine relation, meta box, reference field,
or shared taxonomy; see `reference/atus-tours-locations-relation-addendum.md`).
The link is made **at render time** in the Elementor templates by querying
`portfolio` filtered on the location's **`tour-cities`** and **`tour-years`**
taxonomy terms. A tour's own city lives in a meta select (the leading-space one);
tours carry no taxonomy.

**Migration consequence (good):** this matches the plugin's existing
`tour_key = city|year`. The native model represents a tour as a (city, year) and
gathers its locations by those two taxonomy terms, so the association **migrates
without hand reconstruction** — the location terms already encode it. The native
link is then a real, queryable relation instead of a template-only one. Also
capture the `tour-cities` / `tour-years` / Portfolios-Categories terms for the
filter layer.

## Structured fields: stop storing HTML in content

Today maintainers paste raw HTML into plain fields: an `<a style=…>` into a credit
(Interior Designer), and a styled `<span style="background-color:…">` into Date to
flag "RESCHEDULED" / "day only". That is fragile (breaks on redesign),
inconsistent, and an injection surface. The model stores **data, not
presentation**, and the plugin renders it:

- **Link-aware credits** — each credit (architect, interior designer, realtor, …)
  is a `{name, url}` pair. The template renders the styled link. No pasted `<a>`.
- **Date / availability / status** — replace the HTML-in-Date pattern with: real
  **date/time** fields; an **availability** choice (Saturday / Sunday / Both /
  Specific date, retiring the ambiguous `sat_only`/`sun_only` pair) that renders
  its own badge automatically; and an optional **status badge** `{text, preset}`
  for exceptions only (Rescheduled, Cancelled, Sold Out, New, …). The **preset
  carries a brand-approved background and an auto-readable text color** — a dropdown,
  not a raw color picker, so badges stay consistent and accessible. A custom
  background is an escape hatch only, and even then the text color is chosen
  automatically for contrast. Routine "day only" comes from availability, not a
  hand-set status.
- **Product principle:** no October Events field should require pasting HTML;
  presentation lives in the template so a redesign changes it everywhere at once.
