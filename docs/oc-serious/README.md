# October Serious Buyer

A single self-contained WordPress plugin that drops the **Serious Buyer Method**
— a high-converting landing page **and** an advice hub — onto any client's
WordPress site. Activate it, set a logo / colours / tracking IDs (or import a
client preset), and both pages go live on the plugin's own routes, independent
of the client's theme and page builder.

The point is **speed of deployment into client sites**. Today each microsite is
rebuilt by hand on our own infrastructure with JupiterX + Elementor +
Crocoblock (JetEngine) + custom child-theme code. This plugin replaces that
per-client rebuild with *install → configure → live*.

- **Slug:** `october-serious-buyer` · **Code:** `dev/oc-serious/` · **Docs:** `docs/oc-serious/`
- **Status:** Spec complete, reverse-engineered from the live nvelope build. No plugin code yet.
- **Reference:** `docs/oc-serious/legacy-reference/` holds the original child-theme
  files and Elementor exports the spec is derived from (Brevo key redacted).

---

## ⚠️ Security finding in the current build (fix outside this project too)

`assets/remindform.js` hardcodes a **live Brevo private API key** in
client-side JavaScript, served to every visitor. Anyone can read it from page
source and use the full Brevo account. **The key must be rotated in Brevo now.**
In this plugin the Brevo contact-upsert + transactional send move **server-side**
(via October Forms), so the key never reaches the browser. The redacted
reference copy documents this.

## The core architectural decision

**We do not port Elementor / JupiterX / Crocoblock onto client sites.** That
path needs paid Elementor Pro + Crocoblock licences on every client, collides
with the client's own theme, and kills the "just add a logo and colours" speed
that is the whole value.

Instead we rebuild the two experiences **once** as clean, tokenised
HTML/CSS/JS served on the plugin's **own front-end routes** — the pattern
already proven in this repo by `dev/hillcroft-gardens`
(`class-hgd-booking-page.php`, `class-hgd-proposal-portal.php`) with its
GitHub-release self-updater. The client's theme, builder and host become
irrelevant.

The build is unusually portable because **the current design is already
tokenised**: the Elementor/JetEngine layer is mostly a CMS-and-layout shell
around ~12 per-client variables, a logo and a favicon. The plugin absorbs that
shell.

## Decisions locked (with the client)

| Decision | Choice | Why |
|----------|--------|-----|
| Render mode | Standalone full-page on plugin-owned routes | Predictable, best-converting, zero theme conflicts. |
| Forms engine | Depend on **October Forms** (`oc-forms`); don't fork it | One forms codebase; Brevo stays server-side. |
| Design source | Rebuild from the live pages | Faithful; egress policy blocks scraping, so client uploaded source + screenshots + Elementor exports. |

---

## Reverse-engineered model (from the reference files)

### Content types
- **`studio`** — the landing / microsite (one per client brand).
- **`learn`** — advice-hub content, linked to a parent Studio (JetEngine
  relation ID 6). Learn inherits its parent Studio's brand + tracking.
- Advice-hub **assets** (guides) are a listing CPT surfaced via
  `jet-listing-grid`, one grid per category.

### Brand system — post meta on the Studio → CSS variables
Injected in `wp_head`, scoped to `body.single-studio, body.single-learn`:

| Meta key | CSS var |
|----------|---------|
| `studio_body_font_family` / `studio_heading_font_family` (+ `_weights`) | `--studio-font-body` / `--studio-font-heading` |
| `studio_font_size_base` | `--studio-font-size-base` |
| `studio_font_color` | `--studio-font-color` |
| `studio_accent_color` | `--studio-accent-color` |
| `studio_hover_color` | `--studio-hover-color` |
| `studio_background_color` | `--studio-bg-color` |
| `studio_panel_color` | `--studio-panel-color` |
| `studio_logo_width_px`, `studio_favicon` | logo/favicon overrides |

Defaults: Inter / #111 / #444 accent / #000 hover / #f5f5f5 bg / #fff panel.
**The existing `style.css` is written entirely against these vars** — it ports
across once vendor selectors (`.elementor-button`, `.raven-*`, `.jet-*`) are
swapped for our own semantic classes.

### Tracking — post meta on the Studio, server-rendered
`x_pixel_id`, `meta_pixel_id`, `pinterest_tag_id`, `ga4_id`, `google_ads_id`.
Emits each platform's base pixel + a segmentation event `sbm_{step}` where
`step` comes from `?step=` (default `landing`). `/learn/{slug}` maps to its
Studio by slug so tracking fires on both. A GA4 `asset_click` event fires on
hub card clicks.

### Forms & capture (all to be replaced by October Forms, server-side)
- `[studio_fillout]` — Fillout embed from `studio_form_embed` meta.
- `[nvelope_brevo_iframe]` — Brevo form iframe from `studio_brevo_form_uid`.
- `[remind_me_form]` — sticky "remind me" email bar → Brevo contact + template
  (currently the leaky client-side key).

### Advice-hub asset drawer (`script.js`)
Card grid → click stores the asset in `sessionStorage` → opens a modal populated
with title / standfirst / body / media. Media auto-embeds YouTube, Vimeo, Loom;
PDFs get a download CTA. Assets are **free** or **gated**; gated assets show a
locked state and unlock the session after an email gate returns with `?u=1`.
Rebuild replaces the Raven/JetEngine DOM-scraping with our own card + modal
markup and wires the gate to October Forms.

---

## Page layouts (from screenshots + Elementor exports)

### Landing page (Studio)
1. Header: logo + "Book a free consultation".
2. Hero: headline + standfirst + primary CTA + "Still researching? → Advice Hub"
   + captioned video + trust badges (RIBA/ARB/AIA).
3. "How would you like to proceed?" — two-panel fork (Book vs Advice Hub).
4. Belief/values panel (Clarity before commitment / Fewer, better projects /
   No pressure) + image.
5. FAQ accordion.
6. "How we work" — 3-icon row.
7. "Examples of projects we typically take on" — 3-image row.
8. **Qualification quiz** ("Which best describes where you are right now?") with
   pre-quiz options and conditional result panels — the core "serious buyer"
   qualifier; drives the `?step=` tracking.
9. Closing CTA panel + footer.

### Advice Hub (Learn)
1. Header: "Advice Hub" + nav (Fees / How it works / Process / Decisions).
2. Hero panel: headline + standfirst + "Browse Guides" + "Book a free
   consultation" + trust badges + image.
3. Four category sections (**Fees, How it works, Process, Decisions**), each an
   intro line + a card grid.
4. Cards: title, standfirst, Free/PDF/Video + read/watch-time tags, download/
   watch CTA; gated cards render on the accent panel with a lock + "Email
   required".
5. Closing quiz CTA + footer.

## Old → new mapping

| Today | In the plugin |
|-------|---------------|
| JupiterX + Elementor + Raven layout | Own standalone templates (vendor selectors dropped) |
| JetEngine `studio`/`learn` CPTs + relation 6 | Plugin CPTs + a parent link |
| JetEngine listing grid + Raven popups | Own card grid + modal |
| Studio brand meta → `--studio-*` vars | Settings/preset → same vars → **keep the CSS** |
| Per-post tracking meta + `sbm_` events | Tracking settings, server-rendered, same event names |
| Fillout / Brevo iframe / leaky remind-form | October Forms; Brevo server-side |
| Manual Elementor rebuild per client | Install + import `client.json` preset |

---

## Proposed file layout (`dev/oc-serious/`)

```
october-serious-buyer.php      # bootstrap, constants, hooks
includes/
  class-ocs-activator.php      # rewrite flush, seed dummy studio + advice content
  class-ocs-cpt.php            # studio + learn/asset CPTs, parent link
  class-ocs-routes.php         # /serious/ (landing) + /learn/ endpoints
  class-ocs-render.php         # standalone document renderer (own <head>)
  class-ocs-brand.php          # brand meta/settings -> --studio-* CSS vars
  class-ocs-landing.php        # landing template controller
  class-ocs-hub.php            # hub index + asset modal controller
  class-ocs-quiz.php           # qualification quiz + ?step= state
  class-ocs-tracking.php       # pixels + sbm_ events (server-rendered)
  class-ocs-forms-bridge.php   # October Forms dependency + gate/remind wiring
  class-ocs-preset.php         # client.json import/export
  class-ocs-updater.php        # GitHub-release self-updater (from Hillcroft)
admin/
  class-ocs-settings.php       # brand + tracking + forms settings screen
templates/  landing.php  hub-index.php  hub-asset-modal.php  partials/
assets/  css/  js/  fonts/  img/
bin/  build-zip.sh
readme.txt                     # WP.org manifest (stays with code)
```

## Deployment workflow (target)
1. Install `october-serious-buyer` (+ `october-forms` if absent).
2. Import the client preset JSON, or fill the settings screen.
3. Upload the client logo; pick 1–2 brand colours.
4. Publish → landing page + advice hub live on the client's domain.

## Build sequence (proposed)
1. **Plugin skeleton** — bootstrap, CPTs, activator, standalone renderer/routes.
2. **Brand layer** — settings → `--studio-*` vars; port `style.css` cleaned of
   vendor selectors.
3. **Landing page** template (incl. quiz) with seeded dummy content.
4. **Advice hub** — category grids, card + gated modal, media embeds.
5. **Forms bridge** — October Forms for the consultation form, email gate, and
   the (now server-side) remind bar.
6. **Tracking** — pixels + `sbm_`/`asset_click` events from settings.
7. **Preset import/export** + **self-updater** + `build-zip.sh`.

## Open items / still needed
- [ ] Confirm plugin name / slug (`october-serious-buyer`).
- [ ] The JetEngine **listing card template** markup (the exports contain the
  grids, not the per-card template) — or I reconstruct cards from the screenshot.
- [ ] Advice-hub content model: editable CPT (recommended) vs static templates.
- [ ] Full list of live tracking IDs currently in use, to seed settings.
- [ ] Rotate the exposed Brevo key (see security finding above).
