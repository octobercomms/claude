=== Architourian WordPress Integration ===
Contributors: octobercommunications
Tags: api, rest, tours, claude, ai
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPL-2.0-or-later

Secure REST API for managing tours and content via Claude AI, with JetEngine/Crocoblock field auto-discovery.

== Description ==

Provides a secure REST API at /wp-json/architourian/v1/ that lets external
tools (such as Claude via the included MCP server) list, create, update and
delete tours and other content on the site.

Features:

* API key authentication with permission levels (read/write/admin)
* Tour CRUD operations with full meta field support
* Auto-discovers JetEngine and ACF custom fields
* Semantic field mapping (tour date, availability, capacity, price, location)
* General content (pages/posts) read and update
* Audit log of all API activity
* Rate limiting (60 req/min per key)
* Optional HTTPS enforcement and IP allowlist
* Self-update from GitHub Releases

== Installation ==

1. Upload the plugin folder to /wp-content/plugins/ or install via the zip.
2. Activate the plugin through the Plugins menu.
3. Go to Settings > Architourian API.
4. Generate an API key and select the tour post type.

== Frequently Asked Questions ==

= Which post types does it support? =

Any registered public post type, including JetEngine custom post types.

= Do I need JetEngine? =

No. The plugin works with standard WordPress meta and ACF fields too.
JetEngine support auto-activates when JetEngine is installed.

= Is the API secure? =

Keys are hashed before storage. The raw key is shown once on generation.
HTTPS enforcement and IP allowlisting are available as extra layers.

== Changelog ==

= 1.0.0 =
* Initial release
* REST API for tours and content
* API key auth with permission levels
* JetEngine and ACF field discovery
* Audit logging
* MCP server for Claude Desktop
