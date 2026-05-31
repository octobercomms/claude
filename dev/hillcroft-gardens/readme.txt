=== Hillcroft Garden Designer ===
Contributors: octobercomms
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.9.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

AI-powered garden design system for Hillcroft Gardens — consultation capture, plant catalogue, pricing, renders, proposals and payments.

== Description ==

Hillcroft Garden Designer turns the rough output of an on-site consultation into a polished,
priced, visualised design proposal — with the client able to review it interactively and pay
online. Built by October Comms.

This is the **foundation build (0.1.0)**. It establishes:

* Glossy, brand-styled admin (Cormorant Garamond + DM Sans, olive/charcoal/cream, pill buttons)
* The in-plugin **plant catalogue** database (add / edit / search / price)
* The persistent **cost & credits banner** and API-usage logging
* **One-click self-update** from the private GitHub repository

Later updates add lead capture & paid booking, Claude sketch reading, Gemini renders, the
pricing engine, client portal, milestone payments, the plant book and the seasonal film.
Because the self-updater is built in, every future version installs with one click from the
WordPress Updates screen.

== Installation ==

1. Install and activate the plugin (one time).
2. Go to **Hillcroft → Settings** and add your API keys, plus the GitHub repository and access
   token so the plugin can update itself.

== Changelog ==

= 0.9.0 =
* Render pack: generate a deliberate set of named garden views — aerial masterplan, watercolour hero, hand-drawn plan, and eye-level corner views (patio, border, focal point) — each anchored to the approved concept render so the whole set stays consistent.
* Seasonal variants (spring / summer / autumn / winter) for any view, and a real satellite image of the plot via Google Maps. "Generate full pack" makes the core set in one go.

= 0.8.0 =
* Proposals: turn a chosen Good/Better/Best quote into a sendable proposal with a deposit + milestone payment schedule, editable intro and terms, and a 30-day expiry.
* Client portal: a tokenised, brand-styled public page (no login) showing the renders, a client-friendly cost breakdown, the payment schedule and terms — the client e-signs to accept, then pays the deposit with an embedded Stripe card form. Internal margin is never shown.
* Milestone payments via Stripe, fulfilled by webhook; project status advances sent → viewed → accepted → deposit paid. Send the proposal link to the client by email from the project screen.

= 0.7.0 =
* Pricing engine: create Good / Better / Best quotes per project. Add plants straight from the catalogue (price snapshotted) plus custom material/labour/other lines.
* Full quote maths: materials + wastage % + labour (days × day rate) + contingency % + design fee + VAT, with a tidy headline total. Internal margin (cost vs price) shown to you, never the client.
* "Seed Better & Best from Good" auto-populates the upsell tiers. Pricing defaults (day rate, wastage, contingency, VAT, tier uplifts) configurable in Settings.

= 0.6.0 =
* Design & ideas: an editable design brief + render prompt on each project, with "Compose with Claude" to draft both from the sketch-reading and the designer's ideas.
* Concept renders: "Generate render" turns the prompt (anchored by the sketch as a reference image) into a photorealistic concept image via Google Gemini; press again to iterate, and delete ones you don't want. Per-image cost feeds the cost banner.
* Settings: choose the Gemini image model (default gemini-2.5-flash-image).

= 0.5.1 =
* Fix: the Forms Submissions and Analytics tabs returned "Sorry, you are not allowed to access this page." Pages stay registered (so they resolve); their sidebar links are hidden via CSS instead, with navigation via the Forms hub tabs.

= 0.5.0 =
* Consultation capture: upload hand-drawn sketches and site photos to a project (stored in the media library).
* Claude sketch-reading: "Read sketch with Claude" interprets the sketch, reads hand-written dimensions and annotations, and drafts clarifying questions to confirm the layout. Token cost feeds the cost banner.
* Settings: choose the Claude model (default Sonnet 4.6).

= 0.4.1 =
* Forms hub: the Submissions and Analytics tabs now keep the Designer menu and brand styling (they were losing the sidebar and looking like plain WordPress pages).
* Dashboard: the "API spend this month" card now stands out in bold brand yellow on a dark card.

= 0.4.0 =
* Bookings: public [hgd_booking] page with an availability slot picker and an embedded Stripe card form for the £200 consultation; paid bookings create a client + project and send an .ics invite.
* Google Calendar (personal Gmail) two-way sync — busy times block slots, paid bookings are written to the calendar. Connect under Settings.
* Admin Bookings list + "Upcoming consultations" on the dashboard.
* Forms: renamed from "October Forms" to just "Forms"; Submissions and Analytics are now tabs in a single Forms hub, and Forms sits in its proper place in the menu.

= 0.3.0 =
* Forms: a full multi-step form builder (ported from October Forms) — drag-drop builder, 18 field types, conditional logic, theming, file uploads, honeypot/rate-limit spam protection.
* Submissions viewer with CSV export, plus an analytics dashboard (views, starts, completions, funnel, conversion).
* Closed loop: a completed form automatically creates a client and an "enquiry" project.
* Embed a form with [hgd_form id="123"].

= 0.2.1 =
* Branded the admin menu with the Hillcroft monogram icon.

= 0.2.0 =
* Projects: full lifecycle management (lead → complete) with status filtering and search.
* Clients (CRM): client records with contact and address details, linked to projects.
* Lead capture: [hgd_enquiry] shortcode creates a client + project and emails a notification.
* Design: brand green/yellow palette added as status badges and accents.

= 0.1.4 =
* Updater: a manual "Check again" now forces a fresh look, and "no update found" is cached for 15 minutes instead of 6 hours — so new releases are detected promptly.

= 0.1.3 =
* Releases now publish automatically when a version bump is merged to main — no manual tag push needed. (Also includes the 0.1.2 "Designer" menu rename.)

= 0.1.2 =
* Renamed the admin menu item from "Hillcroft" to "Designer".

= 0.1.1 =
* Admin UI now uses the full content width (no longer boxed to 1100px); plant form spreads to three columns on wide screens.

= 0.1.0 =
* Foundation: admin shell, plant catalogue, cost banner, API-usage logging, GitHub self-updater.
