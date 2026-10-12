# Architecture Tours US: Directory and Tours CPT report

Captured 11 October 2026 from `architecturetours.us`.
Source: JetEngine (Crocoblock), same build approach as Atlanta Design Festival.

---

## 1. Can these be exported?

No, for the same reason as the ADF install. JetEngine offers Edit, Copy and Delete on the Post Types list and nothing else. There is no import or export screen.

Both definitions were pulled from the JetEngine REST endpoint used by the admin UI:

```
/wp-json/jet-engine/v2/get-post-type/7   (Directory)
/wp-json/jet-engine/v2/get-post-type/1   (Tours)
```

Rebuilt in full in `atus-cpt-definitions.json` alongside this report.

Moving these to another install: copying the `wp_jet_post_types` rows at database level remains the fastest route, provided both sides run the same JetEngine version. Rebuilding by hand is realistic here in a way it was not for ADF Events, since Tours has 28 fields and no repeaters and Directory has 10.

### Also on this install

The Post Types list shows three JetEngine CPTs: Volunteer, Directory, Tours. Two further JetEngine records exist that are not JetEngine-created post types:

- ID 2 holds meta fields for a post type keyed `portfolio`, labelled "Tour Locations"
- ID 3 holds meta fields attached to the built-in `post` type

Neither was captured. Worth knowing because Tours has three fields referring to Tour Locations, so the two are coupled.

---

## 2. Tours

### Registration

| Setting | Value |
|---|---|
| **Post type key** | **`events`** |
| Admin label | Tours |
| JetEngine ID | 1 |
| Rewrite slug | `e` |
| Menu icon | `dashicons-location` |
| Menu position | 4 |
| Public, show in REST | Yes |
| Has archive | **No** |
| Hierarchical | Yes |
| Exclude from search | No |
| Supports | title, thumbnail, custom-fields, post-formats |
| Meta storage | Default `postmeta` table |

### Field structure

30 entries: 2 tabs, 28 fields. No repeaters, no conditional logic anywhere.

**Details** (`details`)

| Field | Name | Type |
|---|---|---|
| City | `city` | select, 18 options |
| Registration Link | `registration-link` | text |
| Registration Link Button Text | `registration-link-button-text` | text |
| YouTube | `youtube` | text |
| Event Details | `event-details` | wysiwyg |
| Price(s) | `event-price` | text |
| Dates & Times | `date-time` | wysiwyg |
| Start Date | `start-date` | date |
| Start Time | `start-time` | time |
| End Date | `end-date` | date |
| End Time | `end-time` | time |
| Gallery | `gallery` | gallery |
| More Information | `external-url` | text |
| Download Tour Locations PDF | `download-tour-locations-pdf` | text |
| Tour Locations Google Map | `tour-locations-google-map` | text |
| Tour Locations Google Map (Embed) | `tour_locations_google_map_embed` | text |
| Company | `company` | text |
| Company Logo Switcher | `company-logo-switcher` | switcher |
| Company Logo #1 to #3 | `company-logo-1`, `-2`, `-3` | media |
| Accommodation | `accommodation` | wysiwyg |
| Accommodation Photo | `accommodation_photo` | media |

City options, in stored order: Atlanta GA, Serenbe GA, Austin TX, Boston MA, Chicago IL, Dallas-Fort Worth TX, Denver CO, Houston TX, Los Angeles CA, Miami FL, New York City NY, Philadelphia PA, Phoenix AZ, Portland OR, San Diego CA, San Francisco CA, Seattle WA, Washington DC.

**Archived** (`archived`)
Five legacy pricing fields: `price_early_bird`, `price_early_bird_end_date`, `price_single_ticket_desc`, `price_group_ticket`, `price_group_ticket_desc`. No conditional logic, so they are still visible and editable.

---

## 3. Directory

### Registration

| Setting | Value |
|---|---|
| Post type key | `directory` |
| Singular label | Directory Listing |
| JetEngine ID | 7 |
| Rewrite slug | `directory` |
| With front | No |
| Menu icon | `dashicons-archive` |
| Menu position | 4 |
| Public, show in REST, has archive | Yes |
| Hierarchical | No |
| Exclude from search | No |
| Supports | title, thumbnail |
| Meta storage | Default `postmeta` table |

Labels are fully filled out here, unlike every other CPT across the two sites. Edit post type link is enabled.

### Field structure

10 fields, no tabs, no repeaters, no conditional logic.

| Field | Name | Type |
|---|---|---|
| Description | `_description` | wysiwyg |
| Quote | `quote` | text |
| Website | `website` | text |
| Address | `address` | wysiwyg |
| Email Address | `email-address` | text |
| Instagram | `instagram` | text |
| Facebook | `facebook` | text |
| Pinterest | `pinterest` | text |
| Houzz | `houzz` | text |
| Gallery | `gallery` | gallery |

---

## 4. Problems worth fixing

**1. Tours is registered as `events`.**
The label reads Tours everywhere in the admin, but the post type key is `events`. Every query, listing, REST call, template condition and third party integration must use `events`. Anyone new to the site will write `tours` and get nothing back. Changing the key orphans all existing posts and their meta, so this is a documentation job rather than a fix, unless you are prepared to run a migration.

It also means both this site and Atlanta Design Festival have a post type keyed `events`. If you ever share listing code, a child theme or a snippet library between them, that is a trap.

**2. Six City options have a leading space in the stored value.**
" Austin TX", " Boston MA", " Chicago IL", " Dallas-Fort Worth TX", " Seattle WA", " Washington DC". The space is saved into post meta. Any filter, query, meta comparison or JetSmartFilters option that matches on "Austin TX" will miss every tour in those six cities. This is the most likely cause of a city filter that silently returns nothing. Fix the options, then run an update query to trim existing meta values.

**3. Tours has `has_archive: false` but a rewrite slug of `e`.**
There is no `/e/` archive. If the tours index is a page template that is fine, but the rewrite slug is doing nothing except shortening single tour URLs to `/e/tour-name/`, which tells a visitor and a search engine nothing. Changing it needs redirects.

**4. Directory's description is stored as `_description`.**
The leading underscore makes it protected meta. It is hidden from the default custom fields UI, excluded from some search indexing plugins, and skipped by several export and migration tools. Since Directory has no editor support, that wysiwyg field holds the entire body copy of every listing. Check whether your site search and any SEO plugin actually index it.

**5. Directory labels contain two errors.**
`not_found` is set to "Parent Directory", so an empty search in the admin reads "Parent Directory". `parent_item_colon` is set on a non-hierarchical post type, where it does nothing. `all_items` reads "All Directory" and `search_items` "Search for Directory".

**6. Directory and Tours both sit at menu position 4.**
WordPress resolves the collision arbitrarily, so admin menu order can shift. Position 4 also puts both above Media and Pages.

**7. Tours is hierarchical.**
Tours are flat content. Hierarchical adds a parent dropdown and changes permalink handling for no benefit.

**8. The Archived pricing tab on Tours is live, not archived.**
Five fields with no conditional logic and no indication in the editor that they are retired. Either hide them with a switcher, or delete them with "delete metadata" switched off so the stored values survive.

**9. Two field labels do not match their meta keys.**
`price_early_bird_end_date` is labelled "Price - Early Bird (Description)". `price_group_ticket_desc` is labelled "Price - Group Ticket ( (Description))" with a doubled bracket. Anyone reading the meta keys will map them wrongly.

**10. Field naming is inconsistent.**
Hyphens and underscores are mixed, sometimes within a pair: `tour-locations-google-map` sits next to `tour_locations_google_map_embed`, and `event-price` next to `price_early_bird`. Renaming orphans meta, so treat this as a migration rather than a tidy-up.

**11. No admin columns or filters on either post type.**
Tours spans 18 cities with start dates and prices, and the admin list shows none of it. A city filter and a start date column would pay for themselves immediately.

**12. The Dates & Times field description still holds October 2022 placeholder text.**
Identical to the ADF install, which confirms the shared lineage below.

---

## 5. Shared lineage with Atlanta Design Festival

These two installs were built from the same base. The overlap is exact, not approximate:

`event-price`, `date-time`, `start-date`, `start-time`, `end-date`, `end-time`, `gallery`, `external-url`, `registration-link`, `registration-link-button-text`, `youtube`, `company`, `company-logo-switcher`, `company-logo-1` to `-3`, `download-tour-locations-pdf`, `city`, and the same October 2022 placeholder description.

Both have a post type keyed `events` with rewrite slug `e`, both have a Volunteer CPT with rewrite slug `v`, and both park legacy fields in an Archived tab.

Two consequences worth weighing:

- A shared listing component or snippet library is realistic. The field names already match.
- The divergence is in the details, not the structure. ADF Events uses conditional logic and repeaters heavily; ATUS Tours uses neither. If you standardise, standardise on one of the two patterns rather than letting them drift further.

---

## 6. Not covered here

Post type definitions only. Not captured: taxonomies, relations, listings and components, meta boxes, Query Builder items, the Volunteer CPT on this install, the `portfolio` / Tour Locations meta set (JetEngine ID 2), the meta set attached to built-in posts (ID 3), and post content.

Each has its own REST endpoint following the same pattern as the post types one, so any of it can be captured the same way.
