# October Serious Buyer

A single self-contained WordPress plugin that drops the **Serious Buyer Method**
— a high-converting landing page **and** an advice hub — onto any client's
WordPress site. Activate it, set a logo / colours / copy (or import a client
preset), and both pages go live on the plugin's own routes, independent of the
client's theme and page builder.

The goal is **speed of deployment into client sites**. Today each microsite is a
per-client build on our own infrastructure using JupiterX + Elementor +
Crocoblock (JetEngine) + October Forms + child-theme code. This plugin collapses
that into *install → configure → live*.

- **Slug:** `october-serious-buyer` · **Code:** `dev/oc-serious/` · **Docs:** `docs/oc-serious/`
- **Status:** Spec v2 — validated against a full harvest of the live nvelope build
  (`docs/oc-serious/harvest/`). No plugin code yet.

---

## Verdict: reuse, don't rebuild (the forms/quiz already exist)

The harvest settled the biggest scoping question. The live funnel is built from
**October Comms' own already-generic, already-multi-tenant plumbing**, most of
which is already in this repo:

- **October Forms** (`dev/oc-forms`) is the engine behind **all three** of the
  quiz, the consultation form, and the email gate — one plugin (`ocf_form` CPT),
  a question schema that drives both a classic multi-step form UI *and* an AI
  chat UI (`class-ocf-ai.php` → Claude API, server-side), Brevo sync, a REST API
  (`ocf/v1/*`), partial capture, analytics. It is explicitly a reusable engine.
  **We do not rebuild the quiz or forms — we point October Forms at our own
  question set.**
- The funnel is **already multi-tenant**: 7 live client Studios/Hubs (LOLO,
  Andrew Paine, Manolo, Tiam, S G/D, nvelope, Forgeworks). nvelope is the demo.

So October Serious Buyer is a **new plugin for the content model + page templates
+ brand layer, that depends on October Forms** for every form/quiz/gate. That is
a much smaller build than a from-scratch plugin, and it keeps one forms codebase.

What still has to be built (because today it's Elementor/JetEngine/JupiterX):

| Layer | Today | In the plugin |
|-------|-------|---------------|
| Data model | JetEngine CPTs + meta boxes + repeaters | Plugin-registered `studio` + `learn` CPTs and fields |
| Layout | Elementor Single templates (#23, #499) + Header/Footer | Own standalone templates on plugin routes |
| Brand | Studio meta → `--studio-*` CSS vars | Settings/preset → same vars → **port the CSS** |
| Advice cards + modal | Jet repeater render + Raven popup #848 | Own card grid + gated modal |
| Forms / quiz / gate | October Forms | **October Forms (dependency)** — unchanged |
| Tracking | Site Kit GA4 + Clarity, site-wide | Optional per-client IDs + documented site-level tags |

Ruled out: shipping the JetEngine config + Elementor templates as an importable
"kit" — that keeps the Elementor Pro + Crocoblock licence + theme-conflict burden
on every client, which is exactly what we're removing.

---

## ⚠️ Security findings (from the harvest)

1. **Exposed Brevo key (real, act now).** The child-theme `remindform.js` ships a
   live Brevo **private** API key in client-side JS. **Rotate it in Brevo.** In
   this plugin the remind-bar posts server-side, so the key never reaches the
   browser. *(October Forms itself is clean — its Claude key is a server-side WP
   option, `ocf_claude_api_key`, never sent to the browser.)*
2. **October Forms REST endpoints** (`ocf/v1/*`) register with
   `permission_callback => __return_true` — open POST routes relying on internal
   session/nonce checks. Worth a dedicated look via the `october-security` skill;
   tracked as a separate concern from this plugin.

---

## Content model (confirmed — corrects the earlier brief)

Two sibling CPTs, no relations, no taxonomies, no separate asset CPT:

- **`studio`** (landing) and **`learn`** (Advice Hub). Cross-linked by a plain
  slug text field (`studio_quiz_url` / `studio_slug`), not a JetEngine relation.
- **Studio** carries the brand tokens + all landing copy across meta-box tabs:
  *Fonts & Colors / Landing / FAQs / Quiz / Qualified & Booking / Not Ready /
  Out of Scope / Scripts* (~50 fields; full list in `harvest/section2`).
- **Advice Hub** carries **4 repeater fields** — `hub_assets_fees`,
  `hub_assets_how`, `hub_assets_process`, `hub_assets_decisions` — 5 rows each
  (20 guides; 12 free / 8 gated). Row fields: `*_gated` (**FREE / Gated /
  Image** — the "Image" state's purpose is unknown, confirm), `*_title`,
  `*_standfirst`, `*_body` (WYSIWYG), `*_type` (PDF/Video), `*_time`, `*_file`
  (URL), `*_image`, and a shared `asset_uid` (`{cat}-{NNN}`, e.g. `fees-001`).

### Brand tokens (real nvelope values → defaults)
`--studio-font-color:#8e8e7b` · `--studio-accent-color:#4b4b40` ·
`--studio-hover-color:#ffffff` · `--studio-bg-color:#d8d6d4` ·
`--studio-panel-color:#ecece9` · Inter 200 (heading + body) · base 16px ·
logo width 250px. Logo + favicon are SVG. The existing `style.css` is written
against these vars and ports across once vendor selectors are dropped.

### Forms, quiz, gate (all October Forms)
- **Consultation form** = `[nvelope_form id="1909"]` (an OCF form).
- **Quiz** = an OCF **AI form** → `POST /ocf/v1/chat`. Flow: a 3-way pre-quiz
  card (Planning → AI chat; Researching / Not sure → a static "not ready" panel →
  Advice Hub), then chat questions (project type, property status, free-text
  scope/budget/timeline, optional file), then lead capture. Outcomes are
  configured per Studio (Qualified & Booking / Not Ready / Out of Scope tabs).
- **Email gate** = currently a Brevo-hosted iframe embedded in the single
  "Asset Drawer" popup (#848); unlocking sets a session flag and `?u=1`.
  Recommend rebuilding it as an OCF-native gate (server-side, consistent).

### Tracking
GA4 (`G-V85R42JXZH`, plus a second ID to confirm) via **Site Kit**, site-wide,
and **Microsoft Clarity** — not per-Studio. The per-Studio pixel fields
(`x_/meta_/pinterest_/ga4_/google_ads`) exist but are empty on nvelope. Custom
events (`sbm_*`, `asset_click`) fire from `class-ocf-analytics.php`. Plugin
should expose optional per-client pixel IDs and document the site-level tags.

---

## Page layouts
See `harvest/` (screenshots + Elementor exports) and the earlier layout notes.
- **Landing (Studio):** hero (headline + video + badges) → "How would you like to
  proceed?" fork → belief/values panel → FAQ accordion → "How we work" 3-icon →
  "Examples of projects" 3-image → pre-quiz/quiz → closing CTA → footer.
- **Advice Hub (Learn):** header + nav → hero panel → 4 category sections (Fees /
  How it works / Process / Decisions), each a card grid → closing quiz CTA →
  footer. Cards: title, standfirst, Free/PDF/Video + time tags, download/watch
  CTA; gated cards on the accent panel with a lock + "Email required".

## Proposed file layout (`dev/oc-serious/`)
```
october-serious-buyer.php      # bootstrap, constants, hooks, OCF dependency check
includes/
  class-ocs-activator.php      # rewrite flush, seed demo studio + advice content
  class-ocs-cpt.php            # studio + learn CPTs + fields (replaces JetEngine)
  class-ocs-routes.php         # /serious/ (landing) + /learn/ endpoints
  class-ocs-render.php         # standalone document renderer (own <head>)
  class-ocs-brand.php          # tokens -> --studio-* CSS vars
  class-ocs-landing.php        # landing template controller (+ pre-quiz)
  class-ocs-hub.php            # hub grid + gated asset modal controller
  class-ocs-forms-bridge.php   # October Forms: consultation, AI quiz, email gate
  class-ocs-tracking.php       # optional pixels + site-level tags + events
  class-ocs-remind.php         # server-side remind-me bar (no client key)
  class-ocs-preset.php         # client.json import/export
  class-ocs-updater.php        # GitHub-release self-updater (from Hillcroft)
admin/  class-ocs-settings.php # brand + copy + tracking + forms settings screen
templates/  landing.php  hub-index.php  hub-asset-modal.php  partials/
assets/  css/ (ported style.css)  js/ (asset drawer)  img/
bin/  build-zip.sh
readme.txt
```

## Build sequence
1. Skeleton — bootstrap, OCF dependency check, CPTs + fields, activator/seed.
2. Standalone routing + renderer; brand layer (port `style.css`).
3. Landing template (incl. pre-quiz fork) from the ~50 Studio fields.
4. Advice hub — category grids, card + gated modal, media embeds.
5. Forms bridge — wire consultation, AI quiz, and email gate to October Forms.
6. Tracking + server-side remind bar.
7. Preset import/export + self-updater + `build-zip.sh`.

## Open decisions
- [ ] **Email gate:** OCF-native form (recommended) vs keep the Brevo iframe.
- [ ] **Seed content:** ship the architect demo set (20 guides + copy) as the
  built-in dummy (recommended — clients are architects/design studios) vs generic.
- [ ] **Plugin slug** `october-serious-buyer` — confirm.
- [ ] The `*_gated` "Image" third state — what it's for.
- [ ] Rotate the exposed Brevo key.

## Harvest
Full source-of-truth notes from the live site are in `docs/oc-serious/harvest/`
(sections 1–9) and the original child-theme files + Elementor exports in
`docs/oc-serious/legacy-reference/`.
