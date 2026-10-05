# October Events — Post-festival roadmap

Consolidated plan for everything scoped during and after the Metro Atlanta 2026
festival (Oct 3–4 / Oct 10). Written 2026-10-05. Current shipped version:
**1.199.6**.

This is the single source of truth for the agreed build queue. Each workstream
has its goal, the decisions already locked, the design, open questions, and a
target release. Build in the order below unless priorities change.

Related specs: volunteer pool / location allocation is detailed separately in
[`volunteer-pool.md`](volunteer-pool.md); this roadmap references it rather than
repeating it.

---

## Release sequence at a glance

| Release | Workstream | Risk | Why this order |
|---------|-----------|------|----------------|
| **1.200.0** | Volunteer comp flag + reporting exclusion | Low (read-only queries) | Fixes skewed sales numbers now; unblocks everything volunteer |
| **1.201.0** | Volunteer ticket lifecycle (auto-issue 2 QRs, 48h reminder) | Medium | Depends on the comp flag |
| **1.202.0** | Scanner: blue volunteer state + thank-you | Medium (touches live scanner) | Device-tested before ship; isolated change |
| **1.203.0** | Shift check-in + cancel/no-show ticket void | Medium–High | Depends on lifecycle + scanner state |
| **1.204.0** | End-of-event report (single + multi-event PDF) | Low | Standalone; high value for directors |
| **1.205.0** | Locations map email | Medium | Standalone; needs address field per location |
| **1.206.0** | Tickets dashboard UX (one page + refresh) | Medium | Consolidation; best after the above settle |
| **1.207.0+** | Volunteer pool / location allocation | High | Large; see `volunteer-pool.md` |
| **Backlog** | Batch check-in, instant-scan, volunteer chat | — | Device-dependent or held |

Versioning reminder: bump three places in lockstep — the `Version:` header in
`october-events.php`, the `OE_VERSION` constant, and `Stable tag` in
`readme.txt`. `OE_DB_VERSION` bumps only on schema change.

---

## 1. Volunteer comp tickets — data integrity (1.200.0)

### Problem
Volunteer tickets currently issue a normal code. They count as ticket sales and
drag down the average sale price. Revenue and volume reporting is skewed.

### Decisions locked
- Volunteers do not buy tickets. Each volunteer is auto-issued **2 tickets** as
  QR codes: one for them, one guest.
- Volunteer/comp tickets are **excluded** from sales count, revenue, and average
  order value.
- Volunteer attendance **is kept and shown**, as a separate line, never merged
  into paid figures.
- The volunteer and their guest **both count toward venue capacity**. The comp
  exclusion is a revenue concept, not a capacity one. Capacity must include
  comps or a tour can be oversold.

### Design
- Add a `comp`/`kind` flag to the ticket row (e.g. `kind = 'paid' | 'volunteer'`),
  plus a `volunteer_id` link. One flag drives reporting, scanner colour, and the
  kill logic in later releases.
- **Retrofit:** existing volunteer tickets were issued as normal codes, so a
  one-off migration flags historic volunteer tickets as `volunteer`. Identify
  them by the volunteer records / zero-price / the order route that created
  them. This lets us clean the current numbers, not just future ones.
- Every reporting query filters `kind = 'paid'` for sales/revenue/average, and
  reports volunteers on their own line (issued / attended / no-show).

### This release is safe to ship first
No scanner changes. It is read-model and a data flag. It fixes the embarrassing
numbers immediately and is the dependency for every other volunteer feature.

---

## 2. Volunteer ticket lifecycle (1.201.0)

### Goal
Volunteers get their tickets automatically, with a reminder close to the day.

### Decisions locked
- 2 QR tickets auto-issued to each confirmed volunteer (self + guest), zero
  price, linked to the shift.
- A **48-hour** shift reminder goes out with both QR codes inline (same
  per-token QR as the ticket email), plus shift details (where, when, role).

### Design
- Reuse the existing cron and email transport. 48h before the shift, send the
  reminder if not already sent (one send-flag per volunteer per shift).
- No purchase, no order, no counting toward sales (handled by the comp flag).

### Open question
- Reminder channel: email only, or email + SMS? SMS costs per message but lands
  better on the day. Default: email now, SMS as an add-on later.

---

## 3. Scanner: blue volunteer state + thank-you (1.202.0)

### Goal
A volunteer scan reads as special and warm, not like a paid admit.

### Decisions locked
- Valid volunteer scan turns the result **blue** (distinct from green paid and
  red blocked) and shows **"Volunteer — you make the festival happen, thank
  you"** with their name.

### Scanner result states

| Result | Colour | Message |
|--------|--------|---------|
| Paid, valid | Green | ✓ Checked in |
| Volunteer, valid | Blue | ✓ Volunteer — you make the festival happen, thank you |
| Already in (same door) | Red | ✗ Already checked in |
| Cancelled volunteer | Red | ✗ Volunteer shift cancelled |
| No-show volunteer | Red | ✗ No show — ticket void |

### Guardrails (non-negotiable)
- Keep a **director override** so a lead can admit anyone despite a red
  void/cancel state. Never a dead end at the door.
- Tone the void/cancel copy as "see the shift lead", not a public shaming. The
  deterrent lands without the scene.

### Process note
This touches `checkin.js`, the file that broke the camera once (1.199.4). Ship
the colour/message change in isolation and **test on a real phone** before
release. No camera-constraint changes bundled in.

---

## 4. Shift check-in + cancel/no-show void (1.203.0)

### Goal
A volunteer who cancels or fails to work their shift has their free tickets stop
working, so the free perk can't be used without doing the shift.

### Decisions locked
- Cancel or no-show voids **both** the volunteer's tickets (self + guest).
- **Cancel** auto-voids immediately (volunteer cancel link, or admin).
- **No-show** is determined after the shift, from who did and didn't work it.

### Roles (LOCKED)
Confirmation is owned by a lead, so the admin is never the bottleneck and each
scope has one responsible person.

- **Event lead**: owns an event, or the whole festival. Confirms attendance and
  no-shows across it, and is the fallback for any location with no lead.
- **Location lead**: owns one location on a tour. Confirms the volunteers at
  their location at shift end. Their roster, their call.
- **Fallback chain**: location lead → event lead → admin. A location with no
  assigned lead rolls up to the event lead so nothing goes unconfirmed.
- **Access**: a lead gets a lead-level PIN (same model as the check-in PIN) that
  unlocks the confirm roster for their scope only.

A lead is a user/volunteer assigned to an event or a location with confirm
rights. This roles concept is reused by the end-of-event report (coverage per
lead) and the festival readiness / sign-off layer.

### Shift check-in model
- The volunteer web app gains a "check in to my shift" area: pick the location
  and time, tick the name off. This is a **convenience signal only** — it helps
  the lead see who has arrived.
- Everyone not confirmed shows as **unknown (?)**.
- At the **end of the shift**, the **location lead** (or event lead by fallback)
  reviews the roster and marks genuine **no-shows**. No-show → tickets void.

### Presence authority (DECIDED)
**Lead-confirm is authoritative, not self-confirm.** A volunteer ticking their
own name is gameable (a no-show could mark themselves present from home and keep
their free guest tickets alive), so self-confirm never, by itself, keeps guest
tickets valid. The lead who owns the location or event is the one whose
confirmation counts.

### Reversibility
Voiding must be one-click reversible. A no-show who turns up late with a reason,
or a mis-tap, needs re-enable. Pairs with the door override above.

### Offline caveat (accept, don't pretend)
The scanner validates offline from a cached manifest, and reception is poor. A
cancellation or void made **after** a phone caches its manifest won't reach that
phone until it re-syncs. The void state rides in the manifest refresh and the
online path stays authoritative, but last-minute voids are a known soft spot.

---

## 5. End-of-event report (1.204.0)

### Goal
One click produces a clean, shareable report for the directors.

### Decisions locked
- **Single-event**: a "Report" button per event.
- **Multi-event**: a report page with a checklist of events; tick which to
  include; combined report with per-event breakdown plus festival totals.
- Lead with **festival totals**, then drill into each event (directors want the
  headline first).

### What it contains
Tickets sold by type and revenue (paid only); attendance vs sold and attendance
rate; **volunteers as a separate line** (issued / worked / no-show); doors per
visitor; check-ins by time of day and by day; busiest and quietest locations;
waitlist size and conversions; promo codes and discount given; guided tour
take-up; volunteer coverage per shift.

### How the PDF is made
- **Route A (recommended):** a branded, print-first report page with a Download
  button that uses the browser's save-as-PDF. Reuses the ticket page's print
  approach, no new dependency, charts render cleanly, two clicks to a shareable
  PDF. Honours the shared **paper size** setting (US Letter / A4, see §6).
- **Route B (later, if needed):** bundle a PHP PDF library for a true attachable
  file that can be auto-emailed to directors. Heavier; only when auto-email is
  wanted.

---

## 6. Locations map email (1.205.0)

### Goal
A nicely designed map of all tour locations so attendees stop struggling to find
them. Print it, or scan a QR to open it live on the phone.

### Decisions locked
- Send the batch **7 days** before a tour to everyone holding a ticket.
- **Late buyers** inside that 7-day window get the map **bundled into their
  ticket confirmation** (one email, map section appended). Early buyers get the
  standalone map at the 7-day mark.
- **One send-flag per ticket-holder per event** stops anyone getting the map
  twice (a buyer at exactly 7 days out gets it once, not from both triggers).

### Data: generated from the website, not a KML (LOCKED)
No separate Google map, no KML import. Each location carries its own fields in
the plugin, and the map, list, Directions links and section grouping all derive
from them.

Custom fields per location:

| Field | Purpose |
|-------|---------|
| Street address, city, state, zip | Display, Directions link, geocoding |
| Latitude / longitude | Auto-filled by geocoding the address (`OE_GOOGLE_MAPS_KEY`); editable if a pin lands wrong |
| Open on (day / session) | Drives section grouping and "(Oct 4 only)" labels |
| Display order | Optional; order within a section, else alphabetical |
| Access note | Optional; parking, entrance |

You type the address once → the plugin geocodes it to a pin → the same address
feeds the map, the list and the Directions link. One input, three outputs.
Reverse-geocoding a pin is **not** used (it returns the wrong road for a private
home).

**Sectioning** comes from the **Open on** field (the KML folders map straight to
it). Auto-group by the days a location is open, with an **optional override
label** per group for cases like "Bonus: Lake Oconee". Auto default, manual
wording where it matters.

**To confirm in code when building:** whether locations already exist as venues
(the check-in doors) or need a new location type. The fields bolt onto whichever
it is; do not guess.

### Design
- Branded email: a static Google Maps image (Maps Static API, using the existing
  `OE_GOOGLE_MAPS_KEY`) with numbered markers, a matching numbered list with
  **property name + full street address** per stop (name and address stacked,
  not run together), and a **Directions** link per stop.
- A **QR + button** opens an interactive map page on the phone (tap a pin for
  directions, add to home screen). Hosted as a plugin route so pins match the
  email and the link is reusable.
- Reuse the daily cron for the 7-day trigger; the purchase trigger handles late
  buyers.

### Print / paper size (LOCKED)
Printable outputs honour a single **paper size** setting, **US Letter or A4**,
in the main plugin Settings (not per email). Drives the `@page` size on the map
email and on the end-of-event report. Default US Letter (US-based festival).

### Open questions
- Multi-day tours with tight clusters plus a far outlier (e.g. Carrollton cluster
  vs Lake Oconee) read badly on one frame. Decide: auto-fit one map, or split
  into per-day maps. Per-day is likely clearer.
- Lead time: fixed 7 days, or per-event setting?

A working mockup exists (12 homes, 3 days, numbered and colour-coded by day,
name + address stacked, US Letter / A4 print toggle). Use it as the visual
reference.

---

## 7. Tickets dashboard UX (1.206.0)

### Goal
Kill the tab-reload pain on bad reception; one page, refresh in place, less
duplication.

### Decisions locked (direction)
- One page with **collapsible, lazy-loaded sections** instead of full-page admin
  tabs (Attendees, Sales, Check-in log, Guided, Waitlist, Promos).
- **REST refresh buttons** per section so data reloads without a full page
  reload (critical on poor reception).
- A **sticky live overview** (sold, checked in, revenue) at the top.
- Audit and remove duplicated functions across the current tabs.

### Phased
1. Overview strip + REST refresh on the existing tabs.
2. Collapse tabs into one lazy-loaded page.
3. Duplication cleanup.

Write the detailed spec before building; this one is a refactor and benefits
from a design pass.

---

## 8. Volunteer pool / location allocation (1.207.0+)

Large workstream, specified separately in [`volunteer-pool.md`](volunteer-pool.md):
early recruitment against window × role targets with 25% contingency, pool
registration, availability by slot (multiple choice, one required), distance-
sorted self-pick, cover pool, auto-match proposal, switch requests, zip-centroid
haversine.

Open questions still to confirm there: time blocks fixed site-wide vs per event;
roles per site; final-days cover assignment manual vs fill-gaps-nearest-first.

---

## Backlog (device-dependent or held)

- **Batch / group check-in**: when the scanner reads multiple codes at once,
  check them all in and show one summary ("✓ N checked in — names…"), with
  already-in / invalid / wrong-door listed separately. Build and test on a real
  phone.
- **Instant-scan speed-up**: native `BarcodeDetector` for instant reads. This is
  what broke the camera in 1.199.4; re-approach carefully and device-test before
  shipping.
- **Volunteer chat / community**: per-tour (not site-wide) chat for the build-up
  and the day, with a daily digest notification. Held pending appetite; revisit
  after the allocation work.

---

## Consolidated open decisions

1. ~~**Shift presence authority** (1.203.0)~~ — DECIDED: lead-confirm
   authoritative, via event lead / location lead roles with a fallback chain.
   Self-confirm is convenience only.
2. **Volunteer reminder channel** (1.201.0): email only, or email + SMS.
3. **Map lead time** (1.205.0): fixed 7 days vs per-event setting.
4. **Map layout for spread-out tours** (1.205.0): one auto-fit map vs per-day
   maps.
5. **Report PDF route** (1.204.0): print-to-PDF now vs server PDF for auto-email
   later.
6. **Volunteer pool open questions** (1.207.0+): see `volunteer-pool.md`.

Nothing here is blocked waiting on all answers. 1.200.0 (comp flag + reporting
exclusion) can start immediately; the decisions above only gate their own
releases.
