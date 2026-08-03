=== Your Architect – Archie ===
Contributors: octobercomms
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 0.1.0
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

= 0.1.0 =
* Initial scaffold: Claude proxy (tool-use field extraction), server-side pricing
  + package builder, project CPT with cookie session, REST API, [archie] shortcode
  + Elementor widget, encrypted secrets, rate limiting, admin settings, follow-up
  cron, and Stripe/portal/Historic-England stubs.
