=== ADF Festival ===
Contributors: octobercomms
Requires at least: 6.0
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPL-2.0-or-later

Consolidated operations platform for the Atlanta Design Festival: accounts,
listings (directory, destinations, products, events, stories, ads), submission
and approval, Stripe payments, Brevo email + SMS, ticketing, volunteer
opportunities with shift signups and reminders, and an AI Stories editorial
connector.

Full documentation lives in the repository at docs/adf-festival/README.md.

== Configuration ==

Add these constants to wp-config.php (never stored in the database):

  define('ADF_STRIPE_SECRET_KEY', '...');
  define('ADF_STRIPE_PUBLISHABLE_KEY', '...');
  define('ADF_STRIPE_WEBHOOK_SECRET', '...');
  define('ADF_BREVO_API_KEY', '...');
  define('ADF_CLAUDE_API_KEY', '...');
  define('ADF_GOOGLE_MAPS_KEY', '...');

Then run `composer install` inside the plugin folder to pull the Stripe PHP SDK.
