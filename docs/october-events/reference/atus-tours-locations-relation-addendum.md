# Architecture Tours US: the Tours to Tour Locations link

Captured 11 October 2026. Closes the open item in `atus-portfolio-tour-locations-report.md`.

---

## Finding

There is no stored relation. Four places it could have lived, all checked, all empty or ruled out:

| Checked | Result |
|---|---|
| JetEngine Relations | "No relations found." Zero relations on the install |
| JetEngine Meta Boxes | "No meta boxes found." Zero meta boxes |
| Shared taxonomy | None. See below |
| Reference field on either post type | None. Neither field set contains a post ID, relation or object field |

JetEngine Query Builder is also empty, zero saved queries, so the join is not happening there either.

## Taxonomies on this install

Six exist. None is shared between `events` (Tours) and `portfolio` (Tour Locations).

| Taxonomy | Slug | Attached to |
|---|---|---|
| Tour Cities | `tour-cities` | `portfolio` only |
| Tour Years | `tour-years` | `portfolio` only |
| Directory Categories | `directory-categories` | `directory` |
| Directory Tags | `directory-tags` | `directory` |
| Directory Locations | `directory-locations` | `directory` |
| Partner Categories | `partner-categories` | **Nothing** |

Two things to take from that table.

**Tours has no taxonomy at all.** Not `tour-cities`, not `tour-years`, nothing. A tour's city lives in the `city` select meta field, the one with six option values carrying a leading space. A location's city lives in the `tour-cities` taxonomy. The same concept is modelled two different ways on two post types that are supposed to connect.

**`partner-categories` is attached to no post type.** The Taxonomies list shows it targeting `partners`, which does not exist among the post types on this install. It is registered and doing nothing.

## What this means

The link between a tour and its locations is being made in the Elementor templates or listing widgets at render time, almost certainly by querying `portfolio` filtered on a `tour-cities` term and a `tour-years` term, with those terms either hardcoded per template or pulled from the page context.

Practical consequences:

- The link is not queryable. You cannot ask the database which locations belong to a given tour, because nothing records it. Only the template knows.
- It does not survive. Rebuild the templates, move to a new theme, or migrate the content, and the association is gone with no way to reconstruct it except by reading each old template.
- It cannot be reported on. No count of locations per tour, no "locations added since last year", nothing, without parsing templates.
- Adding a tour means touching a template, not just adding a post.

## If you want it fixed

A JetEngine Relation between `events` and `portfolio`, many to many, is the direct fix. It gives a real stored link, makes both directions queryable, and takes the association out of the templates.

The migration is the work, not the setup. Nothing currently records which locations belong to which tour, so the existing associations have to be reconstructed by reading each tour template and re-entering them by hand, once. After that it is a field on the post editor.

Worth weighing against how many tours and locations actually exist. If it is a handful of tours per year, the current arrangement is survivable and the leading-space bug on the Tours `city` field is the more urgent item. If the location count is in the hundreds and growing, the relation pays for itself quickly.

## Still not captured

Listings and components, the Volunteer CPT on this install, the JetEngine meta set on built-in posts (record ID 3), Options Pages, Custom Content Types, and post content.

The listings are where the render-time join actually lives, so that is the one place left that would show the association as it currently works.
