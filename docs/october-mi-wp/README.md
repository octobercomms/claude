# October Marketing Intelligence — WordPress plugin

`october-mi-wp` is **Surface 1** of the October Marketing Intelligence (OMI)
platform — the WordPress/WooCommerce plugin a client installs on their site.

- **Code:** `dev/october-mi-wp/`
- **Plugin slug:** `october-marketing-intelligence`
- **Text domain:** `october-mi`
- **Release tags:** `omi-wp-v<version>` (built by a GitHub Action into a release
  zip the plugin's self-updater installs)

## Why reverse the data direction

The obvious design — the platform polling the client's WooCommerce/WP REST API —
fails in practice. Web application firewalls (Cloudflare, Sucuri, Wordfence and
friends) treat unattended inbound API traffic as suspicious and frequently return
an **HTML 401 challenge page** instead of JSON, which the platform cannot parse.

This plugin **reverses the direction**. The WordPress site initiates every
connection: it makes **outbound HTTPS** requests to
`https://platform.octobercomms.com/api/wp-connect/...`. Server-initiated egress
is never WAF-challenged, so the data flows reliably regardless of the client's
firewall.

The only inbound surface is one narrowly-scoped REST route used to receive a
*draft* post from the platform (see "Inbound pull" below).

## Install

1. Build a zip (`bin/build-zip.sh`) or download a release asset, then upload it
   under **Plugins → Add New → Upload Plugin**. Activate it.
2. Go to **Tools → October Marketing Intelligence**.
3. Paste the **24-character pairing token** from the October dashboard and click
   **Connect**.
4. (Optional) Paste a GitHub fine-grained token (Contents: read on
   `octobercomms/claude`) under "Automatic updates" so the plugin can update
   itself, then use **Test update connection** to confirm.

## Pairing

On **Connect**, the plugin makes one outbound, blocking
`POST /api/wp-connect/pair` with the token. The platform responds with
`{ client_id, refresh_secret, client_name? }`. The plugin:

- stores `client_id` (the platform's id for this site),
- stores `refresh_secret` **encrypted at rest** (AES-256-CBC + HMAC, keyed from
  the site's WordPress salts — see `class-octobermi-crypto.php`),
- records `connected_at` (the push cut-off — no historic backfill), and
- flips the UI to connected.

The pairing token is single-use and is never stored after a successful exchange.
**Reset connection** wipes all connection state.

## What it pushes (outbound)

Event hooks fire only after pairing. Each handler gracefully no-ops if the
relevant plugin is inactive. Endpoints (all under
`/api/wp-connect/`):

| Trigger | Endpoint |
|---|---|
| Order placed / updated / refunded | `orders` |
| Customer created / updated | `customers` |
| Product created / updated / deleted | `products` |
| Inventory change | `inventory` |
| Post / page published or updated (`save_post`) | `content` |
| Yoast / Rank Math SEO score on save | `seo` |
| Gravity Forms / Contact Form 7 submission | `form-submission` |

Sends are **non-blocking** (fire-and-forget, ~5s timeout) so a hook never slows a
checkout or a save. Pairing uses a blocking call with a small retry. All sending
and signing is centralised in `OctoberMI_Client::send()`.

## What it pulls (inbound)

A single REST route lets the platform push a draft back:

```
POST /wp-json/october-mi/v1/draft
Authorization: Bearer <refresh_secret>
```

It creates a WordPress **draft** (never a live post — even a leaked secret cannot
publish) and returns the new post id and edit link. This bypasses `wp/v2/posts`
deliberately. See `API.md` for the full contract.

## The HMAC scheme + headers

Every outbound push carries:

| Header | Value |
|---|---|
| `X-Signature` | hex `HMAC-SHA256(raw_body, refresh_secret)` |
| `X-Timestamp` | Unix seconds at send time (lets the platform reject replays) |
| `X-OMI-Client` | the `client_id` issued at pairing |
| `X-OMI-Version` | the plugin version |
| `Content-Type` | `application/json` |

The platform recomputes the HMAC over the exact raw body and compares it (constant
time) against `X-Signature`, checks `X-Timestamp` is within an acceptable window,
and looks up the secret by `X-OMI-Client`.

## Admin UI

**Tools → October Marketing Intelligence** shows:

- "Connected to: [client name]"
- Last sync (relative time)
- Events this month / all time
- **Reset connection** button
- A log viewer of the **last 50 outbound calls** (event, endpoint, HTTP status,
  any error note), with a "Clear log" button
- Automatic-updates token field + "Test update connection"

## File layout

```
dev/october-mi-wp/
  october-marketing-intelligence.php   main plugin file (header, constants, bootstrap)
  readme.txt                           WP-style manifest (Stable tag)
  uninstall.php                        removes options on delete
  includes/
    class-octobermi-log.php            error log + rolling outbound log
    class-octobermi-crypto.php         secret-at-rest encryption
    class-octobermi-settings.php       connection state + settings store
    class-octobermi-activator.php      activation/deactivation
    class-octobermi-client.php         the sign + send transport (HMAC)
    class-octobermi-pairing.php        token exchange
    class-octobermi-events.php         Woo + WP event listeners
    class-octobermi-rest.php           inbound draft-publish route
    class-octobermi-updater.php        GitHub-release self-updater
  admin/
    class-octobermi-admin.php          menu, asset loading, form handlers
    views/settings.php                 the settings/status page
    css/admin.css
  bin/build-zip.sh                     packages an installable zip
```

The release workflow lives at repo-root
`.github/workflows/october-mi-wp-release.yml` (mirroring where Hillcroft's lives).
