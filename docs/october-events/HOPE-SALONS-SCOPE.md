# Hope Salons scope + October Events multi-business direction

Status: scoping. Owner: Daniel. Plugin: `dev/october-events` (October Events).

Hope Salons runs intimate talks and dinners. It is an events business, not a hair
salon. This document scopes what Hope Salons v1 needs and sets the operating rules
for October Events as a plugin that serves more than one type of event business
from a single codebase.

---

## 1. Operating principle: one codebase, many business types

Every change ships as a versioned update to the one plugin, gated by a feature
flag and driven by brand/settings. The same release runs a festival (ADF), an
intimate-events series (Hope Salons) or an ads-only site, and each install turns
on only what it needs. A change that only makes sense for one site does not enter
the core; it sits behind a flag or a setting.

This is the test applied to every item below.

---

## 2. Hope Salons v1: decided scope

Confirmed by Daniel:

| Decision | Answer | Consequence |
|---|---|---|
| Access model | **Hybrid** | Members get access and better rates; some salons open to non-members at a higher price |
| Event shape | **Single intimate event** | One capacity per salon. Per-part capacity is **not** needed in v1 |
| Gated library | **Maybe later** | Not built now. Keep the membership entitlement cleanly checkable so a gate can be added later |
| Site type | **October client site** | Security bar is "each user sees only their own data", which the plugin already meets |

### What we build for Hope v1

| # | Item | Status in plugin today | Work |
|---|---|---|---|
| A | **Members module (hybrid)** | `members_only` ticket rates, Stripe membership detection and join-to-unlock exist, but ship off (`membership_enabled` defaults false) and the `members` toggle is not enforced | Wire the flag on and enforce it; set up Hope's Stripe membership price IDs; test member vs guest rates on the same event (hybrid = one open rate + one member rate per salon) |
| B | **Dinner details per guest** | Only an attendee **name** is stored per ticket (`oe_tickets.attendee_name`). No custom fields | Net-new small module: configurable per-attendee questions (dietary, plus-one, seating notes), stored per ticket, shown in the admin registrations view, the CSV export and check-in |
| C | **Brand setup** | Settings → Brand exists | Configure Hope Salons brand, logo, sender identity |
| D | **Waitlist for oversubscribed salons** | `Ticketing/Waitlist` exists | Enable and confirm the flow for low-capacity intimate events |

### Explicitly out of Hope v1

- Per-part / sub-session capacity (single intimate event does not need it).
- Gated members' library (deferred).
- Member directory (not requested for Hope).

De-scoping these keeps v1 small: one module to wire on, one small module to build,
plus brand and waitlist config.

### Security note (client-site bar)

- Own-data isolation only: a buyer sees their own tickets and account, which
  `Orders::for_account` already enforces. No multi-tenant isolation needed.
- **Dietary and allergy data is health-related personal data under UK GDPR.** The
  dinner-details module must access-control it, keep it out of general marketing
  exports, and set a retention rule. Do not treat it as an ordinary text field.
- The membership entitlement check runs server-side, so a later content gate
  cannot be bypassed from the client.

---

## 3. Cross-cutting platform work (benefits every site, not just Hope)

### P1. Flag-hardening (foundation)

Of the 8 declared feature toggles, only `tickets` and `volunteers` are enforced in
code. `directory`, `destinations`, `products`, `stories`, `accounts` and
`contacts` show a checkbox that does nothing: the module keeps booting when the box
is unticked. This is the base every multi-business install depends on.

- Wire each unenforced toggle to a single early-return at its init point, so "off"
  registers no CPT, shortcode, REST route, cron job or asset.
- Add a `members` toggle and fold `membership_enabled` under it.
- Prove zero-boot per module with Query Monitor, module on vs off, and record the
  load delta.

Result: install one plugin, run only what a site needs, with none of the
multi-plugin cost (shared core, dependency order, release matrix) that splitting
into separate plugins would create.

### P2. Ad Manager merge

Bring `oc-ad-manager` in as a toggleable `ads` module so contacts, payments and ads
live in one admin. This reverses the 1.4.0 split and is recorded here as a
deliberate change.

- Preserve the hub/partner **cross-site syndication feed**; it must survive the
  merge as a module capability, not be dropped because it now lives inside an
  events plugin.
- Migrate ad data, then retire the standalone plugin the same way the legacy Event
  Tickets plugin was retired (migrate, verify, deactivate).
- Audit `oc-ad-manager` in full before writing the merge plan.

### P3. Update fleet

The GitHub self-updater (`Updater.php`) already polls Releases and offers one-click
install through Dashboard → Updates, so "no zip each time, the site requests it" is
already true. The gap is fleet management, not the update mechanism.

- **Central visibility:** one view of which site is on which version.
- **Near-instant rollout (optional):** an endpoint or cron nudge so a critical fix
  lands in minutes, not the default twice-daily WordPress check.
- **Staged rollout (optional):** ship to a pilot site, then the rest.

Build the central view first; instant push and staging follow if the site count
justifies them.

---

## 4. Parked roadmap (other business types will need these)

| Item | Trigger to build | Reuse |
|---|---|---|
| Per-part / sub-session capacity | A site runs multi-track evenings or several capped sittings | The Guided Tours slot engine (`oe_gt_reservations`) already caps timed slots |
| Gated resource library | Hope (or another site) wants members' content | Extend the `[guided_gate]` primitive; store or integrate the content, do not rebuild an LMS |
| Member directory | A community wants member visibility | New build; adds member PII to protect |
| Native recurrence | A monthly series becomes tedious to post by hand | A "duplicate monthly" helper; each occurrence stays its own post |

---

## 5. Sequencing

1. **Phase 0. Flag-hardening (P1).** Foundation for every multi-business install.
   Behaviour identical when all features are on, so nothing breaks for current
   sites.
2. **Phase 1. Hope Salons v1.** Members module on (A), dinner details module (B),
   brand (C), waitlist (D).
3. **Phase 2. Ad Manager merge (P2).** Independent track; can run alongside Phase 1.
4. **Phase 3. Update fleet (P3).** Central version view first.

Parked items pull forward only when a live site needs them.

---

## 6. Rough effort

Sizing is directional (S small, M medium, L larger), for planning not commitment.

| Item | Size | Note |
|---|---|---|
| P1 Flag-hardening | M | Six toggles plus `members`, mechanical but needs per-module care and testing |
| A Members on (hybrid) | S–M | Mostly built; work is enforcement, Hope's Stripe tiers, and testing |
| B Dinner details | M | New per-attendee fields, checkout UI, storage, export, check-in, plus the GDPR handling |
| C Brand | S | Settings config |
| D Waitlist | S | Enable and verify existing feature |
| P2 Ad Manager merge | L | Full audit, module port, data migration, keep syndication, retire old plugin |
| P3 Update fleet (central view) | M | New endpoint and a small dashboard |

---

## 7. Open decisions

1. Which Stripe membership tiers does Hope run, and at what price (monthly,
   yearly)? Needed to configure the members module.
2. Dinner-details fields: the exact question set (dietary, allergies, plus-one,
   seating preference, access needs) and which are required.
3. Update fleet: is the central version view enough for now, or is instant push
   wanted from the start?
4. Ad Manager merge timing: run it alongside Hope v1, or after.
