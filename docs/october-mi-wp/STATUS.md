# October Marketing Intelligence (WP plugin) — status / TODO

**Surface:** 1 of N — the WordPress/WooCommerce connector plugin.
**Version:** 1.0.0 (first release).

## In scope for v1 (done)

- Mirrors the Hillcroft Garden Designer plugin structure: main file + header,
  `includes/`, `admin/`, `uninstall.php`, `bin/build-zip.sh`, and a repo-root
  GitHub Action release workflow (tag prefix `omi-wp-v`).
- Self-updater that installs release zips from the GitHub repo.
- Pairing flow: 24-char token → one outbound `POST /api/wp-connect/pair` →
  store `client_id` + encrypted `refresh_secret`. Reset connection.
- Outbound, HMAC-SHA256-signed pushes for: orders, customers, products,
  inventory, content (posts/pages), SEO scores (Yoast / Rank Math), and form
  submissions (Gravity Forms / Contact Form 7). Centralised in
  `OctoberMI_Client::send()`. Non-blocking with a small blocking-retry path.
  No historic backfill — only events from the pairing date onward.
- Inbound `POST /wp-json/october-mi/v1/draft` route (bearer = stored secret)
  that creates a WP draft, bypassing `wp/v2/posts`.
- Admin UI under **Tools**: connection status, last sync, event counts, reset,
  and a rolling log of the last 50 outbound calls.
- Docs: `README.md`, `API.md`, this status note.

## Explicitly out of scope for v1 (deferred)

- The platform-side `/api/wp-connect/*` ingest routes — **separate future PR**.
  `API.md` is the spec for that work.
- WordPress.org submission.
- Multisite support.
- Per-event admin notifications.
- Historic order/customer/product backfill.

## Notes / decisions

- `refresh_secret` is encrypted at rest with the same AES-256-CBC + HMAC scheme
  Hillcroft uses for its secrets, keyed from WP salts (no extra secret to store;
  re-pair if salts are rotated).
- The inbound route only ever creates a **draft**, so a leaked secret cannot push
  live content.
- "Events this month" in the admin is counted from the rolling log (capped at 50
  entries); the lifetime counter is exact. A custom table for unbounded history
  was deliberately deferred to keep v1 option-only.
- Product deletion is caught via `wp_trash_post` / `before_delete_post` filtered
  to the `product` post type, since WooCommerce has no dedicated delete hook.
