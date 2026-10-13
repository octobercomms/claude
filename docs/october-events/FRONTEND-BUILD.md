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
| A | Designed section stylesheet + token upgrade | Base event page + archive look like the mockup | building |
| B | Conference pack content | Speakers, past speakers, schedule, accommodation: storage + metabox + renderers | todo |
| C | Exhibition pack content | Exhibitors: storage + metabox + renderer | todo |
| D | Tour locations | `oe_location` model + metabox + `[oe_tour_locations]` + map pins | todo |
| E | Staff pack | Role page + apply-by-email form | todo |
| F | Archive search + facets | Free-text search, building-type/city/year facets, designed cards | todo |
| G | Team portal | `[oe_team_portal]` role-scoped module dashboard | todo |
| H | Organizer portal | `[oe_organizer_portal]` checklist / packages / activities / briefings / account | todo |
| I | Attendee email preferences | Email-prefs panel in the account dashboard | todo |

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
