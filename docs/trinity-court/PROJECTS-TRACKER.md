# Trinity Court Projects tracker

A WordPress plugin that logs building improvement works, tracks status and
cost with a running total, groups works into programmes, and lets residents
vote and comment. Built for the Trinity Court RTM to give residents visibility
of what is being worked on and what it costs.

- **Code:** `dev/trinity-court/`
- **Plugin name:** Trinity Court Projects
- **Shortcode:** `[trinity_projects]`
- **Live site:** https://trinitycourtmargate.co.uk/

This delivers section 5.2 ("Key Projects list") of `SCOPE.md`, plus the cost
transparency, voting, comments and grouping added later.

## What it does

| Feature | Detail |
|---------|--------|
| Log works | Each item is a "Project" with a reference number, problem, proposed solution, category and location. |
| Status | Not started, Arranging quote, Quoted, Queued, Started, Completed, On hold. |
| Priority | Urgent, High, Medium, Low, Wishlist, TBC. |
| Cost + running total | Enter a figure per project with a basis (estimate / quote / final). The summary bar sums total costed, spent on completed works, and pipeline. Blank stays "Awaiting quote". |
| Programmes | Group projects into a Programme, Sprint or Mega-project. Each group shows its own cost subtotal and completion bar. |
| Voting | Residents upvote works to signal where to start. One vote per person, toggleable. Logged-in residents tracked by account; visitors by a cookie. |
| Comments | A discussion thread hidden inside each ticket, shown only when a resident opens it and expands "Discussion". Not shown in the always-visible list. |
| Quote documents | Attach the actual quote (PDF, image or document) to a project via the WP media library. Residents open it from inside the ticket. |
| Downloads | Export the full list to a formatted XLS (Excel/Numbers/Sheets) or a print-ready PDF, so residents and the managing agent can keep their own record. |

## Programme types (the project hierarchy)

"Sprint" is a time-box, not a size of work, so the group types now follow the
recognised project hierarchy:

| Type | Means | Example |
|------|-------|---------|
| **Epic** | A bundle of related works delivered together | Waste & Bin Store Overhaul |
| **Initiative** | A large scheme spanning several epics | Communal Areas Refresh |
| **Sprint** | A time-boxed batch committed to next | Fire Safety (do before winter) |
| **Milestone** | A dated target the works roll up to | AGM, end of financial year |

A project can sit in more than one, so a job can belong to an epic and also be
pulled into the current sprint.

## Install

1. Copy `dev/trinity-court/` into `wp-content/plugins/` on the site (folder can
   stay named `trinity-court`).
2. Activate **Trinity Court Projects** in Plugins.
3. On activation the 25 items from the RTM works list load automatically, along
   with three starter programmes (Waste & Bin Store Overhaul, Communal Areas
   Refresh, Fire Safety).
4. Create a residents' page and add the shortcode `[trinity_projects]`.

If projects do not appear, go to **Projects > Import seed list** and run the
import. It matches on reference number, so it tops up missing items without
duplicating existing ones.

## Using it

- **Log or edit a project:** Projects > Add new (or edit an existing one). The
  main editor holds the problem; the side box holds status, priority, cost,
  cost basis and location; the lower box holds the proposed solution.
- **Enter a quote:** open the project, put the figure in **Cost (£)** and set
  the basis. The running totals update on the front end automatically.
- **Attach the quote document:** in the "Quote documents" box, click **Add
  quote document**, upload or pick the file, and update. It shows inside the
  ticket for residents to read.
- **Download the list:** the toolbar on the residents' page has **Download XLS**
  and **Download PDF**. XLS opens in Excel, Numbers or Google Sheets with a
  summable cost column; PDF opens a print-ready A4 page and the browser's
  Save-as-PDF.
- **Group works:** assign a project to one or more Programmes (Projects >
  Programmes to create them and set the type: programme, sprint or mega-project).
- **Moderate comments:** anonymous comments go to the normal WordPress
  moderation queue; comments from logged-in residents auto-approve. Manage them
  under Comments as usual.

## Shortcode options

```
[trinity_projects]                        // grouped view, everything on
[trinity_projects view="flat"]            // one flat list, no grouping
[trinity_projects summary="no"]           // hide the running-total bar
[trinity_projects voting="no"]            // hide voting
[trinity_projects comments="no"]          // hide the discussion threads
```

## Decisions made (change if you disagree)

- **Statuses** follow the brief exactly, with **On hold** added because works
  stall waiting on the managing agent or funds.
- **Seeded costs are blank.** No quotes were in when the list was compiled, so
  the tracker honestly shows "Awaiting quote" and a £0 total. Fabricating
  figures would mislead residents. Enter real numbers as they arrive.
- **Seeded priorities and statuses** are a sensible starting point (CCTV urgent
  and arranging quote; front door quoted; lighting arranging quote; fire and
  bin-store items high). The board can re-rank; resident votes are there to
  guide that.
- **Voting is not identity-proof for anonymous visitors** (cookie-based). For a
  38-flat building that is enough. If the site becomes login-gated (see
  `SCOPE.md` §4), votes tie to resident accounts and become robust.
- **Comments respect the not-official boundary.** The disclaimer renders under
  every list: this tracker is for visibility and informal input, not the
  official reporting channel.

## Quote documents: a privacy caveat worth knowing

Files in the WordPress media library have public URLs. Anyone with the link can
open an attached quote even if the tracker page itself is login-gated, and the
file can be indexed by search engines. For most quotes that is fine, and it is
what "everyone can read the actual quote" asks for. If a particular quote holds
contractor pricing the RTM would rather not have fully public, either keep it
off the site, or move to a protected-download setup once the site is
login-gated (serve files through PHP behind an auth check rather than as raw
media URLs). The XLS and PDF exports only record whether a quote is on file,
not its contents, so they do not leak anything.

## Notes for a future build

- The tracker assumes the site may later be login-gated. Nothing here breaks if
  it is; voting and comments simply get more robust.
- Project comments are kept out of site-wide comment queries (recent-comments
  widget, feeds) so the "hidden inside the ticket" behaviour holds.
- Currency is GBP, whole pounds shown without decimals.
