# Guided Tours — setup and build guide

How the gated guided-tour booking works on the Architecture Tours site, what
October builds in its own templates, and what the plugin provides.

Companion to the mockup produced in scoping (the "Guided Tours" hub with the
Public / Ticket holder toggle and the build-zone overlay).

## The idea in one line

Guided tours are free, capacity-limited timed slots, open only to people who
already hold a tour ticket. They list publicly (to sell tickets), but the
reserve action is gated. Booking opens close to the event, for fairness and
commitment.

## The split: you build vs the plugin provides

- **You build (your Elementor / JetEngine templates, from the existing Location
  CPT):** the whole hub page, the intro, the "how it works" section, and each
  building's presentation (image, name, architect, meeting point, badges). This
  is a JetEngine listing of guided-tour locations, styled in the brand.
- **The plugin provides (two shortcodes):** the eligibility gate and the slot
  booking. These own the ticket check, live counts, the capacity lock, the
  waitlist and the reservation. You style their output with your own CSS; you
  never build the logic.

Roughly 80% of the page is yours, 20% is the two plugin widgets dropped in.

## What you build — simple steps

1. **Create a page** called Guided Tours. Leave it out of the main navigation.
2. **Add the eligibility gate** at the top with one shortcode:
   `[guided_gate city="atlanta-ga" year="2026"]`
   (the city and year are your existing Tour City / Tour Year term slugs.)
3. **Add a JetEngine Listing** of Location posts, filtered to
   `guided_tour = true` and the current Tour City + Tour Year. This is your
   building grid, designed however you like.
4. **In the listing item**, lay out the building from your CPT fields you already
   have: featured image, title, architect / designers, meeting point, the
   Sat/Sun badge.
5. **Drop the slot widget into the listing item**, once:
   `[guided_slots]`
   With no attribute it uses the current building in the loop. It renders that
   building's time slots, live counts, and the Reserve / Join waitlist buttons.
6. **Add your "how it works" and the reconfirm note** as normal content.
7. **Link to the page** from the Book Guided Tour buttons on the tour calendar
   and from the release email. Do not add it to the menu.

That is the whole page. Add a building or a slot in the admin and it appears in
the listing automatically.

## The two shortcodes and where their values come from

- `[guided_gate city="…" year="…"]` — the tour it gates. Taken from your Tour
  City and Tour Year term slugs. One hub page per tour, so you set this once when
  you build the page. A Boston page is `city="boston" year="2026"`. The gate uses
  it to look up the tour's ticket product (the mapping below) and to scope the
  unlock.
- `[guided_slots location="…"]` — the building whose slots to show. Optional.
  Omitted inside a listing loop, it uses the current post (`get_the_ID()`). Pass
  a numeric post ID (or a JetEngine current-object macro) only when using it
  standalone.

The gate, on a matched email, sets a short-lived signed unlock for that tour. The
slot widgets show Reserve buttons only when their tour is unlocked; they know
their tour from the building's own Tour City + Year, so the two coordinate
without manual wiring.

## Data you set up

### On the Location CPT (fields you add — you already have the rest)

- `slot_duration_mins` (number) — tour length, e.g. 30 or 45.
- `meeting_point` (text, optional) — where the guided tour meets, if different
  from the address.
- `slot_capacity` (number, optional) — per-building override of the default 30.
- `booking_opens` (datetime, optional) — only if you stagger open dates per
  building; otherwise set once per tour below.

Already present and reused: `guided_tour` toggle, `sat_only` / `sun_only`, Tour
City, Tour Year, architect and the other designer fields, gallery, featured
image, address, parking, alert.

### Per tour (a small Guided Tours settings screen)

- Default slot capacity (e.g. 30).
- Booking opens date/time (the release moment).
- Booking closes: N hours before each slot (e.g. 24).
- Reconfirm window: N hours before (e.g. 48).
- **Ticket mapping:** Tour City + Year -> which ticket product unlocks. This is
  what makes "having a ticket" mean "bought this tour's ticket", and is how a
  Boston tour stays separate from Atlanta.

### Slots (child records, not fields on the building)

Each time slot is its own bookable record: `slot_date`, `slot_start` (end derives
from the duration), `slot_capacity` (inherits the default), `slot_active` on/off,
and a relation to its building. For dense cases ("every 30 minutes, 10-4, over
two days") generate them rather than typing each one.

## Release and reconfirm flow

- Slots list early with a "Booking opens [date]" state (driven by `booking_opens`
  / the ticket engine's `sale_from`). Add a Remind me capture during that window.
- On the release date, booking opens and ticket holders get their unlock link.
- 48 hours before each slot, the plugin emails holders to confirm or release.
  Unconfirmed places are auto-released to the waitlist.

## Still to build in the plugin (next code task)

The two shortcodes above (`[guided_gate]`, `[guided_slots]`), the tour-settings
screen with the ticket mapping, the slot generator, and the reconfirm email do
not exist yet. They reuse the ticketing engine's existing capacity lock, waitlist
and attendee export. This guide is the spec for that build; the page above can be
laid out in advance and wired up once the shortcodes ship.
