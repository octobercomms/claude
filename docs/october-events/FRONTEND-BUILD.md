# Front-end build: make the public surfaces match the mockup

Status: **active build**. Owner: Daniel. Plugin: `dev/october-events`.
Companion to [`UI-SPEC.md`](UI-SPEC.md) and [`BUILD-PLAN.md`](BUILD-PLAN.md).

The M2 front end shipped as plumbing: section shortcodes, adoption-mode gating
and an inline token sheet, but no designed stylesheet and the content-heavy pack
sections were left as `pack_pending()` stubs. The admin mockup is built; the
front-end mockup is not. This doc is the ordered backlog that closes that gap.

Front-end mockup (owner access): https://claude.ai/artifact/AfRxu97Ttr6rz5PkGKF7Sj

## Slices

| # | Slice | Delivers | Status |
|---|-------|----------|--------|
| A | Designed section stylesheet + token upgrade | Base event page + archive look like the mockup | shipped v1.221.0 |
| B | Conference pack content | Speakers, past speakers, schedule, accommodation: storage + metabox + renderers | shipped v1.222.0 |
| C | Exhibition pack content + shared repeater base | Exhibitors: storage + metabox + renderer | shipped v1.223.0 |
| D | Tour locations | Per-event locations repeater + metabox + `[oe_tour_locations]` with day filter | shipped v1.224.0 |
| E | Staff pack | Role page + apply-by-email form | shipped v1.225.0 |
| F | Archive search + facets | Free-text search + chip facet + dropdown facets | shipped v1.226.0 |
| G | Team portal | `[oe_team_portal]` role-scoped module dashboard | shipped v1.227.0 |
| H | Organizer portal | `[oe_organizer_portal]` overview / packages / activities (edit-own) / account | shipped v1.228.0 |
| I | Attendee email preferences | `[oe_email_preferences]` in the account dashboard | shipped v1.229.0 |

All slices shipped. The capability-pack content layer (B–E) is stored as
post-meta repeaters via `OE\Packs\Content\Store`, so no schema change across the
whole build.

### Deliberately left for later (not blocking the mockup)

- **Tour locations as a first-class type.** D stores locations as a per-event
  repeater, which renders the mockup's Locations section. Promoting them to a
  queryable `oe_location` CPT (for cross-tour reuse and the JetEngine `portfolio`
  migration) is the richer model in `FIELD-MAPPING.md`; do it when the tours site
  cutover needs it.
- **Organizer briefings + checklist data.** H ships Overview/Packages/Activities/
  Account. The mockup's briefings list and partner checklist need a data model
  first (owner input on stages/dates), so they are not fabricated here.
- **Deep front-end parity for team tools.** G scopes access and links to each
  screen; building full front-end equivalents of every admin tool is a later
  self-serve-tier concern.

## Design contract

All section markup carries `oe-sec oe-sec--{section}` and inner `oe-*` BEM
classes. The static design lives in `assets/css/sections.css`, enqueued on the
front end; the per-site tokens (accent, radius, surface, etc.) are emitted inline
by `OE\Sections\Theme` so a tenant restyles every section from one accent. The
reference accent is the plugin's orange (`#dd4b14`); defaults match the mockup
(white surface, 2px borders, 14px radius, soft shadow, Brockmann type inherited
from the theme).

## Storage convention for pack content

Repeater content (speakers, sessions, exhibitors) is stored as one JSON-encoded
post-meta value per field via `OE\Packs\Content\Store`, keyed `_oe_{pack}_{field}`.
Clean structured data, no pasted HTML, consistent with the structured-fields rule
in `FIELD-MAPPING.md`. Each pack has a metabox (entry) and a renderer (output)
behind its section shortcode, replacing the `pack_pending()` stub.
