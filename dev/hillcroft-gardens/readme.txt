=== Hillcroft Garden Designer ===
Contributors: octobercomms
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.17.0
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

= 1.17.0 =
* Stored secrets are now encrypted at rest. Your API keys (Claude, Gemini, Flux, Google Maps, Plant.id), the Stripe secret + webhook secret, the GitHub update token and the Google OAuth secrets are encrypted (AES-256 with an integrity check, keyed from your site's WordPress security salts) before being written to the database — so a database dump or stray backup no longer exposes live credentials in plaintext. Existing keys are migrated automatically on update, and nothing changes in how you enter or use them. Note: if your site's salts in wp-config.php are ever regenerated, the stored keys can't be decrypted and will need re-entering in Settings.

= 1.16.0 =
* Smarter plant-catalogue CSV import: re-importing no longer creates duplicates. Rows that match an existing plant on **botanical name + pot size** now update that plant; everything else is added. The confirmation tells you how many were added vs. updated. So you can export, tweak prices/stock in a spreadsheet, and re-import to refresh the whole catalogue in one go.

= 1.15.0 =
* Automatic client follow-ups (Settings → Client follow-ups) — a once-daily job that sends gentle, client-facing reminder emails so warm leads and sent proposals don't go cold. Three reminders, each individually toggleable with its own day threshold: a nudge to enquiries that haven't booked a consultation after N days; a reminder on proposals that are still unanswered after N days; and a final nudge when a proposal is about to expire. Each reminder is sent at most once per record (tracked internally), so the daily run is safe. The whole feature is **off by default** — turn it on when you're ready, and set the booking-page URL used in lead-nudge emails. This completes brief item #11 (the reporting half shipped in 1.14.0).

= 1.14.0 =
* New **Reports** screen (Designer → Reports): your business at a glance, built from the records the plugin already keeps. Collected revenue for this month / this year / all time (paid consultations + paid design milestones), recurring income from maintenance plans (MRR, annualised ARR, active plans, new sign-ups this month), the open sales pipeline (proposal value by stage), projects by status, and a lead → consultation → proposal → won funnel. Read-only and figures come from local data, so no extra cost and nothing to configure. (Follow-up automation — reminder emails for un-booked leads and ageing proposals — is the planned next step.)

= 1.13.0 =
* Subscriber self-service for maintenance plans, via Stripe's secure Customer Portal — no client login needed. Customers can update their card, view and download invoices, and cancel, all on Stripe's hosted pages. After signing up they get a "Manage your plan" link on the confirmation screen, and returning customers can use the new [hgd_manage_plan] block: they enter their email and we send a secure one-time link (the response is deliberately neutral so it never reveals whether an email has a plan). The Maintenance Plans admin screen also gains a "Manage link" per subscriber, so you can open or send a customer their billing portal directly. (One-time setup: activate the Customer Portal in your Stripe dashboard, test and live.)

= 1.12.0 =
* Recurring garden maintenance plans, billed by Stripe — no paid WooCommerce Subscriptions extension required. Three monthly care plans (Essential / Full / Premium) are offered through a new on-brand sign-up block: drop [hgd_maintenance_plans] on any page and clients pick a plan, enter their details, and complete sign-up on Stripe's secure hosted Checkout. Stripe Billing then owns the recurring monthly charge, card authentication (SCA/3DS), automatic retries on a failed payment, and the dunning reminder emails — all configured in your Stripe dashboard, at no extra cost.
* Each successful monthly payment is mirrored into a completed WooCommerce order, so Woo stays your system of record and sends its proper receipt, and the customer is created/linked in the CRM on the first payment. A new "Maintenance Plans" admin screen lists every subscriber with plan, status (active / payment failed / cancelled), amount and next bill date, and lets you cancel a plan at the end of its billing period. Tip: to avoid duplicate receipts, turn off Stripe's own email receipts in the Stripe dashboard and let WooCommerce send them.

= 1.11.0 =
* WooCommerce checkout for proposal payments: when a client accepts a proposal and pays the deposit from their portal, the payment now goes through WooCommerce checkout — so WooCommerce sends its proper order receipt (with your store's receipt settings/VAT), the same as the consultation. The Good/Better/Best pricing and the deposit/milestone schedule are unchanged; only the payment + receipt move to Woo. Each milestone becomes a Woo order line ("Deposit on signing — <project>") on a hidden "Garden design service" product. On payment the proposal/project advance exactly as before, and the duplicate plain-text receipt is suppressed so the client only gets Woo's. (If WooCommerce isn't active, the previous built-in Stripe card form still works.)

= 1.10.0 =
* WooCommerce checkout for the consultation: the £200 consultation is now a WooCommerce product, and booking it sends the client to WooCommerce checkout — so payment is taken by your normal Woo payment gateway and WooCommerce sends its proper order confirmation / receipt email (with your configured receipt settings, VAT, etc.). When the order is paid, the booking is fulfilled exactly as before: client + project created, Google Calendar event written, and the calendar invite sent. The consultation product price stays in step with the fee in Settings automatically. (If WooCommerce ever isn't active, the previous built-in Stripe card form still works as a fallback, and an admin notice prompts you to activate WooCommerce.)
* Groundwork for selling the design services and monthly subscriptions through WooCommerce too (coming next).

= 1.9.0 =
* Render scorecard: a "Check against brief" button on each concept render asks Claude to compare the image against the design brief, the site reading and the captured measurements, and returns a 0–100 match score with what it gets right and — crucially — what's off, missing or invented. A low score opens its scorecard automatically, so a render that ignored the brief is caught before the client ever sees it.
* Approval gate: mark your chosen render as "Approved", and only that render is used as the reference for the render pack and the proposal (previously it was always the most recent one). Approving one render clears approval from the others, so there's always a single, deliberate "hero" image driving the deliverables.

= 1.8.0 =
* Structural render engine (optional): a second render engine — Flux + ControlNet via fal.ai — that uses your approved plan as a *structural guide*, so the render follows the exact layout (bed shapes, paths and structures land where the plan puts them) rather than re-interpreting it. It's entirely optional and off until you add a fal.ai key under Settings; the button on the Renders step degrades gracefully without one. Add your key (and, if you like, a different fal.ai model) under Settings → API keys / AI. Per-image cost feeds the cost banner.

= 1.7.0 =
* Design into a site photo: a new render mode on the Renders step that generates the scheme straight onto one of the client's real site photos — keeping the same camera viewpoint, the house, fences and boundaries, ground levels and sky, and redesigning only the garden within the frame. It's the most convincing "after" you can show a client, because it's unmistakably *their* garden. Pick any uploaded photo, press "Design into this photo", and the result joins your concept renders.
* The photo render uses the design/render prompt, the chosen photo as the in-place edit base, your approved plan as a layout guide (when present), and the captured measurements as a scale reference — so it stays true to the real space.

= 1.6.0 =
* Measurements & site plan: a new panel on the Capture step where Donna records the garden's real dimensions — plot width × length, plus a repeatable table of zones (lawn, border, patio, path, water, structure) with their sizes and areas. Areas auto-calculate from width × length, and a running total warns (in amber) if the zones add up to more than the plot, so obvious measurement slips get caught.
* Draw-on-plan tool: a built-in canvas measuring tool — set the scale by drawing a line over a known distance, then draw rectangles to mark out zones and read their real-world areas straight off the satellite view (or a plain grid). Shapes are saved with the project and reload for editing.
* Accurate by the numbers: the measured plot size and zone areas now feed directly into the Plan prompt (so the top-down plan is drawn to true dimensions and proportions) and into every render's prompt as a scale reference — a big step towards renders that match the real garden rather than inventing a layout.
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
