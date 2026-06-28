=== October Events ===
Contributors: octobercomms
Requires at least: 6.0
Requires PHP: 7.4
Stable tag: 1.66.10
License: GPL-2.0-or-later

Consolidated operations platform for the Atlanta Design Festival: accounts,
listings (directory, destinations, products, events, stories), submission
and approval, Stripe payments, native email on Amazon SES (contacts,
campaigns, a Claude co-pilot), ticketing, volunteer opportunities with shift
signups and reminders, and an AI Stories editorial connector. (Ads are handled
by the standalone oc-ad-manager plugin.)

Full documentation lives in the repository at docs/october-events/README.md.

== Configuration ==

Add these constants to wp-config.php (never stored in the database):

  define('OE_STRIPE_SECRET_KEY', '...');
  define('OE_STRIPE_PUBLISHABLE_KEY', '...');
  define('OE_STRIPE_WEBHOOK_SECRET', '...');
  define('OE_BREVO_API_KEY', '...');
  define('OE_CLAUDE_API_KEY', '...');
  define('OE_GOOGLE_MAPS_KEY', '...');

Then run `composer install` inside the plugin folder to pull the Stripe PHP SDK.
