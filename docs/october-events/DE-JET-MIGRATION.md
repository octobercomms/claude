# De-Jet migration: making the plugin self-contained

Status: scoping (build spec). Owner: Daniel. Plugin: `dev/october-events`.
This is engineering priority one from `GO-TO-MARKET.md`. It builds on the
flag-hardening and ads-merge already scoped in `HOPE-SALONS-SCOPE.md`.

## Headline

The plugin (v1.154.0, `OE\` namespace) is far more self-contained than the
"hybrid front end" framing in the README suggests. The entire transactional core
needs **zero** Jet/Crocoblock or Elementor at runtime. The de-Jet job is bounded:
CPT ownership, event-field entry, public templates, filtering, Elementor
exposure, self-serve forms, and folding in ads. It is a refactor, not a rewrite.

## The one blocker to "install and it works"

On a plain WordPress install today there is **no way to enter an event's date,
price or location.** That data currently rides on JetEngine meta, read via
`Settings::event_field_map` / convention keys; the read path (`Planning\Events`)
exists but nothing writes it on a fresh install. So a new install cannot hold a
usable event until an event-details metabox is built. This is the first thing to
build. (Volunteer shifts already have their own metabox, so volunteers are fine.)

## Already self-contained (do not rebuild)

Plugin-owned, no Jet/Elementor needed: checkout (Stripe + PayPal, BNPL, door,
promo, waitlist, cart-abandonment), relational ticketing, the check-in PWA, the
account dashboard shell + REST, the submission engine, volunteers (opportunities,
shifts, reminders, self-serve cancel), the email platform (SES + Brevo), AI
Stories and assistant, Guided Tours, membership, the tasks board, the GitHub
self-updater, and the ticket-migration CLI.

## Runtime dependencies to replace

| # | Where | What it assumes | Severity |
|---|---|---|---|
| R1 | `includes/PostTypes.php` (`events`/`volunteer` flagged `external`) | JetEngine registers the CPTs; the plain-WP fallback registers them only minimally (no proper labels/taxonomies/event UI) | High |
| R2 | `includes/Planning/Events.php` + `admin/TicketsAdmin.php` | No metabox/form writes the `_oe_plan_*` event fields; on plain WP there is no way to enter date/price/location | High |
| R3 | `MapsConnector.php`, `Plugin.php` public routes, README "decision 2" | Public listings, single event, destinations map, board and filters are built in Elementor + JetEngine; only `[oe_design_map]` ships dependency-free | High |
| R4 | `SELF-SERVE-PLATFORM-2027.md` §8 (planned) | Organiser signup via Profile Builder, create/edit via JetFormBuilder, board/filters via JetSmartFilters; current `/submit` form is generic and has no edit-own-event flow | High (blocks the self-serve tier) |

Optional adoption/back-compat code (field-map, convention keys, ICS date parsing,
CORS guard, the fully-booked JetEngine mirror) is harmless without Jet and stays,
guarded behind adoption mode. No `Requires Plugins` header hard-blocks anything
today; the dependencies are behavioural, not declared.

## Adoption mode keeps live sites safe

ADF, Architecture Tours and Hope Salons all use JetEngine CPTs + Elementor and
store event data in JetEngine meta. A persistent **adoption mode** (auto-detected
from JetEngine / `post_type_exists('events')`) keeps them untouched:

- Never re-register `events`/`volunteer` while JetEngine is active; if ever
  registering, keep the identical slug and rewrite (`/e/`, `/v/`) so permalinks
  and Elementor templates do not move.
- In adoption mode, JetEngine meta stays the source of truth; the new metabox is
  additive and does not overwrite it.
- Default public templates ship **on** only for self-contained installs; never
  hijack `template_include` when a theme/Elementor is already rendering.
- Elementor widgets load only when Elementor is present and never require
  JetEngine, so they are safe on both.
- Migrators are opt-in, dry-runnable and idempotent.

Net: a fresh "basic WordPress + October Events" install is fully self-contained;
existing Jet sites are untouched until an admin opts in and runs the migrators.

## Phases

| Phase | Work | Size |
|---|---|---|
| 0 | Feature-flag hardening (`Features.php`, `Plugin.php::init` early-returns) + an explicit `adoption_mode` setting. Prerequisite | M |
| A | Own CPT registration for `events`/`volunteer` (mode-aware; reuse `register_owned()`), plus `wp oe migrate-cpts` meta copier (JetEngine keys → `_oe_plan_*`) | L |
| B | **Event-details metabox** writing `_oe_plan_*` (name/start/end/price/location/organiser/description); make `_oe_plan_*` the source of truth in self-contained mode | M |
| C | Default front-end templates (blocks + shortcodes) for listings/archive, single event, board, map (reuse `[oe_design_map]`), volunteer listing, so a fresh install looks good with zero design | L |
| D | Own filtering/facets over the listing REST endpoints, replacing JetSmartFilters | M |
| E | Elementor-compatible widgets + dynamic tags exposing plugin data, loaded only when Elementor is active, so bespoke design needs only Elementor (no JetEngine) | L |
| F | Own self-serve forms replacing JetFormBuilder + Profile Builder (organiser signup, create/edit-own-event with a server-side ownership guard, approval-gated publish) | L |
| G | Fold `oc-ad-manager` in as a toggleable `ads` module, preserving the hub/partner syndication feed and `[oc_ad]` back-compat; migrate then retire the standalone plugin | L |

Recommended order: **0 → A → B** (a new install can hold and edit events at all)
→ **C → D** (looks good with zero design) → **E** (bespoke Elementor without Jet)
→ **F** (self-serve tier) → **G** (independent track, can run in parallel).

## Recommended first build

Phase 0 (flag + `adoption_mode`) then Phase B (the event-details metabox). Phase B
is additive and safe on live sites, and it is the literal blocker to "install and
enter an event". Phase A follows, carrying the highest data-migration risk (CPT
slug/permalinks on live sites), so it is done carefully behind adoption mode.

## Critical files

- `includes/PostTypes.php`, `includes/Planning/Events.php`, `includes/Plugin.php`
- `includes/RestApi.php`, `frontend/Dashboard.php` (+ `frontend/templates/dashboard.php`)
- `includes/Features.php`, `includes/Settings.php`, `includes/Connectors/MapsConnector.php`, `admin/TicketsAdmin.php`
- `dev/oc-ad-manager/` (whole plugin, for Phase G)
