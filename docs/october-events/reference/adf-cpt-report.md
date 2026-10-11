# Atlanta Design Festival: Events and Volunteer CPT report

Captured 11 October 2026 from `atlantadesignfestival.net`.
Source: JetEngine (Crocoblock), not CPT UI or ACF.

---

## 1. Can these be exported?

No. JetEngine has no export or import function for post types. The Post Types list offers Edit, Copy and Delete only, and there is no Tools or Import/Export screen in the JetEngine menu on this install. Copy duplicates a post type within the same site, which does not help you move it elsewhere.

The definitions were instead pulled from the JetEngine REST endpoint used by the admin UI:

```
/wp-json/jet-engine/v2/get-post-type/1   (Events)
/wp-json/jet-engine/v2/get-post-type/8   (Volunteer)
```

Both are now reconstructed in `adf-cpt-definitions.json`, which sits alongside this report. That file is complete enough to rebuild both post types by hand on another install, or to generate a PHP registration file.

Three practical routes if you need these on another site:

| Route | Effort | Notes |
|---|---|---|
| Rebuild from `adf-cpt-definitions.json` in JetEngine on the target site | Medium. 63 Events fields plus 33 repeater sub-fields | Keeps the JetEngine UI and conditional logic intact |
| Copy the `jet_post_types` rows directly in the database | Low, if you have DB access on both sides | JetEngine stores post types in its own table, `wp_jet_post_types`. A straight row copy carries everything |
| Generate `register_post_type()` plus meta registration in PHP from the JSON | Medium | Drops the JetEngine admin UI and conditional logic. Only worth it if you are moving away from JetEngine |

The database route is the fastest and the one I would use. Fields are stored as serialised JSON in the `meta_fields` column, so the row copies cleanly between sites running the same JetEngine version.

---

## 2. Events

### Registration

| Setting | Value |
|---|---|
| Slug | `events` |
| JetEngine ID | 1 |
| Rewrite slug | `e` |
| Menu icon | `dashicons-tickets-alt` |
| Menu position | 21 |
| Public, show in REST, has archive | Yes |
| Hierarchical | Yes |
| Exclude from search | No |
| Supports | title, excerpt, thumbnail, custom-fields, post-formats |
| Meta storage | Default `postmeta` table |

### Field structure

73 entries: 10 tabs, 5 repeaters, 58 standard fields. Repeaters add a further 33 sub-fields.

**Event Details** (`key-details`)
Registration link and button text, Virtual Event radio, Location, Parking, Price, Price (Sale), YouTube, Dates & Times (WYSIWYG), Start Date, Start Time, End Date, End Time, Gallery.

**Basic Listing** (`basic_listing`)
External Event Link, More Information, Event Description, DesignStation switcher, Company, Company Logo switcher plus three logo slots.

**Advanced Listing** (`conference`)
Conference Page Switcher, About The Event, About Image.

**Exhibition** (`exhibition`)
Exhibition Page Switcher and an `exhibitor` repeater: photo, name, description, LinkedIn, Instagram, website.

**Tickets** (`tickets-tab`)
Section on/off switcher, then twelve fields covering Single (Early Bird), Single, Single (Sale), Group, Group (Sale), Student, Student (Sale) and a description for each.

**Speakers** (`speakers_tab`)
Section on/off switcher and a `speakers` repeater: photo, name, title, LinkedIn, Instagram, website.

**Past Speakers** (`past-speakers-tab`)
Section on/off switcher and a `past-speakers` repeater: photo, name, title.

**Schedule** (`schedule-tab`)
Sessions on/off switcher, Session Descriptions, then per day: date, theme and a sessions repeater. Day 1 holds a gallery field for speaker portraits. Day 2 holds five separate media fields instead.

**Accomodation** (`accommodation-tab`)
Section on/off switcher, image, logo, name, description, link.

**Archived Fields** (`archived-fields-tab`)
Design District radio (Design Station Expo, Ponce City Market, Westside Provisions District, Buckhead Village District, Midtown), Tours Page Switcher, City radio (Atlanta, Serenbe), Tour Locations link, Download Tour Locations PDF.

---

## 3. Volunteer

### Registration

| Setting | Value |
|---|---|
| Slug | `volunteer` |
| JetEngine ID | 8 |
| Rewrite slug | `v` |
| Menu icon | `dashicons-businessman` |
| Menu position | 21 |
| Public, show in REST, has archive | Yes |
| Hierarchical | Yes |
| Exclude from search | Yes |
| Supports | title, excerpt, thumbnail, custom-fields, post-formats |
| Meta storage | Default `postmeta` table |

### Field structure

11 entries: 2 tabs, 9 fields, no repeaters.

**Details** (`details`)

| Field | Name | Type | Options |
|---|---|---|---|
| Title | `title` | text | |
| Volunteer Type | `volunteer-type` | select | Docent, Social Media, Meet & Greet Host, Event Coordinator |
| City | `city` | select | Atlanta, Serenbe |
| Location | `event-location` | text | |
| Date | `date` | select | Multiple Dates, then nine hardcoded dates from 27 September to 5 October 2025 |
| Company Logo Switcher | `company-logo-switcher` | switcher | Yes, No |
| Company Logo #1 | `company-logo-1` | media | |

**Archived** (`archived`)
Fully Booked switcher (25% width), Sign-Up Link text (25% width).

---

## 4. Problems worth fixing

These are live faults, not stylistic preferences.

**1. Events conditional logic is broken on Location and Parking.**
Both are set to show when `virtual-event` equals the string `In-Person Event`. The `virtual-event` radio only offers `Yes` and `No`. The condition can never match, so Location and Parking never appear in the editor. Either change the radio options to `In-Person Event` / `Virtual Event`, or change the condition to `virtual-event equals No`.

**2. Ticket fields are tied to the wrong switcher.**
All twelve ticket fields are conditioned on `conference-page-switcher`, not on `tickets-section-onoff`. The Tickets on/off switcher currently controls nothing in the editor. The same applies to the Schedule fields, which are also keyed to `conference-page-switcher` rather than `sessions-section-onoff`.

**3. Volunteer `date` options are hardcoded to 2025.**
Nine fixed dates from the 2025 festival. This needs updating every cycle, or replacing with a date field or a glossary so it stops being a manual job.

**4. Volunteer "Add New" label says "Add New Event".**
Copy-paste from the Events CPT. Cosmetic, but it shows in the admin.

**5. Volunteer `Location` has conditional logic enabled with an empty condition set.**
Harmless at present, but it is the kind of thing that starts hiding a field after a JetEngine update.

**6. Both post types are hierarchical.**
Events and Volunteer entries are flat content. Hierarchical adds a parent dropdown and changes permalink behaviour for no benefit. Worth turning off, though check your permalink structure before changing it on a live site.

**7. Both use menu position 21.**
WordPress resolves the collision arbitrarily, so menu order can shift between loads.

**8. Rewrite slugs are single letters, `e` and `v`.**
URLs read `/e/event-name/` and `/v/role-name/`. Short, but it costs you a keyword in the URL and tells a visitor nothing. Changing these breaks existing links, so it needs redirects if you do it.

**9. Naming conventions are inconsistent.**
Hyphens and underscores are mixed across field names (`basic_listing` next to `key-details`, `group_ticket` next to `single-ticket`). The Accommodation tab is worse: the tab is `accommodation-tab`, the switcher is `accomodation_section_onoff` with one `m`, and the display label is also misspelled. Renaming fields orphans existing post meta, so this is a migration job rather than a quick fix.

**10. Schedule Day 1 and Day 2 are structured differently.**
Day 1 uses a single gallery field for speaker portraits. Day 2 uses five numbered media fields. Any listing template has to handle both. Day 2 is also capped at five portraits by design.

**11. No admin columns or filters on either post type.**
Zero on both. With 63 Events fields and an archive of past festivals, the admin list is harder to work with than it needs to be. Adding columns for start date and the conference switcher, and a filter on city, is a ten minute job with a clear payoff.

---

## 5. Not covered here

This is the post type definitions only. The following are separate JetEngine objects and were not captured:

- Taxonomies attached to either post type
- Relations
- Listings and components that render these fields on the front end
- Meta boxes
- Query Builder items
- Post content itself

If another session needs the full picture, those sit under JetEngine in the WordPress admin and each has its own REST endpoint following the same pattern as the post types one.
