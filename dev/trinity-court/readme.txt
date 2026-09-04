=== Trinity Court Projects ===
Contributors: octobercomms
Tags: projects, tracker, community, residents, rtm
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.1.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A building improvement works tracker for Trinity Court, Margate. Log works,
track status and quoted cost with a running total, group works into programmes,
and let residents vote and comment.

== Description ==

Registers a "Projects" custom post type and a resident-facing display for the
Trinity Court RTM. Each project carries a status (Not started, Arranging quote,
Quoted, Queued, Started, Completed, On hold), a priority, a category, a quoted
cost, and a location. The front end shows a running cost total, per-programme
subtotals, resident voting, and a discussion thread hidden inside each ticket.

Display anywhere with the shortcode:

    [trinity_projects]

Shortcode attributes:

* view      "programme" (default, grouped) or "flat" (single list)
* summary   "yes" (default) or "no"
* voting    "yes" (default) or "no"
* comments  "yes" (default) or "no"

== Installation ==

1. Upload the `trinity-court` folder to `/wp-content/plugins/`.
2. Activate the plugin. The 25 RTM works-list items load automatically.
3. Add `[trinity_projects]` to a residents' page.
4. Edit each project under Projects to set status, priority and cost as
   quotes arrive.

== Changelog ==

= 1.1.1 =
* Accent colour now defaults to Elementor's global Primary
  (--e-global-color-primary), so the tracker matches the site brand out of the
  box; still overridable via the shortcode accent="" attribute.

= 1.1.0 =
* Quote documents: attach the actual quote (PDF, image or doc) to each project
  so residents can read it; shown inside the ticket.
* Downloads: export the full list to a formatted XLS (opens in Excel, Numbers
  or Google Sheets) and to a print-ready PDF, so residents and the managing
  agent can keep their own record.
* Programme types now follow the recognised project hierarchy: Epic,
  Initiative, Sprint, Milestone (was programme / sprint / mega-project).

= 1.0.0 =
* Initial release: projects CPT, status/priority/cost tracking, running totals,
  programme grouping (sprints / mega-projects), resident voting, in-ticket
  comments, and the RTM works list seeded on activation.
