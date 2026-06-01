=== Hillcroft Garden Designer ===
Contributors: octobercomms
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.5.0
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

= 1.5.0 =
* Plan-first pipeline: a new "Plan" step generates a clean top-down garden plan from your sketch, photos and Claude's reading. Iterate it until the layout is right — the approved plan then becomes the primary reference for every render, so they follow the real layout instead of inventing one.
* Elevations: the render pack now includes scaled rear and side elevation drawings — proper measured guides for the garden alongside the plan.
* Render style: choose the look of the eye-level renders in Settings — Watercolour painting (default), Photorealistic, or Pencil & light wash. The watercolour cover and hand-drawn plan keep their own styles.

= 1.4.0 =
* Plant photos: each plant can have a picture. Fetch one automatically from Wikipedia by botanical name (free, properly-licensed), or pick one from the media library. The catalogue list shows a thumbnail on every row.
* Plant catalogue: click a row to expand it and see all the detail inline — no need to open Edit.
* Import CSV is now a single button that opens the file picker and imports as soon as you choose a file.
* Renamed the marked-up price column from "Sale" to "Retail".

= 1.3.4 =
* Loading feedback: slow actions (reading images, the Claude chat, composing the brief, generating renders or the render pack, uploads, imports, sending a proposal) now show a branded spinner overlay with a clear message and lock the page until they finish — so it's obvious something is happening and you can't double-click.
* Fix: "Could not parse a JSON response from Claude" — the reader now tolerates markdown-fenced and truncated responses and salvages the reading + questions, and the AI calls allow longer replies (4000 tokens) so big readings aren't cut off.

= 1.3.3 =
* Wizard: actions like uploading photos, reading images, saving the design or generating a render now keep you on the step you're on (previously they bounced back to Details).
* "Read sketch with Claude" is now "Read images with Claude" — it reads your sketch and your site photos together, so it understands the existing garden (levels, boundaries, existing plants) as well as the intended layout. Only your uploads are sent, never generated renders.

= 1.3.2 =
* Consultation capture now shows only the files you upload (sketches & photos) — generated concept renders and render-pack images no longer appear here; they live in their own steps.
* Bulk photo upload: select multiple photos at once on the Capture step to add them all in one go (with a tip to make it obvious).

= 1.3.1 =
* Renders & images: click any sketch, concept render or render-pack thumbnail to view it full-size in a lightbox (press Esc or click outside to close).

= 1.3.0 =
* Guided wizard: the project screen is now a step-by-step flow (Details → Capture → Design → Renders → Render pack → Pricing → Proposal → Keepsakes) with a progress stepper and Back/Next — one stage at a time.
* Claude chat in Capture: after reading the sketch, answer Claude's questions in a chat thread and it rewrites the design brief for you automatically — no more editing it by hand.
* Plant catalogue: Export CSV and Import CSV buttons (import adds new plants; columns match the export).
* Friendlier message when Gemini image generation needs billing enabled (instead of the raw Google error).
* Fix: the Forms Submissions and Analytics screens now keep the brand styling.

= 1.2.0 =
* Dashboard: replaced the build-progress checklist with a visual "How it works" workflow diagram — the eight-step journey (enquiry & booking → capture → Claude reads it → design & renders → render pack → pricing → proposal & portal → payment & keepsakes), each step linking to where it happens.

= 1.1.2 =
* Verifies the one-click auto-update pipeline end to end (no functional changes).

= 1.1.1 =
* Updates: added a "Test update connection" button under Settings → Updates that calls GitHub and reports exactly what's happening (token invalid, org approval needed, wrong scope, no matching release, or connected OK) — so a silent "no update shown" can be diagnosed instead of guessed.

= 1.1.0 =
* Example project: one click creates a complete, realistic demo ("Meli's Garden, Watford") so you can explore the whole journey — capture, AI reading, design, render pack, pricing and a draft proposal — before starting a real one. It uses branded placeholder images and makes no API calls (zero cost), and removes cleanly any time (it never touches your real data or catalogue plants).

= 1.0.0 =
* Plant book: a print-ready book (cover = the watercolour render, an intro from the design brief, then one page per plant from the project's quote with care notes) — open it and Save as PDF, or send to print.
* Proposal keepsake: a clean printable record of the proposal (renders, costs, schedule, terms).
* Seasonal film: an on-brand cinematic slideshow (Ken Burns + season crossfades + title card) of the render pack — openable from the client portal.
* The complete journey is now in place: capture → AI sketch-reading → design → concept renders → render pack → pricing → proposal → portal → e-sign → payments → keepsakes.

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
