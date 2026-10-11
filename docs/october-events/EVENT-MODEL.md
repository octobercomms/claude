# Event model: one event, capability packs

Status: DECIDED (direction) / scoping (per-pack detail). Owner: Daniel.
Plugin: `dev/october-events`. This is the canonical data model the whole plugin
builds toward. It supersedes any "tour is a separate type" framing;
[`TOURS-RATIONALIZATION.md`](TOURS-RATIONALIZATION.md) becomes the detail for the
**tour** pack below.

## Principle

**One `event` CPT. Base fields for every event. Everything else is a capability
pack you switch on per event.** A pack reveals extra fields, functions, admin UI,
and public output. There is no separate CPT per event type; new types are new
packs, added without touching the core. This is the "advanced switcher": one
Event, versions of it.

Generalizes the product well beyond festivals (conferences, exhibitions, trade
shows are larger markets) while keeping one model, one UI/UX/language, one
migration path.

## Base event

Plugin-owned `event` CPT (de-Jet Phase A). Base fields (from
`Planning\Events::FIELDS`): name, start/end datetime, start/end time, price (text),
location, description, organizer, `ticket_required`, internal notes. Plus the
listing/archive/filter surfaces (below). Everything beyond this is a pack.

## Capability packs

Each pack = a per-event toggle → fields (metabox) + behavior + public output +
embed support. Registered in a **capability registry** so adding a pack never adds
a CPT.

| Pack (switch) | Adds | Status |
|---|---|---|
| **Tickets** | Ticket types, checkout (Stripe/PayPal), promo, waitlist, QR check-in. Not all events sell tickets, so this is a switch | **Built** |
| **Tour / multi-location** | One-or-more locations, per-location timed-slot gated booking (the "pass" model), name-on-list arrival vs QR (`check_in_mode`), 48h reconfirm, release schedule | **Built** (`GuidedTours`; see `TOURS-RATIONALIZATION.md`) |
| **Conference** | Speakers, past speakers, sessions/agenda, accommodation | **Not built** (site-side JetEngine today; field set needed — see Open inputs) |
| **Exhibition** | Exhibitors (repeater) | **Not built** (site-side JetEngine today; field set captured — see `FIELD-MAPPING.md`) |
| **Volunteers** | "Needs volunteers" switch → shifts → signups (`oe_volunteer_signups`). Replaces the standalone `volunteer` CPT | **Mostly built** (signups engine exists; move opportunity from CPT to a switch) |
| **Staff / non-shift roles** | Role page + apply-by-email form (lightweight entry to `CREW-MODULE.md`) | **Not built** |
| *(future)* | New event types become new packs | — |

> **Validation:** ADF's live `events` CPT already uses exactly these on/off
> switchers (conference / exhibition / tickets / speakers / sessions /
> accommodation). The native model formalizes what already runs. Confirmed field
> sets and the JetEngine→plugin migration map are in
> [`FIELD-MAPPING.md`](FIELD-MAPPING.md) (source captures in `reference/`).

### Scope discipline
Build the **framework** (capability registry + per-event toggles + base event) and
the packs that already exist (**tickets**, **tour**) as part of de-Jet. Do **not**
speculatively build the conference and exhibition packs; port them when migrating
a real conference/exhibition site or when a client needs them. The framework
accommodates them; each pack earns its build when a real event uses it.

## Listings, filters, archives

Native (replaces JetSmartFilters; there is no filtering in the plugin today). A
listing shortcode/block over the REST, with a filter UI:

- Filter a large set (e.g. 200 events) by **category / type / year / city /
  past|upcoming**.
- A **past-events / past-tours archive**, filterable.
- **Scoped** placements: a city's tour page shows only that city's current-year
  locations, e.g. `[oe_tours city="..." year="current"]`, or the embed endpoint
  with `city` / `year` / `type` / `past|upcoming` params.
- Same engine serves the on-site archive and the cross-site embed.

## Embeds

Each listing/filter is a **shortcode or block dropped into an Elementor page**
wherever the editor wants it (exactly like today's volunteer shortcode) — the page
stays an Elementor page. Cross-site (another festival's own site) is the same
listing over an **iframe** (booking) or **script/JSON** (listings), scoped by the
same params. CORS is already handled (`Cors.php`). See
[`TOURS-RATIONALIZATION.md`](TOURS-RATIONALIZATION.md) §5 for the embed endpoints
to add.

## Migration

Migrate existing content from the JetEngine CPTs into the plugin-owned model
(de-Jet Phase A data migration, extended):

- ~200 past **events** → base event fields (JetEngine meta → `_oe_*`).
- ~80 **tour locations** + their slots → the tour pack.
- Conference/exhibition content → their packs (needs the field sets, below).

Idempotent, dry-runnable, opt-in per site (adoption mode); never re-register or
re-key live JetEngine data without the owner running the migrator. See
`DE-JET-MIGRATION.md`.

## Site separation and cross-site feeds

Tours can run on their own site/entity. When separated:

- **Drop** the tours↔festival **volunteer partner-feed** link (optional/off).
- **Keep** the `oc-ad-manager` **cross-site ad syndication** — a separate feed,
  wanted, for connecting multiple sites to host ads. The generic cross-site
  capability stays; only the volunteer feed between the two sites is cut.

The one coupling to resolve for a clean tours-site split is the ticket gate
reading the local orders/tickets tables: sell tickets on the tours site, or
federate eligibility to the selling site (`volunteer-check` pattern). See
`TOURS-RATIONALIZATION.md`.

## Open inputs / decisions

1. **Conference + exhibition field sets** (from the owner's existing JetEngine
   config): speakers, past speakers, sessions/agenda shape, accommodation, and the
   exhibitor repeater fields. Needed to spec and migrate those packs.
2. **Tours-site ticket gate:** sell-local vs federate eligibility.
3. **Build order within de-Jet:** framework + tickets/tour packs + native
   filtering come with Phases A–D; conference/exhibition packs are later.
