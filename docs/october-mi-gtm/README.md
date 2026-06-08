# October MI GTM container template

A versioned Google Tag Manager (GTM) **web** container export that an October
account manager imports into a client's GTM workspace to stand up the standard
October Marketing Intelligence (OMI) tracking stack in one go.

One container template fits every client. All client-specific IDs are
parameterised as User-Defined **constant** variables, so the only per-client work
after import is filling in five values. See `INSTALL.md` for the import steps.

- **File:** `october-mi-v1.json`
- **Format:** GTM container export, `exportFormatVersion: 2`
- **Usage context:** web
- **Import mode:** Merge (never Overwrite)

## What the container contains

### Parameterised client variables (constants)

Fill these in after import. Until set, they hold harmless placeholder values.

| Variable | Placeholder | Purpose |
|----------|-------------|---------|
| `GA4 Measurement ID` | `G-XXXXXXXXXX` | GA4 web stream measurement ID |
| `Meta Pixel ID` | `000000000000000` | Meta (Facebook) Pixel ID |
| `TikTok Pixel ID` | `XXXXXXXXXXXXXXXXXXXX` | TikTok Pixel ID |
| `LinkedIn Partner ID` | `0000000` | LinkedIn Insight Tag partner ID |
| `OMI Client ID` | `omi-client-xxxx` | October platform client identifier for attribution |

### Tags

| Tag | Type | Fires on |
|-----|------|----------|
| GA4 - Configuration | Google tag | All Pages |
| GA4 - Event - purchase | GA4 event | `purchase` |
| GA4 - Event - add_to_cart | GA4 event | `add_to_cart` |
| GA4 - Event - view_item | GA4 event | `view_item` |
| GA4 - Event - begin_checkout | GA4 event | `begin_checkout` |
| GA4 - Event - view_cart | GA4 event | `view_cart` |
| GA4 - Event - add_to_wishlist | GA4 event | `add_to_wishlist` |
| GA4 - Event - search | GA4 event | `search` |
| Meta Pixel - Base | Custom HTML | All Pages |
| Meta Pixel - Purchase | Custom HTML | `purchase` |
| Meta Pixel - AddToCart | Custom HTML | `add_to_cart` |
| Meta Pixel - InitiateCheckout | Custom HTML | `begin_checkout` |
| Meta Pixel - ViewContent | Custom HTML | `view_item` |
| TikTok Pixel - Base | Custom HTML | All Pages |
| TikTok Pixel - CompletePayment | Custom HTML | `purchase` |
| TikTok Pixel - AddToCart | Custom HTML | `add_to_cart` |
| TikTok Pixel - InitiateCheckout | Custom HTML | `begin_checkout` |
| TikTok Pixel - ViewContent | Custom HTML | `view_item` |
| LinkedIn Insight Tag | Custom HTML | All Pages |
| October MI Pixel - All Pages | Custom Image | All Pages |
| October MI Pixel - Purchase | Custom Image | `purchase` |

The Meta and TikTok event tags use GTM **setup tags** so the relevant base
pixel always initialises before its events fire.

### Triggers

All event triggers are GTM **Custom Event** triggers matching the dataLayer
`event` name. The "All Pages" tags use the built-in All Pages page-view trigger.

| Trigger | Matches dataLayer event |
|---------|-------------------------|
| CE - purchase | `purchase` |
| CE - add_to_cart | `add_to_cart` |
| CE - view_item | `view_item` |
| CE - begin_checkout | `begin_checkout` |
| CE - view_cart | `view_cart` |
| CE - add_to_wishlist | `add_to_wishlist` |
| CE - search | `search` |

### Data Layer Variables

Read directly from the client's ecommerce dataLayer; no configuration needed.

| Variable | dataLayer path |
|----------|----------------|
| `DLV - ecommerce.value` | `ecommerce.value` |
| `DLV - ecommerce.currency` | `ecommerce.currency` |
| `DLV - ecommerce.items` | `ecommerce.items` |
| `DLV - ecommerce.transaction_id` | `ecommerce.transaction_id` |
| `DLV - search_term` | `search_term` |

### Built-in variables

Enabled in the container: Page URL, Page Hostname, Page Path, Referrer, Event,
Container ID, Container Version, Debug Mode, Random Number.

### October MI pixel

The two October MI pixel tags fire a request to the platform attribution
endpoint:

```
https://platform.octobercomms.com/api/mi-pixel
```

Expected query parameters:

| Param | All Pages tag | Purchase tag | Source |
|-------|:-------------:|:------------:|--------|
| `client_id` | yes | yes | `{{OMI Client ID}}` |
| `event` | `page_view` | `purchase` | constant per tag |
| `page_url` | yes | yes | `{{Page URL}}` |
| `page_path` | yes | — | `{{Page Path}}` |
| `referrer` | yes | — | `{{Referrer}}` |
| `value` | — | yes | `{{DLV - ecommerce.value}}` |
| `currency` | — | yes | `{{DLV - ecommerce.currency}}` |
| `transaction_id` | — | yes | `{{DLV - ecommerce.transaction_id}}` |
| `cb` | yes | yes | `{{Random Number}}` (cache-buster) |

This lets the October platform attribute on-site behaviour back to the
campaigns that drove it.

## Scope

### In scope

- One reusable container template that fits all clients.
- Browser-side firing of GA4, Meta Pixel, TikTok Pixel, the LinkedIn Insight Tag
  and the October MI pixel.
- Client values held in GTM variables, not baked into the JSON, so the same file
  ships to every client and Merge updates never clobber client settings.

### Out of scope

- **No GTM-API auto-install.** The AM imports the file by hand via Admin →
  Import Container. There is no programmatic provisioning in this surface.
- **No server-side Conversions API (CAPI) bridge.** This container fires the
  browser Meta Pixel only. Deduplicated server-side conversions run in the
  October platform's server-side stack and are configured platform-side per
  client. Documented here for awareness; nothing to do in this container.
- **No dataLayer implementation.** The container consumes a standard GA4
  ecommerce dataLayer; pushing those events is the client site's responsibility.
- **No consent-management configuration.** Tags ship with consent status
  `NOT_SET`; wire up the client's CMP separately if required.

## Versioning and regeneration

Template revisions are shipped as incrementing files in this folder:

```
october-mi-v1.json   <- this release
october-mi-v2.json   <- next revision
october-mi-v3.json   <- and so on
```

Each new version is a full container export. To roll a client forward, the AM
re-imports the newer file with **Merge** (see `INSTALL.md → Updating to a later
version`). Because client values live in GTM variables, Merge updates leave the
client's IDs and any bespoke tags intact.

When producing a new version:

1. Copy the previous `october-mi-vN.json` to `october-mi-v(N+1).json`.
2. Make the changes (new tags/triggers/variables, fixes, etc.). Keep tag,
   trigger and variable **IDs stable** for items that carry over so Merge
   recognises them as the same objects; assign fresh unique numeric string IDs
   to anything new. Bump each changed item's `fingerprint`.
3. Update `containerVersionId`, the version `name` and the top-level
   `fingerprint`.
4. Validate before committing:

   ```bash
   node -e "JSON.parse(require('fs').readFileSync('docs/october-mi-gtm/october-mi-v2.json','utf8')); console.log('valid')"
   ```

   Then assert referential integrity: every `firingTriggerId` resolves to an
   existing trigger (or the built-in All Pages trigger `2147479553`), every
   `setupTags`/`TAG_REFERENCE` resolves to an existing tag, and every
   `{{variable}}` reference resolves to a defined variable, built-in variable or
   the `{{_event}}` macro.
5. Record what changed in the version's release notes so the AM knows what to
   expect in the import preview.
