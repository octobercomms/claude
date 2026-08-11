=== Your Architect – Archie ===
Contributors: octobercomms
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 0.5.0
License: GPLv2 or later

Archie — the conversational, fixed-price project builder for Your Architect. A
two-panel AI assistant (embeddable with [archie] or the Elementor widget) that
builds a homeowner's drawing package and price through a short chat, opens a
project record, and gates the full drawings behind payment.

== Description ==

Drop `[archie]` onto any page (or use the "Archie" Elementor widget). Archie asks
a few plain-English questions; the panel builds the package and a fixed price as
the visitor answers. The server owns the conversation and the pricing — Claude
never states a price. A project record is created from the first message (cookie),
so a returning visitor resumes.

Full studio workflow: a submitted project is approved, the client gets a
Claude-drafted confirmation email, pays via an embedded Stripe Payment Element on
a token-gated portal, and their drawings unlock there (served blurred + watermarked
until paid). Analytics track the funnel + revenue. Only the live **Historic England**
lookup and optional **Stripe Connect** payouts remain to wire.

== Setup ==

1. Install + activate (creates the tables and the "Your project" portal page).
2. Archie Projects → Settings → Claude API key; Stripe secret/publishable +
   webhook secret; Brevo API key + from name/address; portal page; rate limits.
3. Add `[archie]` (or the Elementor widget) to your homepage.
4. Point a Stripe webhook at `/wp-json/yaa/v1/stripe-webhook` (and, for tracking,
   a Brevo webhook at `/wp-json/yaa/v1/brevo-webhook`).

Mail should go via Brevo or an SMTP plugin. Rate limits + the daily token cap
protect your Claude spend. On Nginx, add a deny rule for `uploads/yaa-secure/`.

== Changelog ==

= 0.5.0 =
* New pricing model: a SERVICE MENU instead of two fixed packages. Archie asks
  which service you need (pre-planning £450, full planning £690, building regs
  £900, listed consent £550, permitted development / lawful development £450,
  change of use £450, retrospective £450, new dwellings on request) and builds
  your total additively — no more "select to remove" items.
* Editable in the admin: a new "Archie → Pricing & Services" screen where you
  can edit every service, add-on, price, delivery/validity, phone, booking link
  and a couple of canned replies. Archie and the price panel follow it live — no
  code changes needed to update pricing.
* Add-ons Archie asks about and adds: submit & manage the application (+£100,
  planning only), 3D visualisation (+£250), site visit (London/M25, +£350).
* Survey question simplified to "Do you have existing plans drawn up?"; if not,
  Archie reassures we'll arrange a trusted independent surveyor. Structural
  "not sure" now gets a warm, editable reply.
* An "I'm not sure — I need advice" path, plus a phone number and optional
  15-minute-call booking link.

= 0.4.9 =
* Correct legal entity to Tiam Architects LLP (was "Ltd") across Archie, the
  emails and the site footer, and fill in the real registration details:
  ARB 091365K & 091921G, Company no. OC437815.

= 0.4.8 =
* A partial submission is now only recorded once someone actually starts the chat
  (their first message), not every time the page loads. Simply opening or
  refreshing the page no longer creates an empty "Anonymous / 0/5 / £0" row — the
  greeting is shown without saving anything, and the project is created on the
  first real answer. This keeps the funnel counts honest.
* Bulk delete in Archie Projects: tick the checkbox on any rows (or the header
  checkbox to select the whole list) and "Delete selected" removes them and all
  of their data in one go. The single-row trash button still works too.

= 0.4.7 =
* Submission emails are now branded to match the Archie site (navy header, the
  Your Architect wordmark, clean card layout) instead of plain text.
* The studio notification comes from "Your Architect Submission"
  &lt;noreply@yourarchitect.uk&gt; with the subject "New Project | &lt;name&gt;" (falls
  back to the postcode or reference when no name was given), and carries the full
  project: the fixed-price total, reference, submitted/started times, contact, every
  question and answer, the priced package breakdown with delivery/revision/validity
  notes, any London/listed/conservation flags, and a button to open it in the admin.
  Reply goes straight to the client when we have their address.
* When we captured the visitor's email, they now also receive a branded confirmation
  summarising what they told Archie, their fixed price, and what happens next.

= 0.4.6 =
* You can now delete submissions/projects from the admin — a trash button on each
  row and a Delete button on the detail page (both with a confirm). Deleting
  removes the record and everything attached to it (events, drafted emails, and
  any uploaded files, including the originals on disk).
* Terminology: only a submitted entry (one with a reference) is called a
  "Project" now. Everyone who started but didn't submit is a "partial submission".
  The dashboard tiles read All submissions / Partial submissions / Projects
  (submitted) / Conversion rate.

= 0.4.5 =
* Email is now properly captured. Archie asks for it as "so I can email you your
  quote and the team can get back to you" (not an optional "save & come back"),
  and the chat only completes once a valid email is given.
* Save & submit now requires a contact email: if you submit without one, Archie
  asks for it in the chat and finishes the submission automatically once you reply
  — so no project can be opened with no way to contact the client.

= 0.4.4 =
* Taller chat: the embedded builder now fills 90vh of the viewport (min 560px) so
  more of the conversation and package are visible without scrolling.

= 0.4.3 =
* Quick-reply chips are reliable again: the server now derives suggested answers
  deterministically from the next unanswered question (`suggested_options()`), so
  tappable options appear every turn even when the model doesn't return its own —
  and you can still type a free-text answer instead.
* Restored the photo/file upload in the chat: tap the camera in the composer to add
  a photo, sketch or PDF of the property. Files are stored against the project in the
  protected `uploads/yaa-secure/` area via a new nonce-checked /upload endpoint, and
  Archie confirms receipt in the conversation.
* New Archie face: the avatar is now the blue hand-drawn Archie portrait (PNG) across
  the chat header and message bubbles.

= 0.4.2 =
* Fix "Sorry — something went wrong" on the first message when the site is page-cached
  (StackCache) or behind a CDN: the REST nonce localised into the page could be stale
  or its custom header stripped, failing the nonce check. Archie now takes a fresh
  nonce from the (uncached) /start call and also sends it in the request body, so
  writes work regardless of caching. Bad-nonce responses now return a clear message.
* Theme: when this plugin is active, the archlie theme no longer registers its legacy
  archlie_project CPT + AJAX intake — removes the duplicate "Your Architect Projects"
  admin menu. The theme's own project store only runs standalone.

= 0.4.1 =
* File security hardening for the live server: all project files (drawings + docs)
  are now stored in a protected uploads/yaa-secure/ directory (deny-all .htaccess
  + web.config + index.php) instead of the public media library, and served only
  through the token + payment-checked endpoint. Removes the guessable-URL bypass.
  (Nginx: add a deny rule for that path — .htaccess is Apache/LiteSpeed only.)

= 0.4.0 =
* Studio workflow, end to end. A submitted project can now be driven all the way
  to paid + delivered inside the Archie Projects admin.
* Approve → Claude drafts a warm "good to go" confirmation email → Tiam edit the
  subject/body → send. Sending goes via Brevo's transactional API (open/click
  tracking through its webhook) when a key is set, else wp_mail with a tracking
  pixel + click redirect. Email opens/clicks show on the project.
* Client portal ([archie_portal], token-gated, auto-created on activation): the
  confirmed project + fixed price, an embedded Stripe Payment Element while
  unpaid, a receipt once paid, the client's uploads, and Tiam's files.
* Payments: server-side PaymentIntent, embedded Payment Element on the portal,
  and a signature-verified Stripe webhook that marks the project paid and unlocks
  the drawings (idempotent).
* Drawings paywall: Tiam upload drawings + third-party documents in the admin;
  until paid, drawings are served as server-generated blurred + watermarked
  previews (images) or locked placeholders, with originals streamed only through
  a token + payment-checked endpoint. Third-party docs note "paid direct to the
  provider, not Tiam".
* Analytics dashboard with date-range toggles (7 / 30 / 90 / all): revenue, paid
  count, avg value, the started→submitted→approved→paid funnel, revenue-over-time,
  add-on attach rates, and London / listed / conservation splits.
* New settings: Brevo API key, from name/address, Stripe webhook secret, portal
  page. New tables: yaa_emails, yaa_files (schema v2).

= 0.3.0 =
* Project side moved from a CPT + postmeta to custom tables (YAA_DB): a
  yaa_projects row per visitor with a status state-machine and denormalised
  columns, plus a yaa_events audit/funnel log. Foundations for the studio
  workflow (approve → email → payment → portal → analytics).
* New branded "Archie Projects" admin: headline funnel stats, Started /
  Submitted / RIBA / Abandoned tabs, and a per-project detail view that shows
  the collected answers as a form (with "stopped at: …") so you can see where
  people abandon — alongside the package, an activity timeline and the full
  conversation. Styled to match the site.
* Theme/plugin separation: the archlie theme now renders the [archie] shortcode
  when the plugin is active (and stands its own scripted demo down), so the
  theme can be rebuilt or swapped without touching Archie.
* Follow-up cron + submit notifications rewritten onto the new tables.

= 0.2.0 =
* Archie is now a helpful guide, not a form-filler. Every question is written to be
  answerable by someone with no knowledge of planning or architecture, defines its
  jargon, and offers an "I'm not sure — explain this" path that explains the term in
  plain English and re-asks.
* Tap-or-type quick replies: Archie proposes short answer buttons each turn (via the
  set_fields `replies` field) rendered under the composer, while the text box stays
  open so people can tap an option OR type their own.
* Location-aware questions: the address lookup now also flags conservation areas
  (alongside listed buildings and London/M25), and what we know about the property is
  fed into Archie each turn so he asks intelligent, reassuring follow-ups.

= 0.1.0 =
* Initial scaffold: Claude proxy (tool-use field extraction), server-side pricing
  + package builder, project CPT with cookie session, REST API, [archie] shortcode
  + Elementor widget, encrypted secrets, rate limiting, admin settings, follow-up
  cron, and Stripe/portal/Historic-England stubs.
