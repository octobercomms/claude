=== Architourian Payment Links ===
Contributors: architourian
Tags: stripe, payments, payment link, invoicing, tours
Requires at least: 5.8
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 1.0.2
License: GPL-2.0-or-later

Generate Stripe payment links for tour balances from inside WordPress, with a QR code, a log, and paid/unpaid status tracking.

== Description ==

Create a Stripe payment link in seconds: type a customer name, a note and the
amount due, and the plugin generates a secure Stripe-hosted link you can copy,
QR-code or email. Because tour balances change, the amount is always typed in by
hand — nothing is hard-coded.

Features:

* Create a Stripe payment link for any amount (GBP, USD, EUR, AUD, CAD).
* Copy-to-clipboard and an on-screen QR code for each link.
* A log of every link created, with who/what/how much.
* Paid / Unpaid status pulled from Stripe on demand.
* Optionally closes a link automatically once it has been paid.
* Test and Live modes with separate secret keys.

No card details ever touch your site — customers pay on Stripe's hosted page.

== Installation ==

1. Install and activate the plugin.
2. Go to Payment Links → Settings and paste your Stripe secret key (test or live).
3. Choose your mode and default currency, then save.
4. Open Payment Links to create your first link.

== Changelog ==

= 1.0.2 =
* Fix the "no Stripe key set" warning rendering as unreadable white text inside
  the coloured header — notices now sit in the readable area below it.

= 1.0.1 =
* Friendlier "Take a payment" screen themed to match architourian.com — warm
  terracotta header, cream cards, serif headings and a green action button.

= 1.0.0 =
* Initial release.
