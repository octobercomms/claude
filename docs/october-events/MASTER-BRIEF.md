# October Events — master brief

One place that ties every workstream together, across both the **Atlanta
operations** track and the **SaaS productisation** track, with status and
pointers to the detailed specs. Committed to the repo so any session (this one
or "October Events SaaS") sees the same picture.

Current shipped plugin version: **1.201.1**.

---

## The frame

Two tracks, one codebase. Do **not** fork a separate SaaS plugin.

- **Track A — Atlanta operations.** Run this year's festival (and the tours)
  well. Tactical, cheap, high near-term ROI. Captured in
  [`POST-FESTIVAL-ROADMAP.md`](POST-FESTIVAL-ROADMAP.md).
- **Track B — SaaS productisation.** Make October Events work for *other*
  organisers, self-serve. Strategic, bigger lift. Captured in
  [`SELF-SERVE-PLATFORM-2027.md`](SELF-SERVE-PLATFORM-2027.md) and
  [`PRODUCTISATION-PLAN.md`](PRODUCTISATION-PLAN.md).

**Productise in place.** The festival is the first (reference) tenant. Build new
features **tenant-aware** so multi-tenancy isn't a retrofit later. This aligns
with the entity-split decision (below): each tenant's / entity's data stays
self-contained, which is both the sale-readiness rule and the multi-tenant rule.

**Sequencing discipline.** Don't let productisation stall Atlanta ROI. Finish the
high-value Atlanta fixes (most are cheap, several already shipped), run Track B
in parallel.

---

## Track A — Atlanta operations (festival & tours)

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
- Batch / group check-in (multi-code scan)
- Instant-scan speed-up (native BarcodeDetector; re-approach carefully)
- Volunteer chat / community (per-tour, daily digest) — held
- Volunteer move parts 2 & 3 (self-service change link; rebalancing broadcast)

---

## Track B — SaaS productisation

Full detail in [`SELF-SERVE-PLATFORM-2027.md`](SELF-SERVE-PLATFORM-2027.md).
Built natively in the plugin (not Crocoblock), reusing the existing
`Submission` / `Account` / approval-queue engine.

### Self-serve event management
- **Shipped — Slice 1 (v1.188.0):** logged-in submit form `[oe_submit_event]`.
  An organiser posts an event → runs through `Submission::create()` → lands as a
  **draft in the approval queue**; nothing publishes without review.
- **Not built (sequenced):**
  1. Public organiser **signup** with the `pending` user model + anti-abuse (§3)
  2. "Approve the user once → auto-publish" **trust loop** + edit-own-events with
     the server-side ownership guard (§9)
  3. **Image quality gate** (§4a)
  4. **Registration tiers** (three models, chosen per event) (§5)
  5. **Add-ons / upsell** (§6 — see below)
  6. Paid **"Connect"** selling (application fee) (§3 paid)

### Add-ons / upsell (§6 of the self-serve spec)
Newsletter slots, featured listing, boost, and the application fee on paid
selling. **Not built.** Blocked on decisions that are the owner's:
- Real **prices** ($ per newsletter slot, featured, boost, managed-free handling
  fee, paid-selling application fee %).
- **Managed-free handling fee shape**: flat per-event (recommended) vs
  per-registration.
- Edit-after-publish: does changing date/price re-trigger review? (Rec: no.)

### Multi-tenancy (the productisation backbone, to formalise)
Making it work for others needs: per-tenant config/branding, tenant data
isolation (same rule as the entity split), organiser roles/permissions (overlaps
the per-user dashboard-access work below), billing, and support. Not yet a
written spec of its own; the entity-split principle is the foundation.

---

## CRM / audience

The CRM is emerging natively, not a separate purchase:
- Volunteer profiles (shipped), customer profiles (§11, scoped), and the existing
  Contacts surface unify into a **People hub**.
- **Entity boundary (decided):** CRM is **per entity**, never merged across
  festival ↔ tours (sale-readiness + consent). Within an entity, sites may
  federate. See [`POST-FESTIVAL-ROADMAP.md`](POST-FESTIVAL-ROADMAP.md) §11.
- Compliance: **GDPR as the global baseline**; honest/optional/skippable survey;
  pre-fill gated on authentication, not payment.

---

## Ad manager integration (TO BE SCOPED)

Not captured in any events doc yet. The only ad assets in the repo are the
separate apps `dev/meta-ads` and `dev/oc-ad-manager`, which are not part of
October Events. Needs scoping from scratch; likely one of:
1. **Conversions** — push ticket-sale events to Meta/Google (pixel + Conversions
   API) so ad spend optimises against real purchases.
2. **Audiences** — export CRM segments for retargeting and lookalikes.
3. **Wire in** the existing `oc-ad-manager` / `meta-ads` app to events data.

The new customer profiles make 1 and 2 natural next steps. Pick the flavour and
it gets its own spec.

---

## Infrastructure & architecture decisions (DECIDED)

- **Festival and tours become separate legal entities**, and the tours may be
  **sold**. Sale-readiness governs everything: each entity's data
  self-contained and transferable.
- **Nextcloud** chosen for team PM + planning notes (Deck kanban, calendar,
  video via Talk, mail client over existing email). **One instance per entity.**
  Leantime was the lighter PM-only alternative; Nextcloud wins because it also
  covers notes/files/calendar.
- **CRM, ticketing, invoices, books, email**: separate per entity. No merged
  cross-entity store.
- **Retire `platform.atlantadesignfestival.net`** (OMI / `dev/platform`): the
  plugin's own admin now does the job; the separate frontend is duplicated work.
  See housekeeping.

---

## Housekeeping

- **Retire the platform**: check for anything only it does; in the plugin remove
  the dashboard **"Platform" link** (`platform_url`) and the **CORS origin**
  (`platform_origins`); redirect the domain; **archive** `dev/platform` (don't
  delete). Quick plugin-side cleanup once confirmed.
- **Per-user dashboard access**: today every plugin admin page is gated on
  `manage_options` (all-or-nothing). Build **section-level capabilities**
  (`oe_tickets`, `oe_volunteers`, …) + an admin "User access" screen so people
  see only their part of the menu (and can't reach hidden pages by URL).
  Open: presets (Director / Lead / Door crew) vs per-user; who sees what. This
  overlaps the SaaS organiser-roles need.

---

## Consolidated open decisions

**Track A**
- Map: one auto-fit map vs per-day; lead time fixed 7 days vs per-event (§6)
- Customer profile field set (avoid special-category data) (§11)
- Volunteer pool open questions (see `volunteer-pool.md`)

**Track B**
- Add-on prices + managed-free handling fee shape + edit-after-publish (§11 of
  the self-serve spec)

**Housekeeping / infra**
- Confirm platform retire
- Dashboard access: presets vs per-user, and who sees what
- Ad manager integration: which flavour (conversions / audiences / wire-in)
- Nextcloud hosting: managed (per entity) vs VPS; confirm the entity split
  applies stack-wide

---

## Recommended next moves

1. **Ship the cheap Atlanta wins**: comp flag + reporting exclusion, then the
   end-of-event report. Immediate value, no blockers.
2. **People hub + customer account dashboard** (Phase A): turns the profiles
   work into a real CRM with zero compliance exposure.
3. **Platform retire** cleanup (quick) once confirmed.
4. **Dashboard access control**: unblocks letting directors/leads in safely, and
   doubles as groundwork for SaaS organiser roles.
5. Run **Track B** (self-serve signup → trust loop → add-ons) as the parallel
   strategic build, each piece tenant-aware.
6. Draft the **T&C clause + repeat-offender email**, and **scope ad-manager**
   once the flavour is chosen.
