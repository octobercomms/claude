# Brief for the OMI agent — build the platform side of the plugin connection

**You are working in `dev/platform` (the OMI backend).** A client-side WordPress plugin —
**October Marketing Platform** (`dev/october-mi-wp`) — has been built to run a Claude-powered
blog engine on client sites, standalone *or* connected to OMI. The plugin half of "connected"
mode is done. This brief is the **platform side** you need to build so managed keys, the
remote kill-switch, and (later) research enrichment work end to end.

---

## 1. What already exists on both sides (context — do not rebuild)

- **Pairing** already works: `POST /api/wp-connect/pair` (in `routes/wpConnect.js`) exchanges a
  one-time token for `client_id` + `refresh_secret`, and activates the `wordpress_plugin`
  connector (`connectors/wordpressPlugin.js`).
- **Signature contract** (already enforced on every non-pair wp-connect route): the plugin sends
  `X-Signature` = hex **HMAC-SHA256 of the exact raw JSON body**, keyed with the site's
  `refresh_secret`; plus `X-Timestamp` (Unix seconds, ±5 min replay window) and `X-OMI-Client`
  (the `client_id`). Reuse this verification for the new routes.
- The plugin's outbound envelope wraps every payload as
  `{ client_id, site_url, sent_at, ...payload }`.
- The plugin already holds `services/claude.js`, `usageTracking.js`, `costLog.js`,
  `dataforseo.js`, `serper.js`, `keywordClusters.js`, `topicMap.js`, `subredditResearch.js`,
  `competitorPages.js` — use them; don't reimplement.

---

## 2. Build: `POST /api/wp-connect/generate` (the managed-key proxy)

This is why the plugin never holds a managed key: in managed mode it sends the model request
here and OMI performs the call with the platform-held Anthropic key.

- **Auth:** verify the HMAC signature + timestamp exactly like the other wp-connect routes.
  Look up the `wordpress_plugin` connector by `client_id`; reject if it is missing, `revoked`,
  or `inactive`.
- **Request body** (after signature verification):
  ```json
  {
    "client_id": "…", "site_url": "…", "sent_at": 0,
    "request": {
      "model": "claude-sonnet-5",
      "max_tokens": 2200,
      "system": "…(optional)…",
      "messages": [ { "role": "user", "content": "…" } ],
      "temperature": 0.7
    }
  }
  ```
  The plugin sends the standard Anthropic `/v1/messages` shape under `request`.
- **Behaviour:**
  1. Enforce a **model allow-list**. Expected defaults from the plugin:
     `claude-haiku-4-5-20251001`, `claude-sonnet-5`, `claude-opus-5`. Reject or remap anything
     else — never pass an arbitrary client-supplied model straight through.
  2. Enforce **per-client cost caps / rate limits** before calling.
  3. Call Anthropic through `services/claude.js` with the **platform-held key**.
  4. **Log usage + cost** (`usageTracking.js`, `costLog.js`) against this `client_id`.
  5. Return **`{ "text": "…concatenated output text…" }`** with HTTP 200.
- **Errors (the plugin already handles these):**
  - `401` / `403` — bad signature or **connector revoked/inactive**.
  - `409` — client paused or over cost/rate cap.
  - other `4xx/5xx` — return `{ "message": "…" }`.
  The plugin treats **401/403/409 as "connection revoked"** and degrades gracefully (falls back
  to a local key if the client set one, otherwise stops).
- **Never** return, echo, or log the Anthropic key.

---

## 3. Build: dashboard "Disconnect / revoke site" (the kill-switch)

The scenario: a client locks October out of their WordPress admin but the plugin is still
installed and using a **managed** key. October must be able to cut them off from the OMI side.

- Add a control in the OMI dashboard (client → connectors → `wordpress_plugin`) that:
  1. Sets the connector `status = 'revoked'`, and
  2. **Rotates/destroys the `refresh_secret`** for that site.
- Effect: from that moment, every signed call from the site — event pushes, `generate`, and
  enrichment — fails signature/authorization (`401/403`). No managed generation can continue.
  Because the raw key was never on the client site, there is nothing left there to keep
  spending October's money.
- **Optional but recommended:** a `disabled` flag the platform can set that is returned to the
  plugin on its next signed check-in, so a module can be remotely switched off even before a
  full revoke.

---

## 4. Build later (optional now): enrichment endpoints

In connected mode the plugin can offload the heavy, paid, infra-bound research to OMI instead of
each client site needing its own API keys.

- Suggested: `POST /api/wp-connect/enrich` (same HMAC auth) with
  `{ kind: 'keyword_clusters' | 'topic_map' | 'serp' | 'subreddit' | 'competitor_pages', params: {…} }`,
  dispatching to the existing services and returning normalised JSON.
- The plugin will call these to enrich its Context Pack and briefs; ship `generate` + revoke
  first, this second.

---

## 5. Acceptance

1. A paired site calling `POST /api/wp-connect/generate` with a valid signature and an
   allow-listed model gets `{ text }` back, and the call is cost-logged against the client.
2. A disallowed model, an over-cap client, and a bad signature each return the right status
   (403 / 409 / 401) and are handled by the plugin as degrade/revoke.
3. Clicking "revoke site" in the dashboard rotates the `refresh_secret` and immediately causes
   all subsequent signed calls from that site to fail.
4. The Anthropic key never appears in any response, log, or error.

Cross-reference: `docs/october-mi-wp/PLATFORM-PLUGIN-ARCHITECTURE.md` §3–4, and the plugin's
`includes/class-octobermi-claude.php` (`complete_via_platform()`) for the exact call the
`generate` endpoint must satisfy.
