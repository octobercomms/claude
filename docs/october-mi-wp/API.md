# OMI WordPress connector — API contract

This documents the platform endpoints the WordPress plugin calls, and the one
route the plugin exposes for the platform to call back. It is the **spec the
platform-side team implements**.

> **Status:** the platform `/api/wp-connect/*` ingest routes are now implemented
> (backend `src/routes/wpConnect.js`, connector `wordpress_plugin`, migration
> `066_wp_connect.sql`). This file remains the contract they're built to match.

- **Platform base:** `https://platform.octobercomms.com`
- **Outbound prefix:** `/api/wp-connect/`
- **All bodies:** `application/json`, UTF-8.

## Signature contract (outbound)

Every outbound request (except `pair`, which has no secret yet) carries:

| Header | Value |
|---|---|
| `X-Signature` | lowercase hex `HMAC-SHA256(raw_request_body, refresh_secret)` |
| `X-Timestamp` | Unix seconds at send time |
| `X-OMI-Client` | the `client_id` issued at pairing |
| `X-OMI-Version` | plugin version, e.g. `1.0.0` |
| `User-Agent` | `OctoberMI-WP/<version>` |

**Verification (platform side):**

1. Look up the `refresh_secret` by `X-OMI-Client`.
2. Recompute `HMAC-SHA256` over the **exact raw body bytes** and compare to
   `X-Signature` in constant time.
3. Reject if `X-Timestamp` is outside an acceptable window (e.g. ±5 minutes) to
   prevent replays.

Every JSON body also includes an envelope: `client_id`, `site_url`, `sent_at`
(Unix seconds), plus an `event` string and the resource object.

## Pairing

### `POST /api/wp-connect/pair`

The one unsigned call. Sent once, blocking, when the admin clicks **Connect**.

Request:

```json
{
  "token": "AbC123…(24 chars)",
  "site_url": "https://shop.example.com",
  "site_name": "Example Shop",
  "wp_version": "6.7",
  "plugin_version": "1.0.0"
}
```

Success `200`:

```json
{
  "client_id": "cli_abc123",
  "refresh_secret": "long-random-signing-key",
  "client_name": "Example Shop"
}
```

`client_name` is optional. On any non-200, return
`{ "message": "human-readable reason" }`; the plugin surfaces it verbatim.

## Outbound event endpoints

All are `POST`, signed as above. The platform should respond `2xx` on success;
the plugin sends non-blocking and only logs failures, so the response body is not
consumed for these.

### `POST /api/wp-connect/orders`

`event` is `order.upserted` or `order.refunded`.

```json
{
  "event": "order.upserted",
  "order": {
    "id": 1234, "number": "1234", "status": "processing",
    "currency": "GBP", "total": 59.99, "subtotal": 49.99,
    "total_tax": 10.0, "discount": 0.0,
    "customer_id": 42, "email": "buyer@example.com",
    "date_created": 1733600000, "date_paid": 1733600100,
    "payment_method": "stripe",
    "items": [ { "product_id": 9, "name": "Widget", "quantity": 2, "total": 39.98 } ]
  }
}
```

### `POST /api/wp-connect/customers`

`event` is `customer.created` or `customer.updated`.

```json
{
  "event": "customer.created",
  "customer": {
    "id": 42, "email": "buyer@example.com",
    "first_name": "Sam", "last_name": "Lee", "username": "samlee",
    "date_created": 1733000000, "orders_count": 3, "total_spent": 180.0,
    "country": "GB", "city": "Leeds", "postcode": "LS1 1AA"
  }
}
```

### `POST /api/wp-connect/products`

`event` is `product.upserted` or `product.deleted` (deleted sends only `id`).

```json
{
  "event": "product.upserted",
  "product": {
    "id": 9, "type": "simple", "name": "Widget", "sku": "WID-9",
    "status": "publish", "price": 19.99, "regular_price": 24.99,
    "sale_price": 19.99, "stock_quantity": 120, "stock_status": "instock",
    "categories": ["Gadgets"], "permalink": "https://shop.example.com/product/widget"
  }
}
```

### `POST /api/wp-connect/inventory`

`event` is `inventory.changed` or `inventory.status_changed`.

```json
{
  "event": "inventory.changed",
  "inventory": { "product_id": 9, "sku": "WID-9", "stock_quantity": 118, "stock_status": "instock" }
}
```

### `POST /api/wp-connect/content`

`event` is `content.published` or `content.updated`. Public post types only;
WooCommerce products are excluded (they use `products`).

```json
{
  "event": "content.updated",
  "content": {
    "id": 55, "type": "post", "title": "Spring sale", "status": "publish",
    "slug": "spring-sale", "permalink": "https://shop.example.com/spring-sale",
    "author": 1, "modified": 1733600000, "excerpt": "Up to 30% off…"
  }
}
```

### `POST /api/wp-connect/seo`

Sent alongside `content` when Yoast or Rank Math is active.

```json
{
  "event": "seo.scored",
  "seo": {
    "post_id": 55, "post_type": "post",
    "permalink": "https://shop.example.com/spring-sale",
    "provider": "yoast", "seo_score": "72", "readability": "60",
    "focus_keyword": "spring sale", "meta_description": "…", "seo_title": "…"
  }
}
```

`provider` is `yoast` or `rankmath`; some fields are absent for Rank Math.

### `POST /api/wp-connect/form-submission`

```json
{
  "event": "form.submitted",
  "form": {
    "provider": "gravityforms", "form_id": 3, "form_name": "Contact",
    "entry_id": 901, "fields": { "Name": "Sam", "Email": "sam@example.com" }
  }
}
```

`provider` is `gravityforms` or `contactform7`.

## Inbound: draft publish (plugin-exposed route)

### `POST /wp-json/october-mi/v1/draft`

The platform calls this to push a draft into WordPress.

Headers: `Authorization: Bearer <refresh_secret>`, `Content-Type: application/json`.

Request:

```json
{ "title": "Draft headline", "content": "<p>Body…</p>", "excerpt": "…", "type": "post" }
```

`type` is optional (defaults to `post`; must be an existing public post type).
Auth is the bearer token compared (constant time) against the stored
`refresh_secret`; the site must be paired.

Success `201`:

```json
{ "ok": true, "post_id": 88, "edit_link": "https://shop.example.com/wp-admin/post.php?post=88&action=edit", "status": "draft" }
```

Errors: `400` missing title, `401` bad/missing bearer, `403` not paired, `500`
insert failure (`{ "code", "message" }`).
