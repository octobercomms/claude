# Tours rationalization: one event model, a tour capability, cross-site embeds

Status: scoping (decision doc). Owner: Daniel. Plugin: `dev/october-events`.
Based on a read-only audit of the `GuidedTours` module. Answers: are tours just
multi-location events, what do they integrate with, and how do we separate them
onto their own site.

## Verdict

**The listing is a multi-location event; the booking machinery is not.** A "tour"
today is a set of **Location** posts sharing a `city|year` key, each carrying its
own timed-slot capacity calendar, unlocked by one ticket. There is no `tour` CPT.

- **Collapses into "an event with one-or-more locations + a flag" (~30-40%):**
  the multi-location container, and the arrival mode (name-on-a-list vs QR scan →
  a `check_in_mode: qr | list` capability).
- **Stays as a tour-only extension (~60-70%):** the booking engine in
  `includes/GuidedTours/` (~500 lines + the `oe_gt_reservations` table):
  per-location timed slots with capacity, ticket-gated free booking (the "pass"
  model), slot waitlists with party-aware promotion, 48h reconfirm-or-release, and
  a whole-tour release schedule with an announcement blast.

So: unify the model, keep the booking engine as a capability you switch on. Do not
force the slot/reservation engine into the base event type.

Not features today (despite the "guided tour" name): routes/itineraries, maps
beyond a per-location address, and docents as an entity ("docent" is just a
default volunteer role label).

## Recommended model

- **One plugin-owned `event` CPT** (de-Jet Phase A) with an optional **locations**
  relation. A single-venue talk has one location; a tour/trail/open-studios has
  many.
- **Capability flags per event**, not separate types:
  - `check_in_mode: qr | list`
  - `booking_mode: ticket (paid QR) | rsvp (free managed) | gated-slots (the tour pass + timed-slot engine)`
- The `GuidedTours` engine becomes the `gated-slots` capability attached to a
  multi-location event, rather than a parallel Location-CPT system. The reservation
  table and cron keep working; they hang off events instead of a bespoke CPT.

This generalizes: any festival has single-venue events and multi-location trails;
one model, one UI/UX/language serves both.

## Integration map

"Mostly volunteers" is the *visible* link, not the *binding* one.

| Surface | Coupling | Note |
|---|---|---|
| **Ticketing / orders** | **Tight (same DB)** | The tour gate reads `orders`/`tickets` directly; the `oe_gt_reservations` table is created inside the ticketing schema. Tours can't run without ticketing on the install. |
| Volunteers | Loose, cross-site-ready | Tours and volunteers meet only through the Location CPT. A partner feed (`oe/v1/volunteers/partner-locations`) already lets a festival site pull a tours site's locations and seed docent shifts. |
| Email / comms | Loose (shared library) | `GuidedTours\Mailer` → shared `Mail\Transactional`; `Hosts\HostMailer` serves events and tours off one codebase. |
| Accounts / CRM | Near-zero | Tour booking is email-only; reservations don't link to `oe_account` or capture into `Mail\Contacts`. |
| Check-in | None for tours | Name-on-list + CSV; the QR `/checkin` PWA is events/tickets only. |
| Reporting | Self-contained | Per-building CSV + audit log, not in shared reports. |

## Separating tours onto their own site

The code already assumes this split (same codebase serves a festival site and a
tours site; the partner feed is built for it). The **one** blocker is the ticket
gate: `GuidedTours\Eligibility` reads the **local** orders/tickets tables.

**Decision needed:** either
1. the **tours site sells its own tour tickets** (simplest — the gate's local
   lookup just works), or
2. **federate the eligibility check** to whichever site sells the tickets, via a
   shared-token REST call — the pattern already exists for volunteer thank-you
   codes (`oe/v1/volunteer-check`).

Resolve that and tours is otherwise a self-contained module that already
syndicates.

## Cross-site embeds

The owner's "host your own data, show it in one place" model is half-built.

- **Already there:** CORS is owned and origin-allow-listed for `oe/v1`
  (`Cors.php`, driven by `platform_origins`); and two syndication precedents — the
  volunteer partner feed (server-to-server pull, cached, rendered by local
  shortcodes) and `oc-ad-manager`'s hub/partner `ocad/v1` render model (public
  `/render` HTML + partner shortcode with callbacks).
- **To add for a general embed:** public, **scoped** read endpoints
  (`oe/v1/embed/{volunteers|events|tours}` with `site` / `city|year` scoping),
  returning JSON or ready HTML; and a loader (iframe is simplest — zero CORS,
  style-isolated — or a `<script>` injector for origins already in
  `platform_origins`).
- **Lift:** listing/discovery embeds are small (scoped public endpoints + reuse
  `Cors` + copy the ad-manager render pattern). **Booking embeds are harder** — an
  iframe of the owning site is the right answer, because the gate sets a
  host-scoped cookie and reads the local ticketing DB.

This is also a core SaaS feature: the same embed lets any customer drop their
volunteers or events onto whatever website they already run.

## Open decisions

1. **Adopt the unified model?** One `event` CPT + locations relation + capability
   flags, with the tour booking engine as the `gated-slots` capability. (Needs the
   owner's yes; it shapes de-Jet Phase A and B.)
2. **Tours-site ticket gate:** sell tickets on the tours site, or federate
   eligibility to the selling site?
3. **Embed scope/priority:** build the scoped public read endpoints + loader now
   (it serves both the tours↔festival split and the SaaS story), or later?
