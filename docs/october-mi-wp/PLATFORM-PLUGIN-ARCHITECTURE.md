# October Marketing Platform — plugin architecture

**This is the authoritative architecture for the client-side plugin.** It supersedes
the standalone framing in `BLOG-AUTOPILOT-PLAN.md` (still the reference for the content
*pipeline* and editorial method). The plugin that ships all of this is `dev/october-mi-wp`.

Client-facing name everywhere visible: **October Marketing Platform** — never an acronym.
"OMI" stays internal to this repo and the backend only. Internal code slugs
(`october-mi` text domain, `OCTOBERMI_` constants, `octobermi_*` options) are not
client-visible and are kept as-is to avoid a disruptive rename.

---

## 1. One plugin, many capabilities

We evolve the existing `october-mi-wp` connector into the **single client-side surface**
for the whole platform. Every capability is a **module**. Blog Autopilot is module #1;
anything the platform connects to client sites later (SEO, social, PR, reporting…) is a
new module in the *same* plugin — never a new plugin.

**Modules are opt-in and self-contained.** A disabled module contributes nothing: no
left-menu item, no admin assets, no hooks, no REST routes, no cron. So a site that only
wants blog posts sees one menu and a settings page — it *feels* single-purpose. The
plugin only ever grows with what's switched on.

Implemented this increment:
- `includes/class-octobermi-modules.php` — `OctoberMI_Module` base + `OctoberMI_Modules`
  registry. `boot_enabled()` boots only switched-on modules on `plugins_loaded`.
- Settings gained `enabled_modules` (+ `is_module_enabled()`); the Settings screen renders
  a checkbox per registered module.
- `modules/blog/class-octobermi-blog.php` — the Blog Autopilot module: gated top-level
  submenu, the per-site **content brief** (topics, audience, tone, attributed author,
  cadence, length, publish mode), and an engine-status readout. The research→publish
  pipeline lands in the next increment; this is the brief it runs on.

---

## 2. Standalone or connected — one engine

The **plugin is the engine**. It runs the whole pipeline on the client's own site, using
Claude, so the client sees and controls everything in their own WP admin. Two operating
modes, chosen in Settings:

| | Standalone (default) | Connected (platform extension) |
|---|---|---|
| Runs where | On the client's WP site | Same engine on the site; the platform oversees |
| Claude key | Client's own key, entered in the plugin | Client's key **or** an October-managed key |
| Who drives | The client, self-serve | October, across all clients, from one dashboard |
| Platform adds | — | Oversight, approval queue, and heavy research (DataForSEO/Serper/Reddit) it already runs |

Connected mode reuses the pairing channel that already exists (`class-octobermi-pairing`
+ platform `routes/wpConnect.js`): signed, outbound-push, WAF-friendly. "Connecting" is
the same handshake, now also gating the blog engine's managed features.

---

## 3. Keys, and why managed keys are proxied (the revocation design)

Implemented: `includes/class-octobermi-claude.php` — one client, two backends chosen
automatically from Settings:

- **Direct (standalone / own key):** the site calls the Anthropic API directly with a key
  stored **encrypted at rest** (`class-octobermi-crypto`, AES-256-CBC + HMAC from WP
  salts). The key is read server-side only, never sent to the browser, never logged. The
  Settings field is write-only (masked once saved).
- **Proxied (managed key):** the site **never holds a raw key**. It signs a request with
  its pairing secret and the *platform* performs the model call and returns normalised
  text (`is_managed_key()` → `complete_via_platform()` → signed `POST /api/wp-connect/generate`).

**Why proxy managed keys — the trap it avoids:** if the plugin were ever handed October's
raw key, a client who locked October out of their WP admin would keep the key on their
server and keep spending October's money, unrecoverably. Proxying means one action in the
OMI dashboard cuts off everything. A `401/403/409` from the generate endpoint is treated
as "connection revoked" and the plugin degrades gracefully (falls back to a local key, or
stops if none).

Client-owned keys need no revocation — it's the client's key and cost.

---

## 4. OMI-side work brief (platform / `dev/platform`)

The plugin half of connected mode is built; these are the **platform-side** pieces to
implement so managed keys and the remote kill-switch work. They slot onto the existing
`routes/wpConnect.js` + `connectors/wordpressPlugin.js` machinery.

1. **`POST /api/wp-connect/generate`** — HMAC-verified (same signature contract as every
   wp-connect call). Body: `{ request: <anthropic messages spec> }`. The platform:
   enforces a **model allow-list** and per-client cost caps, calls Anthropic with the
   platform-held key (reuse `services/claude.js`), logs usage (`usageTracking.js` /
   `costLog.js`), and returns `{ text }` (normalised). Never echoes the key.
2. **Dashboard "Disconnect / revoke site" control** — marks the client's
   `wordpress_plugin` connector revoked and **rotates/destroys the `refresh_secret`**.
   From that moment every signed call from the site (events, enrichment, proxied generate)
   is rejected. This is the kill-switch for a locked-out client.
3. **Optional remote-disable flag** the plugin honours on its next signed check-in
   (disables the module without needing WP-admin access).
4. **Enrichment endpoints (later)** the plugin can pull in connected mode: keyword/SERP
   clusters (`dataforseo.js`/`serper.js`), competitor and subreddit research — so the
   heavy, paid, infra-bound research runs on the platform, not the client site.

The plugin already exposes an inbound `POST /wp-json/october-mi/v1/draft` (bearer =
stored secret, draft-only) — the existing "publish a draft from the platform" path, reused
for connected editorial delivery.

---

## 5. Security posture (first-class)

Apply the repo's **`october-security`** skill on the build. Baked in so far / required:

- **Secrets:** API keys and `refresh_secret` encrypted at rest; never in the browser,
  never logged; Claude key field is write-only.
- **AuthZ:** every admin action and handler is `manage_options` + nonce
  (`check_admin_referer`); platform channel stays HMAC-SHA256 signed with replay window.
- **Managed keys never leave the platform** (§3) — the strongest control.
- **AI output is sanitised** (`wp_kses`) before it is ever saved as a post — model text is
  never trusted as HTML/executable. *(enforced in the pipeline increment)*
- **SSRF-hardened crawler** — the site learner restricts fetches to the client's own
  domain and blocks internal/link-local IPs (port OMI's `utils/urlSafety.js`).
  *(pipeline increment)*
- **Rate limits + per-site cost caps** on generation. *(pipeline increment)*

## 6. Speed posture (first-class)

- **Nothing heavy in a page request.** All Claude/research work runs in background jobs
  (WP-Cron for scheduled runs; spawned background jobs on demand). The `OctoberMI_Claude`
  timeouts are long by web standards because these calls only ever run off the request
  path. *(job runner lands in the pipeline increment)*
- **Conditional loading** — a module's assets load only on its own screens; only enabled
  modules boot. **Prompt-cache** the per-client context pack.
- **Featherweight front end** — inline JSON-LD + WebP images (lean on
  `dev/webp-image-optimizer`); no runtime JS added to the public site.

## 7. Design

Admin UI follows the **`october-design-system`** skill (OMI house style) so the plugin
reads as a native part of the platform.

---

## 8. Build status

**Done (this increment — v1.1.0):** module system + gating UI; visible rename to October
Marketing Platform + top-level menu; dual-mode `OctoberMI_Claude` (direct/proxied); Blog
Autopilot module shell with the content brief + engine status; settings for
modules/connection/key-source with encrypted write-only key.

**Next increment (pipeline):** background job runner; the site-learner (Context Pack);
DataForSEO/Serper research + clusters/briefs; grounded writer → optimise (SEO/AEO/voice)
→ fact-check → schema/images; editorial queue + one-click approve/publish; weekly
scheduler. Method and prior-art in `BLOG-AUTOPILOT-PLAN.md` / `BLOG-AUTOPILOT-PRIOR-ART.md`.

**OMI-side (separate, `dev/platform`):** the §4 brief — generate proxy, revoke control,
enrichment endpoints.
