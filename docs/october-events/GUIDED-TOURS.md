# Guided Tours — build and setup guide

How to stand up the gated guided-tour booking on the Architecture Tours site.
Written against October Events **1.115.0**, and checked line by line against the
shipped code, so every field, shortcode and setting named here is one the plugin
actually reads.

## The idea in one line

Guided tours are free, capacity-limited timed slots, open only to people who
already hold a paid tour ticket. They list publicly (so tickets keep selling),
but the reserve action is gated behind a ticket-email check.

## What you build vs what the plugin provides

- **You build** (your Elementor / JetEngine templates, from the existing Location
  CPT): the whole hub page, the intro, the "how it works" copy, and each
  building's presentation (image, name, architect, meeting point, badges). This
  is a JetEngine listing of guided-tour locations, styled in the brand.
- **The plugin provides** (two shortcodes): the eligibility gate and the slot
  booking. They own the ticket check, live counts, the capacity lock, the
  waitlist and the reservation. You style their output (`oe-gt-*` classes) with
  your own CSS. You never build the logic.

Roughly 80% of the page is yours, 20% is the two plugin widgets dropped in.

## Build the page — steps

1. **Create a page** called Guided Tours. Leave it out of the main navigation.
2. **Add the eligibility gate** at the top, once:
   `[guided_gate city="atlanta-ga" year="2026"]`
   `city` and `year` are your existing Tour City / Tour Year term slugs. This one
   shortcode defines which tour the whole page gates.
3. **Add a JetEngine Listing** of Location posts, filtered to your guided-tour
   buildings for the current Tour City + Tour Year. This is your building grid,
   designed however you like.
4. **In the listing item**, lay out the building from the CPT fields you already
   have: featured image, title, architect / designers, meeting point, Sat/Sun
   badge. All yours.
5. **Drop the slot widget into the listing item**, once:
   `[guided_slots]`
   With no attribute it uses the current building in the loop. It renders that
   building's active slots, live counts, and the Reserve / Join waitlist button.
6. **Add your "how it works" and reconfirm note** as normal content.
7. **Link to the page** from the Book Guided Tour buttons on the tour calendar
   and from the release email. Do not add it to the menu.

Add a building or a slot in the admin and it appears in the listing
automatically.

## The two shortcodes

- `[guided_gate city="…" year="…"]` — the tour it gates. A visitor enters the
  email they booked their ticket with; if it matches a **paid** order the page
  unlocks. The unlock is a signed cookie, scoped to this tour, valid **12 hours**,
  so a reload keeps them unlocked without re-entering the email. One hub page per
  tour: a Boston page is `city="boston" year="2026"`, and its unlock can't book
  Atlanta.
- `[guided_slots location="…"]` — the building whose slots to show. **Omit
  `location`** inside a listing loop and it uses the current post. Pass a numeric
  post ID (or a JetEngine current-object macro) only when using it standalone.
  The slot widget shows Reserve buttons only when the page's gate is unlocked.

## Admin setup

### Slots — the "Guided tour slots" metabox

Slots live in a metabox on your **Location** post type (the one set in
**Festival → Settings → Location post type**). Open a building and scroll to
**Guided tour slots**:

- **Add each slot**: Date, Start time (entered 24-hour, the browser's time
  control requires it; the public page always shows 12-hour AM/PM), Capacity,
  Active.
- **Generate a run**: fill From / To / Start / End / Every N minutes / Capacity to
  create a block at once (e.g. every 30 min, 10:00–16:00, across two days). It
  skips any slot already listed, so you can re-run it safely.
- **Booked column**: shows held / capacity per slot, plus a waiting count when a
  slot is full.
- **Download reservations CSV**: appears once a building has reservations.
  Columns: Name, Email, Status, When.

### Capacity

- **Default**: 30 per slot, set in Settings (`guided_default_capacity`).
- **Per building**: add a `slot_capacity` number field on the Location post to
  override the default for that building.
- **Per slot**: the Capacity box on each slot row wins over both.

### The ticket mapping (Settings)

`guided_ticket_map` links a tour (`city|year`) to the specific ticket event that
unlocks it. This is what makes "has a ticket" mean "bought *this tour's* ticket",
and keeps Boston separate from Atlanta.

- Running **one tour**? Leave the map **empty**. Then any paid order for the
  entered email unlocks booking. Simplest, and correct while there's a single
  tour.
- Running **several tours** at once? Map each `city|year` to its ticket event so
  an Atlanta ticket can't book a Boston slot.

### Reconfirm (automatic)

An hourly job emails holders about **48 hours** before their slot
(`guided_reconfirm_hours`) with confirm / release links. A released spot is
offered to the next person on the waitlist. Nothing to wire; it runs once the
plugin is active.

## How a booking flows

1. Visitor lands on the page with a ticket → enters their email in the gate →
   plugin finds a paid order → page unlocks (12-hour cookie).
2. They pick a time on a building → Reserve.
3. If the slot has room, they're **reserved**. If it's full, they **join the
   waitlist**. One reservation per building per email.
4. ~48 hours out, the reconfirm email asks them to confirm or release. Released
   spots promote the waitlist automatically.

## Settings reference

| Setting | Default | What it does |
|---|---|---|
| `guided_default_capacity` | 30 | Per-slot capacity when a building/slot sets none |
| `guided_reconfirm_hours` | 48 | Hours before a slot the confirm-or-release email sends |
| `guided_ticket_map` | empty | Maps `city\|year` → ticket event; empty = any paid ticket |
| `guided_close_hours` | 12 | Reserved for a future booking-close window — see below |

## Not wired yet — so you plan around it

Three things the earlier scope described are **not** in 1.115.0. Flagging them so
you don't build the page expecting them:

1. **Automatic booking close.** `guided_close_hours` exists as a setting but is
   not enforced yet — a slot stays bookable until it passes. To close a slot
   early, untick its **Active** box in the metabox.
2. **A per-slot "Booking opens [date]" state.** The slot widget has no built-in
   coming-soon countdown. To hold booking until release: keep the slots
   **Inactive**, or keep the page unlinked, until you want them live. There's no
   "remind me" capture on the widget.
3. **Slot end times / durations.** Slots show a **start time only**; there's no
   duration field driving an end time on the widget. Put the tour length in your
   own building copy if you want it shown.

Say the word if you want any of the three built — the close window is the small
one (a start-time check in the reserve endpoint plus a disabled state on passed
or closed pills).

## What shipped, and when

Everything above the "Not wired yet" line ships in October Events **1.112.0**
onward (current: 1.115.0): the two shortcodes, the eligibility gate, the booking
engine (capacity lock, waitlist, one-per-building), the slots metabox with
generator, the reservations CSV, and the 48-hour reconfirm email.
