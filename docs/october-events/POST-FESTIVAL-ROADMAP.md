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
| **1.205.0** | Locations map email (location groups) | Medium | Standalone; needs location fields + groups |
| **1.206.0** | Guided tour comms (instructions + map; 24h close + host list) | Medium | Shares map/cron machinery; recurring host ask |
| **1.207.0** | Tickets dashboard UX (one page + refresh) | Medium | Consolidation; best after the above settle |
| **1.208.0+** | Volunteer pool / location allocation | High | Large; see `volunteer-pool.md` |
| **(10)** | Volunteer accountability & profiles | High | Profiles now; no-show enforcement needs §4 shift check-in |
| **Backlog** | Batch check-in, instant-scan, volunteer chat | — | Device-dependent or held |

> **Version numbers shifted.** Invoices / receipts shipped out of band as
> **1.200.0** and **1.200.1** (a customer was waiting). The volunteer version
> numbers above are indicative; assign the real one at build time. The 1.199.7
> email-logo bugfix is still unshipped and can go any time.

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
| Group | Which location group it belongs to (see below) |
| Display order | Optional; order within a group, else alphabetical |
| Access note | Optional; parking, entrance |

You type the address once → the plugin geocodes it to a pin → the same address
feeds the map, the list and the Directions link. One input, three outputs.
Reverse-geocoding a pin is **not** used (it returns the wrong road for a private
home).

### Location groups (LOCKED)
Sections come from user-defined **groups**, not auto-derived days (this is the
KML-folder model, made native).

- A group has a **custom name**, a **colour**, and an **order**.
- Create as many groups as needed; a location belongs to **one** group (matches
  the KML; multi-group can come later if ever needed).
- On the map: one section per group, section title from the group name, **pin
  colour from the group colour**. So "Oct 3–4", "Sun only", "Bonus" become real
  groups you control, not guesses.
- One group is the happy path; more when a tour needs them.

**To confirm in code when building:** whether locations already exist as venues
(the check-in doors) or need a new location type, and where groups attach. The
fields bolt onto whichever it is; do not guess.

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

A working mockup exists (12 homes, 3 groups, numbered and colour-coded by group,
name + address stacked, logo top-left, US Letter / A4 print toggle). Use it as
the visual reference.

---

## 7. Guided tour comms (1.206.0)

Guided tours are their own audience with their own needs, handled separately
from the general locations map.

### 7a. Instructions + map email (LOCKED)
- Guided-tour bookers get a **separate email**, distinct from the self-guided
  locations map.
- **Arrival instructions**: a free-text field per guided tour for detailed,
  custom access details (building entry, security). Always bespoke, so it is a
  type-it-all field, not fixed sub-fields.
- **Attachment**: optional file per tour (e.g. an access or security PDF) sent
  with the email. Watch the transport (Brevo) attachment size cap.
- The email **states that no ticket is scanned here** — their **name is on a
  list on arrival**. Guided tours are list-based, not scan-based (ties to 7b:
  the host's list is the arrival check-off sheet).
- **Map**: the meeting point / building only (not a full route). The
  arrival-instructions field carries the specifics. Revisit only if a stops
  route is wanted.
- **Send**: on booking, with the confirmation. (A timed reminder before can be
  added later; not v1.)

### 7b. Close bookings 24h before + host guest list (LOCKED)
Automates a recurring ask from hosts.

- **24 hours before** the tour, close its bookings automatically (per-tour; 24h
  default, configurable).
- At the same trigger, email the **guest list to that tour's host(s)**.
- **Host**: a **contact repeater** field per guided tour — one or several hosts.
- **Guest list fields**: name, email, party size (always). **Dietary and
  accessibility** are an **optional capture, toggled per tour** (also serves
  conferences that provide lunch).
- The host may be the same person as a location lead (§4 roles) or separate;
  kept as a contact on the guided tour so it is flexible.

### Implication: booking form
If dietary / accessibility capture is enabled for a tour, those fields must be
**asked on the booking form at purchase**, not only shown on the host list. So
the per-tour toggle lives on the tour setup and flips the matching field(s) on
the booking form. Minor, but it touches the booking flow, not just the email.

Shares the cron and email machinery with the locations map (§6), which is why it
sits right after it.

---

## 8. Tickets dashboard UX (1.207.0)

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

## 9. Volunteer pool / location allocation (1.208.0+)

Large workstream, specified separately in [`volunteer-pool.md`](volunteer-pool.md):
early recruitment against window × role targets with 25% contingency, pool
registration, availability by slot (multiple choice, one required), distance-
sorted self-pick, cover pool, auto-match proposal, switch requests, zip-centroid
haversine.

Open questions still to confirm there: time blocks fixed site-wide vs per event;
roles per site; final-days cover assignment manual vs fill-gaps-nearest-first.

---

## 10. Volunteer accountability & profiles

Stop volunteers claiming a free ticket, touring, and skipping their shift, and
build a year-over-year picture of who is reliable and who games the system.

### The problem it closes
A volunteer's shift may be Sunday afternoon, but their free ticket can be used
Saturday morning. If they then no-show the shift, voiding the ticket (§4)
achieves nothing — it was already used. So enforcement cannot be only
"void the ticket on no-show"; it needs an after-the-fact cross-check.

### 10a. Volunteer profiles (buildable now, from existing data)
- One profile per volunteer, keyed by **normalised email**.
- Logs per year/event: signed up, worked the shift (once attendance exists),
  cancelled, and whether their **comp ticket was scanned** at any location.
- Surfaces: times volunteered, first-timer vs returning, reliability, and the
  abuse pattern (no-show + ticket used, repeated).
- **Identity limit (accepted):** email is the key. A fresh email evades the
  history; that raises the effort, it does not seal it. Fuzzy name matching is a
  later refinement, not v1.
- **Seed from what we have:** `VolunteerSignups` gives participation history;
  check-in scans give ticket-used. Both can seed profiles immediately, 2026
  included.

### 10b. Abuse cross-check (needs §4 shift check-in)
- End of festival, join **no-show** (lead marked it, §4) × **comp ticket
  scanned** (check-in data).
- No-show + never scanned → fine, not reported.
- No-show + scanned at a location → the **abuse list**: into the end-of-festival
  report and onto the profile.

### 10c. Repeat-offender gate on re-signup (needs profiles + saved card)
- A returning volunteer whose profile shows a prior no-show-with-ticket is
  **flagged** on re-signup, with a warm auto-email: thanks for signing up, we
  noticed last year, to issue this year's free ticket we need your card on file,
  charged only if you no-show, released if you work the shift.
- **A one-click "clear flag"** for genuine cases (a real emergency last year);
  do not punish a good volunteer.

### Card mechanism (DECIDED, corrected)
A pre-auth **hold expires in ~7 days**, so it cannot bridge months from signup
to the festival. The real mechanism is **save the card at signup (SetupIntent)
+ a conditional off-session charge after the festival on no-show**, not a live
hold. Caveats to accept: an off-session charge can hit 3DS and fail, and can be
disputed; the T&C consent at signup is what makes it defensible. Framing stays
warm ("authorised, released if you show").

### Enforcement reality (state plainly)
Chasing a **first-time** offender for payment with no card on file rarely
converts — those "please pay" emails are mostly symbolic. The teeth are
**detection + the saved-card gate on return**. Strategy: detect, warn once, and
make the free ticket conditional on a card if they come back. Do not sell it
internally as "we recover the money" on first offence.

### End-of-festival report additions
- **Cancel rate** and **no-show rate** as percentages, so the over-subscription
  buffer is set on real numbers. Cancels available for 2026; no-show % for 2026
  only with an attendance source (below).

### Retrospective 2026 (the key caveat)
Shift check-in did not exist in 2026, so the system **cannot know who skipped a
shift** last year on its own. Options:
- A lead's list (even a spreadsheet) of 2026 no-shows → import it and the full
  cross-check runs for 2026.
- No list → the 2026 report seeds participation + ticket-used per volunteer, and
  no-shows are entered manually where known. Future years are automatic once §4
  ships.

### Open decisions
1. **Card mechanism**: accept save-card + charge-on-no-show (not a live hold),
   flagged returners only?
2. **2026 no-show source**: is there a lead record of who didn't work their
   shift? Decides automatic vs manual retrospective cross-check.
3. **Enforcement sequence**: how many payment-request emails, over what window?
   (Draft the T&C clause + email copy.)
4. **Flag override**: confirm the one-click "clear flag".

### Sequencing
10a (profiles) + the 2026 retrospective seeding can start now on existing data.
10b and the report's no-show % depend on §4 shift check-in. 10c depends on 10a
plus saved-card (SetupIntent) support.

---

## 11. Customer profiles & audience intelligence

Store who buys tickets, give them a self-serve account, and build a picture of
the audience year over year. Extends existing infrastructure (`Account`,
`[oe_account_dashboard]`, the Members surface, and the invoices shipped in
1.200.x) rather than starting fresh.

### Two hard constraints (non-negotiable)
- **No dark pattern (GDPR).** October is UK-based; demographic data (gender, age,
  industry) is personal data and consent for profiling must be *freely given*.
  Dressing the optional survey as a mandatory step to force completion is
  coercion that invalidates the consent and is a reputational risk. Build it as
  a confident final step with honest copy and a clear, quiet **Skip** — that
  still converts the large majority. **Do not** build the "looks essential"
  version.
- **No PII leak on pre-fill.** Pre-filling a profile from a bare, unverified
  email entered at checkout lets anyone type someone else's address and see
  their saved gender/age/employer. Pre-fill freely only within the session that
  just bought (they control that inbox); for a returning person, load the full
  profile only when **logged in** or behind a one-tap magic link. Never pre-fill
  sensitive fields off an unverified email.

### Phasing

**A. Customer profile + account dashboard (per-site, start now):**
- Profile keyed by email, extending `Account`. Links to their orders.
- Customer dashboard (`[oe_account_dashboard]`) gains: change password, **download
  invoices** (reuses 1.200.x), and a list of events they hold / have held tickets
  for.
- Zero compliance exposure — it only lets people see their own tickets and
  invoices. Buildable immediately.

**B. Post-checkout demographics modal:**
- After the existing **Complete registration** button (no cart changes), a
  survey modal: safe pre-fill (per Flag 2), honest copy + visible Skip (Flag 1),
  saves via REST to the profile. Tickets are already issued; this is additive.
- Repeat buyers see their data pre-filled and confirm/edit in one tap.

**C. Demographics & behaviour dashboard (admin):**
- Graphs: gender / age band / industry / interests; multi-event attendees;
  multi-year returners; year-on-year skews. Thin in year one, compounds.

**D. Cross-site profiles (the heavy, architectural phase):**
- A central hub (the platform / OMI `dev/platform`, or one designated site)
  keyed by email; sites sync via the existing partner connection (the same rails
  that sync volunteers). Merges identity, event history and demographics across
  sites.
- Per-site A–C delivers most of the value; D federates it later.

### Open decisions
1. **Compliance posture**: honest/optional/skippable (recommended, and the only
   version with legally usable consent) vs the coercive version.
2. **Fields**: gender, age band, industry, interests, location — confirm the
   set. **Avoid special-category data** (ethnicity, health, etc.) unless there is
   a specific lawful basis; it is a different legal regime.
3. **Cross-site hub**: platform/OMI as the central store vs a designated site.
4. **Accounts**: every buyer gets a lightweight profile by email; a
   password/login is optional (only for the dashboard). Confirm.

### Dependencies / sequencing
A reuses `Account` + dashboard + invoices and ships now. B/C wait on the
compliance posture and field set. D is a platform-architecture piece and the
slow one. Add GDPR export/delete to the dashboard before B goes live.

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
6. ~~**Guided map content**~~ — DECIDED: meeting point / building only; the
   arrival-instructions field carries the detail.
7. ~~**Guided instructions send timing**~~ — DECIDED: on booking with the
   confirmation (timed reminder later if wanted).
8. ~~**Guided host + guest-list fields**~~ — DECIDED: host is a contact repeater
   per tour; list = name, email, party size, with optional per-tour dietary /
   accessibility capture.
9. **Volunteer pool open questions** (1.208.0+): see `volunteer-pool.md`.

Nothing here is blocked waiting on all answers. 1.200.0 (comp flag + reporting
exclusion) can start immediately; the decisions above only gate their own
releases.
