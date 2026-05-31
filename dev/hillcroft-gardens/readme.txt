=== Hillcroft Garden Designer ===
Contributors: octobercomms
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.1.1
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

= 0.1.1 =
* Admin UI now uses the full content width (no longer boxed to 1100px); plant form spreads to three columns on wide screens.

= 0.1.0 =
* Foundation: admin shell, plant catalogue, cost banner, API-usage logging, GitHub self-updater.
