=== October Proposals ===
Contributors: octobercomms
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 0.4.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Generate October's client proposals as an on-brand web page (video + animated
process + accept/e-sign/pay) and a matching downloadable PDF, from one source —
built as a wizard.

== Description ==

October Proposals is an in-house tool for octobercomms.com. It builds each
proposal from a reusable block library plus a pricing page, then publishes it as
a standalone on-brand web page and a print-ready PDF.

This is the foundation build. It establishes the installable, self-updating
plugin: database schema, settings (OMI design tokens, company details,
integration keys) and the admin shell. Feature builds add the block library and
CRM, the proposal wizard and pricing builder, the public portal with terms
e-sign, the mPDF PDF, payments (GoCardless + Stripe) with a client-controlled
pause, and the analytics + Claude layer.

== Updates ==

Installed once, updated in place. A GitHub Action publishes a release
(`ocp-v<version>`) whenever a new version lands on `main`; the built-in
self-updater surfaces it on the WordPress Updates screen. Add a fine-grained
GitHub token (Contents: read) under Proposals → Settings to enable updates.

== Changelog ==

= 0.4.0 =
* Public client portal: standalone OMI-styled page at ?ocp_proposal=<token>,
  rendering cover → intro → situation → proof → process (animated Plan of Work)
  → investment → terms/accept, with Loom embeds and view tracking.
* Versioned Terms with an admin editor; proposals snapshot the version at send.
* Accept & e-sign (agree + signature) with an audit trail (name, email, time,
  IP, UA, terms version, document hash) and an emailed record to client + studio.
* First-party engagement events (section views, video intent, CTA) + optional
  Microsoft Clarity embed.

= 0.3.0 =
* Proposal model (token-addressable, status lifecycle, sections, pricing line
  items with cadence/stage and currency/VAT-aware totals).
* Stepped wizard: details → content → proof (auto-filtered by sector) →
  pricing builder → review & publish, with a private portal link and mark-as-sent.

= 0.2.0 =
* Reusable content library (case studies with sector/service tags, testimonials,
  services, awards, showcase clients) with a generic admin.
* CRM pipeline modelled on the Sales Leads Tracker — board by stage, lead
  add/edit, and a CSV importer that maps tracker statuses to the pipeline.
* Proposal-type presets (retainer, website, event) and shared section/cadence
  vocabulary for the wizard and renderer.

= 0.1.0 =
* Foundation: plugin scaffold, full database schema, OMI-tokened settings,
  admin shell, and the GitHub-powered self-updater + release workflow.
