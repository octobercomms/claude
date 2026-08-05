=== October Marketing Platform ===
Contributors: octobercomms
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.2.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

The October Marketing Platform on your site: a modular plugin whose capabilities you switch on as needed — starting with Blog Autopilot. Runs standalone with your own Claude key, or connect to the platform for central oversight.

== Description ==

October Marketing Intelligence links your store to the October platform. Instead of
the platform polling your WooCommerce/WordPress REST API (which web application
firewalls such as Cloudflare or Sucuri routinely challenge), **your site initiates
every connection**. Server-initiated outbound HTTPS is never WAF-challenged, so the
data flows reliably.

Once paired with a one-time token, the plugin pushes:

* Orders placed, updated and refunded
* Customers created and updated
* Products created, updated and deleted
* Inventory changes
* Posts and pages published or updated
* Yoast / Rank Math SEO scores on save
* Gravity Forms and Contact Form 7 submissions

Every payload is JSON, signed with HMAC-SHA256 over the body and sent with the
client identifier and a timestamp, so the platform can verify authenticity and
reject replays.

The platform can also send a draft back: a single, narrowly-scoped REST route
creates a WordPress *draft* (never a live post) for you to review.

Built by October.

== Installation ==

1. Install and activate the plugin.
2. Go to **Tools → October Marketing Intelligence**.
3. Paste the 24-character pairing token from your October dashboard and click
   **Connect**.
4. (Optional) Add a GitHub update token so the plugin can update itself.

== Changelog ==

= 1.0.0 =
* First release. Outbound, firewall-friendly connection to the October Marketing
  Intelligence platform: one-time token pairing; HMAC-signed pushes for orders,
  customers, products, inventory, content, SEO scores and form submissions; an
  inbound draft-publish route; an activity log of the last 50 outbound calls; and
  a built-in one-click self-updater.
