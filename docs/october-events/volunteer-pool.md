# Volunteer pool, early recruitment & location-based allocation

Status: design spec (not yet built). Owner: Daniel. Drafted with Claude.

## The problem

Volunteers need recruiting early in the year, long before the specific homes
on a tour (or the events) are confirmed. People care most about **location** —
they want a home close to them. Today each volunteer opportunity is its own
page, which makes it hard for a volunteer to see everything and pick what's
near them, and impossible to recruit before the homes exist.

## The model (agreed)

Separate **recruitment** (early, home-agnostic) from **allocation** (later,
once homes/events are confirmed). Let volunteers **self-select** their specific
home/event rather than auto-assigning them; auto-matching is a proposal and a
fallback, not the primary mechanism.

### 1. Recruitment windows = date × time × role

Each year, define a set of **windows** up front (the dates and shift blocks are
known even before the homes). A window is:

- date (e.g. Sat 4 Oct 2026)
- time block (e.g. 10:00–13:00)
- **role** (e.g. Docent, Greeter, Setup) — separate targets, separate counts

So "Sat AM · Docent" and "Sat AM · Greeter" are distinct recruitment targets.

### 2. Early pool registration (home-agnostic)

A public registration, open months ahead, capturing:

- name, email, phone
- **home zipcode** (the matching input)
- **window×role checkboxes** — tick every window+role they can/will do;
  **minimum one required** (multi-select)
- optional: willing-to-travel distance, notes

This is a lightweight "I want to volunteer this year" list, stored separately
from shift signups. No home is chosen yet.

### 3. Targets + 25% contingency → recruitment board

Daniel knows the rough need per window×role. Set a **target headcount** per
window×role = need + 25% contingency. The admin board then shows live progress:

| Window         | Role    | Target (incl. 25%) | Signed up | Status      |
|----------------|---------|--------------------|-----------|-------------|
| Sat 4 AM       | Docent  | 20                 | 18        | nearly there|
| Sat 4 PM       | Docent  | 20                 | 11        | push here   |
| Sun 5 AM       | Greeter | 16                 | 16        | full        |
| Sun 5 PM       | Docent  | 16                 | 7         | short       |

This tells Daniel exactly where to keep recruiting, months out, and when to
stop. The contingency absorbs no-shows and drop-outs.

### 4. Confirm homes/events → invite the pool to self-pick

When homes (tour locations) and events are confirmed, each becomes an
opportunity with real shifts placed on the same windows. Then invite the pool:
"homes are live, choose yours."

- A single **consolidated "choose your slot" page** (not one page per home).
- Grouped by window (their constraint); homes/events listed under each,
  **sorted nearest-first by the volunteer's zipcode**.
- Each row shows role, slots left, and a "needs help" flag.
- Accordion grouping, but: **live counts on every header** and
  **default-open the windows still short of people**, so urgency isn't hidden.
- When identified (token link or entered zip), pre-filter to their ticked
  window×role and sort by their zip.
- Picking a slot **confirms** they want that specific home/event.
- Keep individual home/event pages for marketing and deep-linking; they are no
  longer the signup mechanism.

### 5. Cover pool for the surplus

Recruiting to need + 25% means surplus if everyone shows. Surplus (and anyone
who hasn't self-picked) becomes confirmed **cover**, with the message:
"You're confirmed as cover. We'll assign your specific home in the few days
before, as final numbers settle." Cover is a real status, not limbo. In the
final days, as cancellations land, cover volunteers are placed into the gaps
(nearest-first).

### 6. Auto-match proposal (fallback / bulk)

A button that, for everyone still unassigned, **proposes** the nearest
home/event with room that fits a window×role they ticked. Daniel reviews the
proposal on a board, tweaks it, then confirms, and it notifies them. Never an
instant irreversible assign.

### 7. Switch requests

A "request a different home" link showing nearby homes/events with room on a
window×role they ticked; Daniel approves (or it's instant when capacity
allows). Reuses the volunteer move flow already in the plugin (1.197.0).

## Location matching

- Distance = **straight-line between zip centroids** (haversine). Bundle a US
  ZIP → lat/long table (~41k rows, a small static file). No live API, works
  offline, instant for bulk.
- Geocode each home's zip/address once; use the existing Google Maps key only
  for homes with no clean zip.
- **Do not** use driving-distance APIs for this. For "which home is closest,"
  straight-line ranking is indistinguishable from driving distance at this
  scale and avoids per-lookup cost and rate limits.

## Why self-select + proposal, not instant auto-assign

- **Greedy stranding:** assigning everyone to their nearest home leaves the
  last-processed people with only far-away slots. A reviewable proposal handles
  the awkward tail.
- **Zip is one input, not the whole story:** availability (window), role and
  capacity all constrain it.
- **Data quality:** mistyped zips, homes without a clean address — eyes on the
  edge cases before emails go out.

## Reuses existing plugin pieces

- Volunteer opportunities already link to **events** or **tour locations**, so
  allocation targets can be both (not just homes).
- `VolunteerSignups` table, per-shift capacity, reminders, the daily roster.
- Tokenised no-login links (the cancel-shift pattern) for the pick page and
  switch requests.
- `Volunteers::move()` for switches; the SMS connector for alerts.
- The "add a volunteer to a shift" + "known volunteers" picker (1.199.0).

## Proposed build order

1. **Distance-sorted slot picker** — volunteer enters zip (or arrives via
   token), homes/events sort by proximity, filter by window×role and
   "needs help." Solves most of the location problem on its own and stands
   alone. (Small.)
2. **Pool registration** — contact + zip + window×role checkboxes, with the
   per-window×role target/contingency board. The early-recruitment engine.
   (Medium.)
3. **Invite-to-pick + cover pool status** — when homes/events go live, invite
   the pool to self-pick; surplus/unpicked become cover. (Medium.)
4. **Auto-match proposal** board + confirm, and **switch requests**. (Medium.)

Step 1 is runnable now and independent of the rest.

## Open questions / to confirm

- Window granularity: are time blocks fixed site-wide (10–1, 1–4) or per
  event? (Spec assumes a shared set per year, with event-specific windows
  allowed.)
- Do roles differ between the tours site and the festival site? (Role list may
  need to be per-site configurable.)
- Cover assignment in the final days: fully manual, or a "fill gaps from cover,
  nearest-first" button mirroring the auto-match proposal?
