# Admin build + remaining program: build everything

Status: **active build**. Owner: Daniel. Plugin: `dev/october-events`.
Companion to [`UI-SPEC.md`](UI-SPEC.md), [`FRONTEND-BUILD.md`](FRONTEND-BUILD.md),
[`BUILD-PLAN.md`](BUILD-PLAN.md).

This is the complete remaining backlog, written down so nothing is dropped. The
front-end mockup is done (FRONTEND-BUILD A–I). This file tracks the **admin
mockup** (every screen) plus the roadmap items previously parked. Build order is
top to bottom; each item ships as its own PR.

Admin mockup (owner access): https://claude.ai/artifact/VfoBuBFqeiFqWjR8tvxE1o

## How each admin screen is realised

Each October Events screen's content is built to match the mockup inside
wp-admin, scoped under `.oe-admin`, using the mockup's tokens (orange accent,
2px borders, 14px radii, dark feature cards, the shadow/polish layer). Charts are
pure CSS/SVG (bars = flex columns, donut = conic-gradient), no chart library.
WordPress's own admin chrome (top bar, far-left menu) remains; the mockup's
bespoke left rail is the separate platform app, out of this plugin's scope unless
explicitly commissioned.

## Admin screens

| # | Screen | Build | Status |
|---|--------|-------|--------|
| AD1 | Dashboard | Sales-over-time chart + range selector, sales-by-event table, price-paid donut + legend, price mini-stats, heads-up card; keep approval queue + by-listing-type | todo |
| AD2 | Events list | Bespoke list: capability badges, filter chips (all/upcoming/past/type), sold column; settings-in-context | todo |
| AD3 | Event editor | Capability-pack switch UX, section/shortcode reference with copy, live preview panel, structured availability/status, pack field groups reveal | todo |
| AD4 | Tickets | Stat strip, filter-by-event chips, grain toggle (attendees/orders/check-in log), richer table, accordions, settings-in-context | todo |
| AD5 | Accounts | Stat strip + accounts table → unified person record | todo |
| AD6 | Volunteers | Stat strip, grain toggle (opps/signups/profiles), accordions | todo |
| AD7 | Team (new) | Planning-team lifecycle table + governance; the crew module (agreement, login, role email, renewal) | shipped v1.236.0 |
| AD8 | CRM (new) | Group chips, smart-group rule builder, people table, unified person record slide-in | shipped v1.237.0 |
| AD9 | Email | Stat strip, campaigns table, accordions | todo |
| AD10 | Ad Manager | Stat strip + ad-units table over the folded-in ads module | todo |
| AD11 | User access | Role presets + people×capability grid over SectionAccess | todo |
| AD12 | Taxonomies & filters (new) | Attach taxonomy to listing type, terms with colours, show-as-filter flag; drives `[oe_listings]` facets | todo |
| AD13 | Import / export (new) | Export any entity (CSV/JSON); CSV import with saved mapping templates, dry-run, dedupe-on-key; JetEngine migrator as one template | todo |
| AD14 | Settings | Global-only; settings-in-context accordions on each page | todo |
| AD15 | First run & empty states | First-run checklist on dashboard; rich empty states on every screen | todo |
| AD16 | Slide-in panels | Shared right slide-in: add order, message attendees, person record, campaign, countdown, import mapping, new group, add person, location editor | todo |

## Roadmap items previously parked (also in scope now)

| # | Item | Build | Status |
|---|------|-------|--------|
| R1 | Tour locations CPT | Promote per-event locations repeater to a native `oe_location` type; migrate the JetEngine `portfolio` entries; credits/availability/gallery/guided slots/own volunteers | todo |
| R2 | Demographics | Consent-gated demographic capture + aggregate reporting | todo |
| R3 | Monthly digest | Finalise the digest content hooks and enable `Cron::DIGEST_ENABLED` | todo |
| R4 | Organizer briefings + checklist | The partner-portal briefings list + checklist data model | todo |
| R5 | Crew module full lifecycle | Agreement → login → role email → renewal/offboarding emails (ties to AD7) | shipped v1.236.0 |

## Design tokens (from the mockup)

Accent `#dd4b14`, accent-soft `rgba(221,75,20,.1)`, accent-ink `#c2410c`;
surface `#fff`, canvas `#faf9f5`, sunken `#f3f3f3`; ink `#1a1a1a`, muted `#555`,
subtle `#888`; card border `#e3e2db`, neutral border `#1a1a1a`; feature card
`#1a1a1a`; radii 8/14/20px; border 2px; shadow-sm/md/lg per UI-SPEC; semantic
positive/negative/warning/info. Brockmann type, inherited.
