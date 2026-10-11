# October Events — master brief

The single front door for the October Events plugin. One place that ties every
workstream together, across the **festival operations** track and the **SaaS
productization** track, with status, the documentation map, and consolidated
open decisions. Committed to the repo so any session sees the same picture.

Current shipped plugin version: **1.201.1**.

---

## The frame

Two tracks, one codebase. Do **not** fork a separate SaaS plugin.

- **Track A — festival operations** (reference tenant: Atlanta Design Festival and
  its tours). Run this year's festival well. Tactical, cheap, high near-term ROI.
  Detail in [`POST-FESTIVAL-ROADMAP.md`](POST-FESTIVAL-ROADMAP.md).
- **Track B — SaaS productization.** Make October Events work for *other*
  organizers, self-serve. Strategic, bigger lift. Detail in
  [`SELF-SERVE-PLATFORM-2027.md`](SELF-SERVE-PLATFORM-2027.md),
  [`PRODUCTISATION-PLAN.md`](PRODUCTISATION-PLAN.md) and
  [`GO-TO-MARKET.md`](GO-TO-MARKET.md).

**Productize in place.** The festival is the first (reference) tenant. Build new
features **tenant-aware** so multi-tenancy isn't a retrofit later. Each tenant's /
entity's data stays self-contained, which is both the sale-readiness rule and the
multi-tenant rule (operating rules in [`HOPE-SALONS-SCOPE.md`](HOPE-SALONS-SCOPE.md)).

**Generalize.** Product and feature specs read for any festival; the reference
tenant appears only as an example, never baked in as the product. US English
throughout.

**Sequencing discipline.** Don't let productization stall festival ROI. Finish the
high-value Track A fixes (most are cheap, several already shipped), run Track B in
parallel.

---

## Documentation map

Read this brief first, then the canonical doc for the topic you're working on.

**Start here / as-built**
- [`README.md`](README.md) — what the plugin is and how it's built, installed, released.
- [`SYSTEM-WALKTHROUGH.md`](SYSTEM-WALKTHROUGH.md) — page-by-page map of every surface.
- [`GETTING-STARTED.md`](GETTING-STARTED.md) — team onboarding / how-to.

**Track A — festival operations**
- [`POST-FESTIVAL-ROADMAP.md`](POST-FESTIVAL-ROADMAP.md) — the Track A build queue (+ [`volunteer-pool.md`](volunteer-pool.md)).
- [`HOST-COMMS-SPEC.md`](HOST-COMMS-SPEC.md) — host contacts and info-pack comms.
- [`GUIDED-TOURS.md`](GUIDED-TOURS.md) — multi-location (tour) booking setup.
- [`POST-EVENT-SURVEY-SPEC.md`](POST-EVENT-SURVEY-SPEC.md) — post-event survey (+ [`SURVEY-EMAIL-BEST-PRACTICES.md`](SURVEY-EMAIL-BEST-PRACTICES.md)).
- [`TICKETING-PARITY.md`](TICKETING-PARITY.md) — completed `oct_`→`oe_` migration record.

**Multi-tenant / engineering direction**
- [`HOPE-SALONS-SCOPE.md`](HOPE-SALONS-SCOPE.md) — one codebase, many tenants: the operating rulebook + flag-hardening.
- [`DE-JET-MIGRATION.md`](DE-JET-MIGRATION.md) — make the plugin self-contained (no Jet/Crocoblock). **Engineering priority one.**
- [`CREW-MODULE.md`](CREW-MODULE.md) — people, team tiers, roles and access (the single home for the role/capability model).
- [`EVENT-MODEL.md`](EVENT-MODEL.md) — **the canonical data model: one event + capability packs (tickets, tour, conference, exhibition …), listings/filters, embeds, migration.**
- [`TOURS-RATIONALIZATION.md`](TOURS-RATIONALIZATION.md) — detail for the **tour** pack: the tours↔festival integration map and cross-site embeds.

**Track B — productization**
- [`SELF-SERVE-PLATFORM-2027.md`](SELF-SERVE-PLATFORM-2027.md) — the self-serve organizer feature spec.
- [`PRODUCTISATION-PLAN.md`](PRODUCTISATION-PLAN.md) + [`GO-TO-MARKET.md`](GO-TO-MARKET.md) — the earn model, pricing, positioning. **Merge into one Track B GTM doc is pending.**
- [`PLATFORM-ARCHITECTURE.md`](PLATFORM-ARCHITECTURE.md) — **PARKED.** A standalone non-WordPress multi-tenant app + OMI merge; conflicts with productize-in-place. Reference only, not an active plan.

**Security**
- [`security-audit.md`](security-audit.md) — security / performance audit record.

**Archive (history, do not treat as current)**
- [`archive/BRIEF.md`](archive/BRIEF.md) — original build brief (superseded by README).
- [`archive/EMAIL-PLATFORM.md`](archive/EMAIL-PLATFORM.md) — the 2026 SES/messaging proposal; core now shipped (see Messaging stack below).
- [`CHANGELOG.md`](CHANGELOG.md) — as-built change record.

---

## Track A — festival operations

Full detail and ordering in [`POST-FESTIVAL-ROADMAP.md`](POST-FESTIVAL-ROADMAP.md).

### Shipped post-festival
- Invoices / receipts for ticket orders + print fix (1.200.0 / 1.200.1)
- Volunteer profiles + manual no-show/abuse flag (1.201.0)
- Volunteer profiles "name flagged before" watch (1.201.1)

### Ready to build (no blockers)
- Volunteer **comp flag + reporting exclusion** (fixes skewed sales numbers) — §1
- **End-of-event report** (single + multi-event PDF) — §5
- **Customer account dashboard** (own events + invoice downloads) — §11 A
- **CRM "People hub"** (unify volunteer + customer profiles, per entity)

### Scoped, waiting on a dependency or decision
- Volunteer ticket lifecycle (auto-issue 2 QRs + 48h reminder) — §2
- Scanner blue "volunteer" state + thank-you — §3
- Shift check-in + cancel/no-show void (lead-confirmed) — §4
- Locations map email (groups, addresses, Letter/A4) — §6
- Guided tour comms (instructions+map on booking; 24h close + host list) — §7
- Tickets dashboard UX (one page + REST refresh) — §8
- Volunteer pool / location allocation — §9 (see [`volunteer-pool.md`](volunteer-pool.md))
- No-show abuse cross-check (no-show × ticket-scanned) — §10b
- Repeat-offender card gate on re-signup — §10c
- Post-checkout demographics modal — §11 B
- Demographics & audience dashboard — §11 C
- Cross-site profiles **within an entity** — §11 D

### Copy owed (not code)
- T&C clause for volunteer no-show liability
- Repeat-offender "card on file" email copy

### Backlog / held
- Batch / group check-in (multi-code scan) — device-dependent, build and test on a real phone
- Instant-scan speed-up (native `BarcodeDetector`) — **this broke the camera in 1.199.4; re-approach carefully and device-test before shipping**
- Volunteer chat / community (per-tour, daily digest) — held
- Volunteer move parts 2 & 3 (self-service change link; rebalancing broadcast)

---

## Track B — SaaS productization

Full detail in [`SELF-SERVE-PLATFORM-2027.md`](SELF-SERVE-PLATFORM-2027.md).
Built natively in the plugin (not Crocoblock), reusing the existing
`Submission` / `Account` / approval-queue engine. The near-term earn model
(managed WordPress install per client, client's own Stripe, pricing, legal) is in
[`PRODUCTISATION-PLAN.md`](PRODUCTISATION-PLAN.md) / [`GO-TO-MARKET.md`](GO-TO-MARKET.md).

### Self-serve event management
- **Shipped — Slice 1 (v1.188.0):** logged-in submit form `[oe_submit_event]`.
  An organizer posts an event → runs through `Submission::create()` → lands as a
  **draft in the approval queue**; nothing publishes without review.
- **Not built (sequenced):**
  1. Public organizer **signup** with the `pending` user model + anti-abuse (§3)
  2. "Approve the user once → auto-publish" **trust loop** + edit-own-events with
     the server-side ownership guard (§9)
  3. **Image quality gate** (§4a)
  4. **Registration tiers** (three models, chosen per event) (§5)
  5. **Add-ons / upsell** (§6 — see below)
  6. Paid **"Connect"** selling (application fee) (§3 paid)

### Add-ons / upsell (§6 of the self-serve spec)
Newsletter slots, featured listing, boost, and the application fee on paid
selling. **Not built.** Blocked on owner decisions:
- Real **prices** ($ per newsletter slot, featured, boost, managed-free handling
  fee, paid-selling application fee %).
- **Managed-free handling fee shape**: flat per-event (recommended) vs per-registration.
- Edit-after-publish: does changing date/price re-trigger review? (Rec: no.)

### Multi-tenancy (the productization backbone, to formalize)
Making it work for others needs: per-tenant config/branding, tenant data
isolation (same rule as the entity split), organizer roles/permissions (overlaps
the dashboard-access work below), billing, and support. Operating rules live in
[`HOPE-SALONS-SCOPE.md`](HOPE-SALONS-SCOPE.md); the self-contained-plugin
foundation is [`DE-JET-MIGRATION.md`](DE-JET-MIGRATION.md).

---

## CRM / audience

The CRM is emerging natively, not a separate purchase:
- Volunteer profiles (shipped), customer profiles (§11, scoped), and the existing
  Contacts surface unify into a **People hub**. Roles/access model owned by
  [`CREW-MODULE.md`](CREW-MODULE.md).
- **Entity boundary (decided):** CRM is **per entity**, never merged across
  festival ↔ tours (sale-readiness + consent). Within an entity, sites may
  federate. See [`POST-FESTIVAL-ROADMAP.md`](POST-FESTIVAL-ROADMAP.md) §11.
- Compliance: **GDPR as the global baseline**; honest/optional/skippable survey;
  pre-fill gated on authentication, not payment.

---

## Messaging stack

Email is **built in the plugin on Amazon SES** with native contacts, campaigns
and a Claude co-pilot (see README / SYSTEM-WALKTHROUGH). The original proposal is
archived at [`archive/EMAIL-PLATFORM.md`](archive/EMAIL-PLATFORM.md). Still
**unbuilt** from that proposal, carried here so nothing is lost:
- **Live chat** — self-hosted **Chatwoot**, widget injected by a plugin setting
  (hosted on the tenant's own infrastructure, never in the plugin).
- **Dedicated sending subdomains** (e.g. `news.` marketing, `mail.` transactional)
  with DKIM/SPF/DMARC, warm-up, and a per-stream from-name/from-address.

---

## Ad manager integration (TO BE SCOPED)

Not captured in any events doc yet. The only ad assets in the repo are the
separate apps `dev/meta-ads` and `dev/oc-ad-manager`, which are not part of
October Events. Needs scoping from scratch; likely one of:
1. **Conversions** — push ticket-sale events to Meta/Google (pixel + Conversions
   API) so ad spend optimizes against real purchases.
2. **Audiences** — export CRM segments for retargeting and lookalikes.
3. **Wire in** the existing `oc-ad-manager` / `meta-ads` app to events data.

The new customer profiles make 1 and 2 natural next steps. Pick the flavor and it
gets its own spec.

---

## Infrastructure & architecture decisions (DECIDED)

- **Festival and tours become separate legal entities**, and the tours may be
  **sold**. Sale-readiness governs everything: each entity's data self-contained
  and transferable. (This is a business/legal split; it is independent of the
  product data model — see the proposed tours/events unification below.)
- **Nextcloud** chosen for team PM + planning notes (Deck kanban, calendar, video
  via Talk, mail client). **One instance per entity.** This is team/ops
  infrastructure, **not** a plugin feature. It **cannot be bundled** in a
  WordPress plugin (separate server app, own stack/DB/hosting). Offer it as a
  **managed-service add-on** for managed clients and a recommended/optional tool
  for self-serve customers; **never a product dependency**. A light connector
  (plugin → the tenant's Nextcloud via its API) is possible later if demand
  appears. The reference tenant uses Nextcloud (it may live on the repurposed
  `platform.` subdomain, since it covers more than PM); two logins is the accepted
  tradeoff, SSO a later nicety.
- **CRM, ticketing, invoices, books, email**: separate per entity. No merged
  cross-entity store.
- **Retire the festival staff SPA** (`dev/october-platform`, served at
  `platform.atlantadesignfestival.net`): the plugin's own admin now does the job,
  so the separate front end is duplicated work. See housekeeping.
- **Keep OMI** (`dev/platform`): it is a **separate, live product** with its own
  users, deploy and biz-dev pipeline (`../../CLAUDE.md`, `docs/omi/agent-guide.md`).
  OMI is **not** being retired and is **not** merged into the plugin.

---

## Housekeeping

- **Retire the staff SPA** (`dev/october-platform`): check for anything only it
  does; in the plugin remove the dashboard **"Platform" link** (`platform_url`)
  and the **CORS origin** (`platform_origins`); redirect the domain; **archive**
  `dev/october-platform` (don't delete). Confirm nothing one-of-a-kind is lost
  first. **Do not touch `dev/platform` (OMI).**
- **Per-user dashboard access** (owned by [`CREW-MODULE.md`](CREW-MODULE.md)):
  today every plugin admin page is gated on `manage_options` (all-or-nothing,
  `includes/Access.php` stub). Build **section-level capabilities** (`oe_tickets`,
  `oe_volunteers`, …) + an admin "User access" screen so people see only their
  part of the menu (and can't reach hidden pages by URL). This is the same
  capability system the crew/SaaS-organizer roles need. Open: presets (Director /
  Lead / Door crew) vs per-user.
- **Settings in context (UX)** — move each page's settings onto that page: a
  collapsible **"Settings" accordion at the top of every admin screen** showing
  only that page's settings; truly **global** settings stay on the Settings page.
  Tenant-agnostic; improves every install. Backlog.
- **Email log (retire Check & Log Email)** — the logging engine already exists
  (`Mail/EmailLog.php`: table + record/recent/counts/prune) and logs the plugin's
  own sends. To retire the Check & Log Email plugin, add a **global `wp_mail`
  capture** (all site mail, not just the plugin's) and an admin **"Email log"**
  screen (browse/search/resend). PII: keep retention/prune on and access-control
  the screen.

---

## Consolidated open decisions

**Track A**
- Map: one auto-fit map vs per-day; lead time fixed 7 days vs per-event (§6)
- Customer profile field set (avoid special-category data) (§11)
- Volunteer reminder channel: email only vs email + SMS
- Volunteer pool open questions (see [`volunteer-pool.md`](volunteer-pool.md))

**Track B**
- Add-on prices + managed-free handling fee shape + edit-after-publish (§11 of the self-serve spec)
- Three named prospect festivals (the standing validation gap)

**Product model (DECIDED: universal event + capability packs; see [`EVENT-MODEL.md`](EVENT-MODEL.md))**
- **One `event` CPT + capability packs you switch on per event** (tickets, tour /
  multi-location, conference, exhibition, …). No separate CPT per type; "tour" is
  a pack, not a special thing. Build the framework + the built packs (tickets,
  tour) + native filtering with de-Jet Phases A–D; conference/exhibition packs
  are later, when a real event needs them (their field sets are owner input).
- **Native listings / filters / archives** (replace JetSmartFilters): filter by
  category/type/year/city/past|upcoming; a filterable past archive; scoped
  placements (a city tour page shows only that city's current-year locations).
  Each is a shortcode/block dropped into an Elementor page, and the same engine
  feeds cross-site embeds.
- **Migration:** ~200 past events + ~80 tour locations (and later conference/
  exhibition content) from the JetEngine CPTs into the plugin model; idempotent,
  dry-runnable, opt-in (de-Jet Phase A).
- **Separate tours onto their own site** (independent of the legal entity split):
  the code already assumes this; the one blocker is the ticket gate reading the
  **local** orders/tickets tables. Decide: the tours site **sells its own
  tickets**, or **federate eligibility** to the selling site (shared-token REST,
  the `volunteer-check` pattern). On separation, drop the tours↔festival
  **volunteer partner-feed** link but **keep the `oc-ad-manager` cross-site ad
  syndication** (separate feed, wanted for connecting multiple sites to host ads).
- **Cross-site embeds:** generalize the existing volunteer partner-feed into
  scoped public read endpoints (`oe/v1/embed/{volunteers|events|tours}`) + a
  loader (iframe for booking, JS/HTML for listings). Serves both the tours↔festival
  split and the SaaS "put it on your own site" story. CORS is already handled
  (`Cors.php`).

**Housekeeping / infra**
- Confirm staff-SPA retire (and that OMI stays)
- Dashboard access: presets vs per-user, and who sees what
- Ad manager integration: which flavor (conversions / audiences / wire-in)
- Nextcloud hosting: managed (per entity) vs VPS; confirm the entity split applies stack-wide
- Settings-in-context accordion: confirm the pattern

**Docs tidy-up (in progress)**
- Merge `PRODUCTISATION-PLAN.md` + `GO-TO-MARKET.md` into one Track B GTM doc
- Generalize `SELF-SERVE-PLATFORM-2027.md` prose (board/brand/opt-in copy → generic)

---

## Recommended next moves

1. **Ship the cheap festival wins**: comp flag + reporting exclusion, then the
   end-of-event report. Immediate value, no blockers.
2. **De-Jet Phase 0 + event-details metabox** ([`DE-JET-MIGRATION.md`](DE-JET-MIGRATION.md)):
   the tenant-aware, self-contained foundation; engineering priority one.
3. **People hub + customer account dashboard** (Phase A): turns the profiles work
   into a real CRM with zero compliance exposure.
4. **Staff-SPA retire** cleanup (quick) once confirmed.
5. **Dashboard access control**: unblocks letting directors/leads in safely, and
   doubles as groundwork for SaaS organizer roles.
6. Run **Track B** (self-serve signup → trust loop → add-ons) as the parallel
   strategic build, each piece tenant-aware.
7. Draft the **T&C clause + repeat-offender email**, and **scope ad-manager** once
   the flavor is chosen.
