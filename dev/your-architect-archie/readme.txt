=== Your Architect – Archie ===
Contributors: octobercomms
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 0.4.0
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

Scope: this is a scaffold. The Claude turn, pricing, project records, rate limiting
and the shortcode/Elementor front end are working; **Stripe** (payment gate +
Connect payouts), the **client portal / watermarked preview**, and the live
**Historic England** lookup are marked TODO for you to wire (model them on the
Hillcroft Garden Designer plugin).

== Setup ==

1. Install + activate.
2. Archie Projects → Settings → add your Claude API key (stored encrypted),
   notification email, ARB/company numbers, and rate limits.
3. Add `[archie]` (or the Elementor widget) to your homepage.
4. For payments/portal, add Stripe keys and implement the marked TODOs.

Mail should go via an SMTP/API plugin on shared hosting. Rate limits + the daily
token cap protect your Claude spend.

== Changelog ==

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
