=== October Popups ===
Contributors: octobercomms
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Lightweight, occasional-use popups — competitions, announcements, offers — whose content you build with WP Bakery or Elementor.

== Description ==

October Popups is a deliberately small popup plugin for sites that only need a
popup now and then (a competition, a seasonal offer, an announcement). It gets
out of the way of your page builder: each popup is a normal post whose body you
design with the **same builder you already use** — WP Bakery or Elementor — so
you can drop in images, text, buttons and forms exactly as you would on a page.

Everything else — when it appears, how often, on which pages, and how it looks —
lives in a simple "Popup Settings" panel next to the editor.

= Triggers =

* Immediately on page load
* After a time delay
* At a scroll depth (%)
* On exit intent (desktop)
* After a period of inactivity
* When a visitor clicks any element matching a CSS selector
* Manual only — opened from a link/button or shortcode

= Frequency & scheduling =

* Every view, once per session, once every N days, or once ever
* Optional start and end dates — ideal for time-boxed competitions

= Targeting =

* Everywhere, homepage only, only on selected pages, or everywhere except selected
* All devices / desktop only / mobile only
* Everyone / logged-in only / logged-out only

= Appearance =

* Centre modal, top bar, bottom bar, or slide-in corner
* Fade / slide / zoom / no animation
* Overlay (with custom colour), close button, click-outside and Escape to close
* Optional delay before the close button appears

= Tracking =

Each popup records impressions and call-to-action clicks (add the class
`ocpop-cta` to a link inside the popup). Counts show in the Popups list. No
personal data is stored.

= Self-updating =

Under **Popups → Settings**, paste a GitHub fine-grained token with
"Contents: read" on the plugin repository. New releases then appear on the
WordPress Updates screen for one-click install.

== Installation ==

1. Upload the plugin and activate it.
2. Go to **Popups → Add New**.
3. Give it a title, then build the body with WP Bakery / Elementor as usual.
4. Set the trigger and targeting in the **Popup Settings** panel.
5. Tick "Popup is enabled" and Publish.

= Enabling the builder on popups (one-time) =

**WP Bakery:** go to *WPBakery Page Builder → Role Manager → Post types* and
tick "Popup" so the "Backend/Frontend Editor" buttons appear on popups.

**Elementor:** the Popup post type is added to Elementor's supported types
automatically. If the "Edit with Elementor" button is missing, enable it under
*Elementor → Settings → General → Post Types*.

== Frequently Asked Questions ==

= How do I open a popup from my own button? =

Add the CSS class `ocpop-open-<ID>` to any link or button (the ID is shown in
the "How to use" box when editing the popup). Or use the shortcode:
`[october_popup id="123" text="Enter now"]`.

= Does it work with page caching? =

Yes. Targeting by page is decided server-side; frequency caps and device rules
are enforced in the browser, so a cached page still behaves correctly.

== Changelog ==

= 1.0.1 =
* Fix: popups never appeared on the frontend because the trigger script ran
  before the popup markup/config were printed in the footer. The script now
  waits for the DOM to finish loading.

= 1.0.0 =
* Initial release: WP Bakery / Elementor popup bodies, seven trigger types,
  frequency caps, scheduling, page/device/visitor targeting, five positions,
  impression + CTA tracking, and the October self-updater.
