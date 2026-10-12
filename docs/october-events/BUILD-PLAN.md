# Build plan: get the reference tenant fully native, then refine

Status: **active build scope**. Owner: Daniel. Plugin: `dev/october-events`.

The one ordered engineering backlog. It unifies the de-Jet phases
([`DE-JET-MIGRATION.md`](DE-JET-MIGRATION.md)), the capability-pack model
([`EVENT-MODEL.md`](EVENT-MODEL.md)), the field mapping and structured fields
([`FIELD-MAPPING.md`](FIELD-MAPPING.md)), the roles/access model
([`CREW-MODULE.md`](CREW-MODULE.md)), and the housekeeping build items from the
brief into a single sequence. Those docs hold the detail; this one holds the
order and the "done" line.

## Sequencing decision (build kick-off)

M0 and the M1 core (pack framework + event-details metabox + the second-tenant
base fields) are the shared spine, built first. **After M1 the build runs two
tracks in parallel** (owner decision): push ADF toward the native cutover
(M2 → M4) while standing up the Concrete Communities checkout slice (brand colour
+ external-link / native checkout + section tokens + Elementor dynamic tags) for
new-client value sooner. Keep each track's PRs self-contained so the parallelism
does not muddy either.

**Status:** M0 started — `adoption_mode` and the `entitlement_tier` stub added to
Settings (read, not enforced); per-site feature flags already existed in
`Features.php`.

## The goal of this build

The reference tenant (the festival and its tours) running **natively on the
plugin, off JetEngine / Crocoblock / Elementor-for-data**, refined across a full
cycle. Not selling to others yet. The sell-to-others plumbing is scoped and
parked in [`SCOPE-GAPS.md`](SCOPE-GAPS.md); do not start it here.

Two rules hold throughout, because they are cheap now and expensive to retrofit:

- **Tenant-aware.** Every new feature keeps each entity's data self-contained.
  The reference tenant is tenant one, never baked in as the product.
- **Flag, don't fork.** Adoption mode keeps the live site untouched until each
  surface has a native replacement and the site is opted over deliberately.

---

## Master sequence

| M | Milestone | Maps to | What it unblocks | Safe on live ADF? |
|---|---|---|---|---|
| 0 | Foundation | de-Jet Phase 0 + entitlements stub | Safe toggling; nothing to retrofit later | Yes (no behaviour change) |
| 1 | Own the data | de-Jet A + B + pack framework + structured fields | A plain install can hold and edit a real event; ADF's switchers become native packs | Yes (additive; adoption mode on) |
| 2 | Front end | de-Jet C + D | Fresh install looks good with zero design; 200-event filterable archive; past-tours archive | Yes (templates ship off on Jet sites) |
| 3 | Elementor bridge | de-Jet Phase E | ADF's bespoke pages render without JetEngine, so JetEngine can actually come off | Yes (widgets load only with Elementor) |
| 4 | Cut ADF over | migrators + adoption_mode off + retirements | ADF is fully native; Check & Log Email and the staff SPA retired | The cutover itself; staged + reversible |
| 5 | Refine | Track A wins + housekeeping UX + CRM/access | The "iron out the detail" pass across a live cycle | Yes |
| 6 | Messaging completeness | transactional email/SMS gap-fill | Every money/membership/schedule/waitlist/privacy event has a message | Yes (additive templates) |
| 7 | Reporting & insight | end-of-event report + demographics + survey + pool | Organiser reads one report, surveys, keeps a volunteer pool | Yes |
| F | Self-serve forms | de-Jet Phase F | Organizer signup / edit-own-event (leans Track B) | Parallel, not required for ADF native |
| G | Ads module | de-Jet Phase G | Folds `oc-ad-manager` in; independent track | Parallel |

**Cheap festival wins ship anytime.** The Track A queue (comp flag + reporting
exclusion, end-of-event report, customer dashboard) has no dependency on this
sequence. Keep shipping it in parallel so near-term value never stalls behind the
refactor. Detail and ordering in
[`POST-FESTIVAL-ROADMAP.md`](POST-FESTIVAL-ROADMAP.md).

---

## M0 — Foundation

- de-Jet **Phase 0**: feature-flag hardening (`Features.php`, `Plugin.php::init`
  early-returns) + an explicit **`adoption_mode`** setting (auto-detected from
  JetEngine / `post_type_exists('events')`, overridable).
- **Entitlements flag (stub).** Add a per-install pack-tier/entitlement record the
  plugin can read. Read it; do not enforce. This is the single cheap hook that
  stops A2 in [`SCOPE-GAPS.md`](SCOPE-GAPS.md) becoming a retrofit.

Done when: features can be switched per install with no behavioural change on the
live site, and the entitlement record exists and is read.

---

## M1 — Own the data (the core of the build)

Three strands, built together because they share the metabox and the migrator.

### 1.1 Capability-pack framework
The mechanism behind [`EVENT-MODEL.md`](EVENT-MODEL.md). One `event` type, packs
switched on per event.
- A pack **registry** (id, label, enable-toggle meta `_oe_pack_{id}_enabled`,
  field set, conditional-reveal rules).
- Base event fields always present; pack fields reveal when the pack is on.
- Replaces ADF's ad-hoc switchers (`tickets-section-onoff`,
  `conference-page-switcher`, `exhibition-page-switcher`) with one consistent
  model, and fixes the broken conditional logic noted in FIELD-MAPPING (tickets
  and schedule wired to the wrong switch; `virtual-event` never matching).

### 1.2 Event-details metabox (de-Jet Phase B, the headline blocker)
The one thing that stops a plain install holding an event. Writes `_oe_plan_*`
(name / start / end / price / location / organizer / description) and, in
self-contained mode, becomes the source of truth. In adoption mode it is additive
and never overwrites JetEngine meta.
- Carries the **structured fields** from FIELD-MAPPING, built here so the data is
  clean from day one: **link-aware credits** (`{name, url}` per credit, including
  the new `realtor`), **availability** (Saturday / Sunday / Both / Specific,
  retiring `sat_only` / `sun_only`), and the **preset-first status badge**
  (`{text, preset}`, dropdown not raw color picker, custom color as escape hatch
  only). No pasted HTML in any field.
- **Second-tenant base fields (Concrete Communities parity).** Add the three
  fields CC/ADF already run in ACF that the single-tenant model missed: a
  **per-listing brand colour + image** (distinct from the category colour and the
  status preset; CC paints the whole page from it), a **reference number**
  (`event_number`), and a **ticketing external-link mode** on the Tickets pack
  (`ticket_link` + link text) so a listing can link out (EventBrite today) instead
  of selling natively, and switch to native later. Exposed as Elementor dynamic
  tags in M3 so bespoke templates bind to them.

### 1.3 Own CPT + migrator (de-Jet Phase A)
- Mode-aware own registration for `events` / `volunteer` (reuse
  `register_owned()`), identical slug and rewrite so permalinks and Elementor
  templates do not move.
- `wp oe migrate-cpts`: JetEngine keys to `_oe_plan_*` / pack fields, **idempotent,
  dry-runnable, opt-in**, with the FIELD-MAPPING cleanups baked in (city trim,
  2025 volunteer dates to a real date, Day 1 / Day 2 schedule normalization,
  hyphen/underscore key reconciliation, Directory `_description`).

### Pack coverage for ADF parity (ordered inside M1)
ADF runs these switchers live, so each needs a native pack before ADF can leave
JetEngine. Field sets are already captured in [`reference/`](reference/); no
further owner input needed.

1. **Base + Tickets (display) + Volunteers + Tour** — core. Tickets display is
   price text only; the real orders/QR/checkout engine already exists and is not
   touched. Volunteers is mostly built (shifts + `oe_volunteer_signups`); the pack
   is the toggle + the metabox wiring. Tour reuses `GuidedTours` + the
   city/year-taxonomy locations link ([`TOURS-RATIONALIZATION.md`](TOURS-RATIONALIZATION.md)).
2. **Conference** — `about`, speakers / past-speakers repeaters, sessions
   (per-day schedule, normalized), accommodation. Required for ADF, not optional.
3. **Exhibition** — `exhibitor` repeater. Required for ADF, not optional.
4. **Staff (non-shift roles)** — a role content page + apply-by-email form (the
   light entry into [`CREW-MODULE.md`](CREW-MODULE.md); full lifecycle later).

Done when: a plain WordPress + October Events install can create an event, switch
on any pack ADF uses, enter all its data through the metabox with structured
fields, and the migrator can dry-run ADF's and the tours' content into the model.

---

## M2 — Front end

- de-Jet **Phase C**: default templates (blocks + shortcodes) for listings /
  archive, single event, board, map (reuse `[oe_design_map]`), volunteer listing.
  A fresh install looks good with zero design. Templates ship **on** only for
  self-contained installs; never hijack `template_include` where Elementor is
  rendering. **Leave settings-driven branding hooks in** (brand color, logo, type)
  even though only the reference tenant's values are set, so A4 in SCOPE-GAPS is
  not a retrofit.
- **Section theming tokens (the "native, not an embed" contract).** Sections
  render presentation-light and inherit the theme (type, colour) with no plugin
  chrome. A small token set (accent + accent-text, font source, radius, border
  width, button style/shape, control height, spacing), set per-site and
  overridable per section, drives the functional parts (ticket rows, pay button)
  and **feeds the Stripe Elements appearance API** so the card iframe matches too.
  Part-classes (`.oe-ticket-row`, `.oe-checkout__pay`, …) are the Elementor-custom-
  CSS escape hatch. **No per-element CSS editor** in settings — Elementor owns the
  frame. Detail in [`UI-SPEC.md`](UI-SPEC.md) §4.
- de-Jet **Phase D**: own filtering / facets over the listing REST endpoints,
  replacing JetSmartFilters. Filter by category / type / year / city /
  past|upcoming; a filterable past archive (the ~200-event and past-tours case);
  scoped placements (a city tour page shows only that city's current-year
  locations). Same engine feeds the cross-site embeds
  (`oe/v1/embed/{volunteers|events|tours}`).

Done when: every public festival and tours surface has a native equivalent that
reads plugin data, and the archives filter at the real content volume.

---

## M3 — Elementor bridge

- de-Jet **Phase E**: Elementor-compatible widgets + dynamic tags exposing plugin
  data, loaded only when Elementor is active, never requiring JetEngine. The
  dynamic tags must include the second-tenant fields (brand colour/image, ticket
  link, reference number) so a bespoke template like Concrete Communities' can
  paint the page and wire the ticket button without JetEngine.

Done when: ADF's bespoke Elementor pages — and a second bespoke tenant like CC —
can be rebuilt against plugin data with no JetEngine present. This is the
technical precondition for the cutover.

---

## M4 — Cut the reference tenant over

The deliberate, staged, reversible switch from adoption mode to native.

- Run the migrators on the festival and on the tours site (dry-run, verify diff,
  commit).
- Confirm every surface from M2/M3 covers what Elementor + JetEngine rendered.
- Flip `adoption_mode` off per site.
- Retire **JetEngine / Crocoblock / JetSmartFilters** on ADF.
- **Retire the staff SPA** (`dev/october-platform`): remove the dashboard
  "Platform" link (`platform_url`) and CORS origin (`platform_origins`), redirect
  the domain, archive (do not delete), after confirming nothing one-of-a-kind is
  lost. **Do not touch `dev/platform` (OMI).**
- **Retire Check & Log Email**: add the global `wp_mail` capture + an "Email log"
  admin screen (browse / search / resend) on the existing `Mail/EmailLog.php`
  engine; keep retention/prune and access control on.

Done when: ADF and the tours run on the plugin natively, no Crocoblock stack, and
the two retirements are complete. **This is "working for ADF."**

---

## M5 — Refine (the iron-out-the-detail pass)

Across a live cycle, in any order as issues surface:

- **Track A cheap wins** (if not already shipped in parallel): comp flag +
  reporting exclusion, end-of-event report, customer account dashboard, the rest
  of the [`POST-FESTIVAL-ROADMAP.md`](POST-FESTIVAL-ROADMAP.md) queue.
- **People hub / CRM**: unify volunteer + customer + contacts profiles, per
  entity (never merged across festival ↔ tours).
- **Dashboard access control**: section-level capabilities (`oe_tickets`,
  `oe_volunteers`, …) + a "User access" admin screen, so directors/leads see only
  their part. Same capability system the crew roles need
  ([`CREW-MODULE.md`](CREW-MODULE.md)). Open: presets vs per-user.
- **Settings in context**: a collapsible "Settings" accordion at the top of each
  admin page showing only that page's settings; truly global settings stay on the
  Settings page.
- **QR / scanner backlog**: batch/group check-in and the native `BarcodeDetector`
  speed-up are device-dependent and previously broke the camera (1.199.4) — build
  and test on a real phone before shipping.

Done when: the reference tenant has run a full cycle on the native stack with the
rough edges filed off. This is the gate to opening the parked
[`SCOPE-GAPS.md`](SCOPE-GAPS.md) sell-to-others project.

---

## M6 — Messaging completeness

Approved (owner: "emails/sms — yes add"). The transactional email/SMS lifecycle
was audited against the code: ~28 messages exist (order confirmations, volunteer
flow, submission approve/reject, password/account, membership basics). These are
the gaps to fill. All route through the existing engine
(`OE\Mail\Transactional::send()` → `wp_mail()` → `OE\Mail\Mailer`, SES → Brevo →
default; SMS via `Transactional::send_sms()` → `OE\Connectors\Sms`), so this is
wiring templates and triggers, not new infrastructure.

- **Paid-order receipt + PDF invoice.** Emailed receipt on every paid order, with
  the invoice PDF attached (invoice engine exists; wire it to the confirmation).
- **Failed-payment / dunning.** Minimal for tickets (one retry nudge on a failed
  attempt); full sequence for membership renewals.
- **Membership lifecycle.** Welcome, renewal reminder, renewed, payment-failed,
  lapsed/cancelled — the full set, not just the basics present today.
- **De-festival the membership tiers (generalisation).** The membership engine is
  already tenant-agnostic (`membership_enabled`, `membership_price_ids`,
  `membership_join_*`, per-ticket `members_only`, and now a configurable
  `membership_pitch`), so both offer modes work for any client: join → free
  ticket (a £0 `members_only` tier) and join → member rate (a `members_only` tier
  beside the public one). The one remaining ADF-specific piece is the **Friends /
  Patrons** tier naming baked into settings keys (`friends_price_ids`,
  `patrons_price_ids`) and shortcodes (`[oe_friends_list]`, `[oe_patrons_list]`),
  which are the public supporter lists. Generalise these into **client-named
  membership tiers**: keep Friends/Patrons as the ADF defaults, add back-compat
  aliases on the old keys and shortcodes, and expose a generic
  `[oe_members_list tier="…"]`. Touches public shortcodes, so it needs the
  back-compat shims — do it here, not as a rushed patch.
- **Ticket-transfer notice** to the original holder when an order is transferred.
- **Event rescheduled / cancelled** auto-notice to ticket holders, behind a
  confirm step ("notify N holders?") so it never fires silently.
- **Waitlist offer.** Personalised, time-limited "a spot opened" offer, and fix
  the `waitlist_spot` message shipping with **no subject line** (live bug).
- **Admin-removed volunteer shift** notice to the volunteer when a shift they
  signed up for is pulled.
- **Crew / staff provisioning** emails (agreement, login, role email, renewal /
  offboarding) — tracked in [`CREW-MODULE.md`](CREW-MODULE.md), listed here for
  completeness.
- **Configurable double opt-in** on list sign-up.
- **GDPR confirmations.** Data-export-ready and erasure-complete emails, wired to
  the WP privacy hooks (pairs with the GDPR work in UI-SPEC §6).
- **Monthly digest.** Finish and enable it (`Cron::DIGEST_ENABLED` is `false`
  today).
- **SMS beyond volunteers.** Extend SMS to order/waitlist events, gated on an
  explicit checkout opt-in.

Done when: every money, membership, transfer, schedule-change, waitlist and
privacy event has a message, the `waitlist_spot` subject bug is fixed, and SMS is
opt-in beyond the volunteer flow.

---

## M7 — Reporting & insight

Approved as a phase (owner: end-of-event report / demographics / survey /
volunteer pool "sound like they are worth adding in to a phase"). Reads the data
the plugin already owns; no new capture beyond the survey and consented
demographics.

- **End-of-event report.** One page per event: tickets sold vs comp, revenue net
  of fees and refunds, check-in rate, channel/promo breakdown, waitlist
  conversion. Also in the Track A queue; this is its home.
- **Demographics.** Aggregate, consent-gated, from CRM fields — never per-person
  without consent.
- **Post-event survey.** The per-location survey toggle already on the tour
  location editor, generalised to any listing, with results feeding the report.
- **Volunteer pool.** A reusable pool across cycles (retention, no-show history,
  allocation), building on the volunteer profiles and the no-show/abuse flag.

Done when: an organiser can read a single post-event report, send a survey, and
work from a persistent volunteer pool rather than re-recruiting each cycle.

---

## Parallel tracks (not gating ADF native)

- **F — Self-serve forms** (de-Jet Phase F): organizer signup + create/edit-own-event
  with a server-side ownership guard, approval-gated publish. The logged-in submit
  slice already ships (`[oe_submit_event]`, v1.188.0). The edit-own-event guard is
  small and useful to ADF organizers; full public signup leans Track B.
  - **Editable partner packages** (new entity; backbone of the organizer portal).
    **Entity + admin CRUD + comparison matrix shipped (v1.205.0).** `oe_package`
    CPT (title = name, body = description) surfaced under October Events →
    Packages, behind a `packages` feature toggle. `OE\Packages\Package` holds the
    commercial fields in `_oe_pkg_*` meta: **price, +VAT flag, display order;
    entitlements (unlock_count + gated sections); tier type (standard vs
    subsidised — Charities / Launch Pad / managed-free-with-handling-fee, with a
    handling_fee); availability (stock, open/close dates, visible flag); Stripe
    price link; buy-more ceiling (max_qty); highlight flag.** `OE\Packages\Metabox`
    is the editor; `[oe_packages]` (`OE\Packages\Matrix`) renders the comparison
    matrix — native-not-embed, on-sale/dated/stock-aware, honours +VAT and
    subsidised free/handling-fee pricing. Orders carry a new nullable
    `package_id` column (db v23) so paid-package stock maths reuses the ticketing
    orders table. **Ties into the entitlement / gating primitive** (the
    `entitlement_tier` stub added in M0): paying for a package unlocks the
    activities its `unlock_count` names, so packages and gating share one
    mechanism.
    **Remaining:** the multi-step purchase wizard (Stripe checkout against each
    package's `stripe_price`, writing `package_id` on the order) and enforcement
    of the unlocked entitlements. The matrix CTA points at the
    `packages_wizard_page` setting today. Off the ADF-native critical path; the
    wizard lands with the organizer portal.
- **G — Ads module** (de-Jet Phase G): fold `oc-ad-manager` in as a toggleable
  `ads` module, preserve the hub/partner syndication feed and `[oc_ad]`
  back-compat, then retire the standalone plugin. Independent; the integration
  flavor (conversions / audiences / wire-in) is still an owner decision in the
  brief.

---

## Explicitly out of this build

Parked in [`SCOPE-GAPS.md`](SCOPE-GAPS.md), started only after M5: the generalized
any-tenant migrator, entitlement enforcement + licensing server, ticketing
hardening (refunds / tax / receipts), the branding override contract, the
provisioning runbook, billing the client, backups / SLA, email deliverability
infra, AI cost metering, and update governance.
