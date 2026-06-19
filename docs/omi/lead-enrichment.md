# Deep lead find (paid providers)

The "dig deeper" option in the outreach finder, for when the free path
(scrape + Serper) doesn't surface enough companies. Pluggable paid B2B data
providers, each **inert until its API key is set** in Settings → Integrations.

## Providers
- **Apollo** (`APOLLO_API_KEY`) — best all-rounder for "find me X-title people at
  Y-type companies in Z". People + org search.
- **People Data Labs** (`PEOPLEDATALABS_API_KEY`) — person search by title /
  location / industry; strong enrichment, lighter on net-new discovery.
- **Hunter Discover** (`HUNTER_API_KEY`, already used for verification) —
  discovers companies by criteria, then pulls contacts via domain-search.

## How it works
- `services/leadEnrichment.js` — one adapter per provider, all returning
  contacts in the outreach `/contacts/bulk` shape (deduped by email-or-name), so
  results flow into the existing **find → rank → add** path unchanged.
- `availableProviders()` lists only the configured ones; the finder shows a
  provider dropdown + a job-titles field and reuses the audience fields
  (industry / location / keywords).
- Routes: `GET /outreach/find/deep/providers`, `POST /outreach/find/deep`
  (`{ client_id, provider, query }`, access-checked).

## Cost
These are per-lookup paid APIs — the UI frames it as "use when the free path
comes up short". The free scrape/Serper/Hunter-verify path stays the default.

## Caveat
The provider APIs can't be exercised in CI; the endpoints/params follow each
provider's current docs and the adapters are isolated, so a first-run tweak per
provider (field names, plan-gated email fields) is quick if needed.
