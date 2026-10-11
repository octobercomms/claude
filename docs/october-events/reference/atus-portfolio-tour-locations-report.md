# Architecture Tours US: Tour Locations (`portfolio`) report

Captured 11 October 2026 from `architecturetours.us`.
Supersedes the "not captured" note on this post type in `atus-cpt-report.md`.

---

## 1. This one is different

Directory and Tours are JetEngine-created post types. This is not.

`portfolio` is registered outside JetEngine, almost certainly by the active theme. Two things in the registration give it away: `elementor` sits first in the supports array, and it carries a `template_name` of "Single item: Portfolio". JetEngine is attaching meta fields to a post type it does not own, through the built-in post type editor at `edit-type=built-in`.

That changes the export picture:

| | Directory and Tours | Tour Locations |
|---|---|---|
| Registration | JetEngine | Theme or plugin |
| Settings shown in JetEngine | Editable, authoritative | Read-only reflection |
| Copying the JetEngine DB row | Recreates the whole thing | Carries meta fields only |
| Survives a theme change | Yes | **No** |

If the theme is ever swapped, the post type disappears and roughly however many location posts exist become orphaned. The meta stays in the database, the posts stay in `wp_rjrh_posts`, but nothing registers the type so nothing renders and nothing is editable. That is the single most important thing in this report.

One correction to the earlier report while on the subject: the database prefix on this install is `wp_rjrh_`, so the JetEngine table is `wp_rjrh_jet_post_types`, not `wp_jet_post_types`.

Endpoint used:

```
/wp-json/jet-engine/v2/get-built-in-post-type/portfolio
```

Full capture in `atus-portfolio-tour-locations-definition.json`.

---

## 2. Registration

| Setting | Value |
|---|---|
| Post type key | `portfolio` |
| JetEngine record ID | 2 |
| JetEngine display name | Tour Locations |
| Rewrite slug | `portfolio` |
| Query var | `portfolio` |
| Menu position | 4 |
| Menu icon | None set |
| Public, publicly queryable, show in REST | Yes |
| Has archive | Yes, at `/portfolio/` |
| Hierarchical | No |
| Exclude from search | No |
| Taxonomies | **None** |
| Supports | elementor, title, editor, author, thumbnail, excerpt, comments, trackbacks, revisions, custom_fields, page-attributes, autosave |

### Labels

Half renamed, half left as the theme shipped them. `name` is "Portfolios", `menu_name` is "Locations", `singular_name` is "Tour Location", `add_new` is "Add New Portfolio". Roughly fifteen further labels are untouched WordPress defaults that say "post": "Insert into post", "Uploaded to this post", "Post published.", "Post trashed.", "Posts list".

---

## 3. Fields

17 fields, no tabs, no repeaters, one conditional rule.

| Field | Name | Type | Notes |
|---|---|---|---|
| City | `city` | select | Atlanta GA, Serenbe GA |
| Date | `date` | text | Plain text |
| Saturday Only | `sat_only` | switcher | |
| Sunday Only | `sun_only` | switcher | |
| Address | `address` | text | |
| Parking | `parking` | text | |
| Google Maps | `google_maps` | text | |
| Architect | `architect` | text | |
| Interior Designer | `interior_designer` | text | |
| Landscape Architect | `landscape_architect` | text | |
| Developer | `developer` | text | |
| Construction | `construction` | text | |
| Photographer | `photographer` | text | |
| Alert | `alert` | textarea | |
| Guided Tour? | `guided_tour` | switcher | |
| Guided Tour external link | `guided-tour-external-link` | text | Shows when `guided_tour` is true. Correctly configured |
| Gallery | `gallery` | gallery | |

The credits block (architect, interior designer, landscape architect, developer, construction, photographer) is the useful part of this post type and it is clean. Six plain text fields, consistently named.

---

## 4. Problems worth fixing

**1. The post type depends on the theme.**
Covered above. Mitigation is a five line snippet in a site-specific plugin that registers `portfolio` with the same arguments, so the type survives independently of the theme. The theme's own registration will simply win while the theme is active. This is cheap insurance and I would do it before anything else on this list.

**2. City offers two options while Tours offers eighteen.**
Tours can be tagged to any of eighteen US cities. A Tour Location can only be Atlanta GA or Serenbe GA. Either the location data genuinely only covers Georgia, in which case the eighteen cities on Tours are aspirational, or locations outside Georgia are being created with no city at all. Worth checking which, because it determines whether the site can actually scale beyond Atlanta.

Note also that the two option values here are clean, with no leading spaces. The six broken values are on the Tours `city` field only.

**3. No taxonomies, and no relation visible from here.**
`taxonomies` is empty. There is no registered way to say which locations belong to which tour. If that link exists it is a JetEngine Relation or a meta field on the Tours side, neither of which is captured in this report. Worth confirming, because without it the Tours and Tour Locations types are two unconnected content sets and every tour page has to hardcode its locations.

**4. Comments and trackbacks are enabled.**
Both sit in the supports array. Tour location pages accept comments and trackbacks, which on a public archive is a spam surface and nothing else. Turn both off unless they are in use.

**5. Public archive at `/portfolio/`.**
`has_archive` is true, `publicly_queryable` is true, `exclude_from_search` is false. An architecture tours site is serving a public, indexable archive at `/portfolio/` with an archive label of "All Locations" and an internal name of "Portfolios". Either put it to work with a proper slug and template, or close it off with `has_archive` false and `exclude_from_search` true. Changing the slug needs redirects.

**6. Three post types now share menu position 4.**
Directory, Tours and Tour Locations. WordPress resolves this arbitrarily, so admin menu order shifts between loads. Tour Locations also has no menu icon, so it falls back to the default pin.

**7. `date` is a text field.**
Tours uses proper date and time fields. Here the date is free text, so it cannot be sorted, filtered, compared or fed into a calendar query. Anything built on top of it has to parse strings.

**8. Saturday Only and Sunday Only are two independent switchers.**
Four possible states, two of which are ambiguous. Both off could mean "both days" or "unset". Both on contradicts the field names. One select with Saturday, Sunday, Both would remove the ambiguity, or a taxonomy if you want to filter on it.

**9. Labels are half finished.**
Around fifteen labels still read "post" in the admin. The add new button says "Add New Portfolio" while the menu says Locations. Ten minutes of work, and it is the kind of thing a client notices.

**10. Field naming conventions diverge again.**
Underscores throughout (`google_maps`, `interior_designer`, `sat_only`) except `guided-tour-external-link`, which uses hyphens. Across the three post types on this install you now have underscores, hyphens, and a `_description` with a leading underscore. Nothing breaks, but anyone writing a template has to look every name up.

---

## 5. Where the three post types stand

| | Tours | Tour Locations | Directory |
|---|---|---|---|
| Post type key | `events` | `portfolio` | `directory` |
| Registered by | JetEngine | Theme | JetEngine |
| Fields | 28 | 17 | 10 |
| Tabs | 2 | 0 | 0 |
| Conditional logic | None | 1 rule | None |
| Taxonomies | Not captured | None | Not captured |
| Archive | None | `/portfolio/` | `/directory/` |
| Rewrite slug | `e` | `portfolio` | `directory` |
| Menu position | 4 | 4 | 4 |
| Admin columns and filters | None | None | None |

Three post types, three naming conventions, three different ideas about slugs, and a shared menu position. The content model itself is sound. The configuration around it has drifted, which is normal for a site built over several festival cycles, and most of it is cheap to tidy.

The two items with real consequences are the theme dependency on `portfolio` and the missing link between Tours and Tour Locations. Everything else on the lists is housekeeping.

---

## 6. Not covered here

Taxonomies, relations, listings and components, meta boxes, Query Builder items, the Volunteer CPT on this install, the JetEngine meta set attached to built-in posts (record ID 3), and post content.

Relations in particular are worth a look next, since that is where the Tours to Tour Locations link would live if it exists.
