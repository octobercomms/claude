# Harvest brief — for Claude for Chrome

**Goal:** collect everything needed to rebuild the nvelope "Serious Buyer"
landing page + advice hub as a self-contained WordPress plugin
(**October Serious Buyer**), faithfully, in one pass. You (Claude for Chrome)
are logged into the live WordPress site as admin. Work through each section,
**export/save the actual files** where asked, and paste the requested values
into a single running notes document. Save everything into one folder named
`serious-buyer-harvest/` with the subfolders indicated.

Reference sites: landing = `https://nvelope.co/studio/nvelope/`, advice hub =
`https://nvelope.co/learn/nvelope/`, master = `https://octobercomms.com/serious/`.

> ⚠️ **Do this first:** in **Brevo → SMTP & API → API Keys**, rotate/revoke the
> existing key. A live private key is currently exposed in the site's
> client-side JavaScript. Note the *new* key's existence (do **not** paste the
> key value into notes) so we know it's rotated.

---

## 1. Rendered front-end — every page type and state
Save each as **"Webpage, Complete"** (HTML + assets folder) into
`serious-buyer-harvest/rendered/`. Also take a **full-page screenshot** of each.

- [ ] Landing page `/studio/nvelope/` — desktop **and** mobile width (~390px).
- [ ] Advice hub `/learn/nvelope/` — desktop and mobile.
- [ ] The landing **qualification quiz**: capture each state as you click
  through. Note the URL at each step (watch the `?step=` parameter) and save the
  HTML at: the pre-quiz choices, each question, and **every result/outcome
  panel** ("Based on what you've shared…"). List which answer leads to which
  outcome.
- [ ] An advice-hub **asset popup — FREE**: click a Free card, save the open
  popup HTML, screenshot it (PDF card and a video card if both exist).
- [ ] An advice-hub **asset popup — GATED**: click a gated (salmon, "Email
  required") card, save the locked popup + the email-gate form.
- [ ] The **unlocked** state: complete/skip the gate so you return with `?u=1`,
  then re-open a gated card and save the unlocked popup.
- [ ] The **remind-me** sticky bar (`#remind-bar` / `.remind-form`) — save its
  markup and screenshot; note where it appears.
- [ ] The **cookie/consent** banner (Complianz) — screenshot + note settings.

For each saved page also do **View Source** and save the raw HTML (some dynamic
markup differs from the rendered DOM).

## 2. Real design-token values (the "brand")
From **WP admin → the `nvelope` Studio post → Custom Fields / JetEngine meta**,
record the *actual current values* into notes (these become our defaults):

- [ ] `studio_body_font_family`, `studio_heading_font_family`
- [ ] `studio_body_font_weights`, `studio_heading_font_weights`
- [ ] `studio_font_size_base`
- [ ] `studio_font_color`, `studio_accent_color`, `studio_hover_color`,
  `studio_background_color`, `studio_panel_color`
- [ ] `studio_logo_width_px`, `studio_favicon` (note the image URL)
- [ ] The tracking IDs on this Studio: `x_pixel_id`, `meta_pixel_id`,
  `pinterest_tag_id`, `ga4_id`, `google_ads_id` (record which are set).
- [ ] `brevo_list_id`, `brevo_template_id`, `studio_brevo_form_uid`,
  `studio_form_embed` (Fillout).

Also, from the front-end `<head>`, note the exact **Google Fonts** `<link>` URL
being loaded, and download any self-hosted fonts (e.g. Adobe Caslon Pro) from
`/wp-content/uploads/fonts/` into `serious-buyer-harvest/fonts/`.

## 3. Elementor templates — export all
**WP admin → Templates → Saved Templates** (and Theme Builder). Use each
template's **Export** to download the JSON into
`serious-buyer-harvest/elementor/`:

- [ ] Single Studio (landing) template.
- [ ] Single Learn / Advice Hub template.
- [ ] **The header** template and **the footer** template.
- [ ] **Every popup** template (Raven/JupiterX popups — e.g. IDs like 848). We
  specifically need the **asset popup** and any **email-gate popup**.
- [ ] Any section/block templates reused across the pages.

## 4. JetEngine definitions — the missing card + data model
This is the biggest gap. From **WP admin → JetEngine**:

- [ ] **Listings (Listing Items):** open the advice-hub **card/listing template**
  used by the grids. Export it if possible; otherwise save its HTML/structure and
  screenshot the editor. We need the card markup: title, standfirst, tags
  (Free/PDF/Video, read/watch time), buttons, and the free/gated logic.
- [ ] **Post Types:** for each CPT (`studio`, `learn`, and the advice
  **asset/guide** type if separate) — list every **meta field**: name, type,
  and options. Screenshot each meta-box config.
- [ ] **Relations:** open **relation ID 6** (Studio↔Learn). Note parent/child
  types and how children are attached.
- [ ] **Taxonomies / categories** used to split assets into Fees / How it works /
  Process / Decisions — list the taxonomy name and term slugs.
- [ ] For each **Listing Grid** on the hub page, note its **query** (post type,
  taxonomy filter per section, posts-per-page, ordering).
- [ ] Any **Dynamic Tags / macros** or JetEngine "Dynamic Field" callbacks used
  in the card (these tell us which meta maps to which visible element).

## 5. Advice content — the full dummy set (for seeding)
For **every** advice asset/guide across all four categories, record into a table
in notes (one row per asset) so the plugin can seed identical dummy content:

- [ ] category, title, standfirst, body text
- [ ] type (PDF / video), free or gated
- [ ] read/watch time label
- [ ] file URL (PDF) or video URL (YouTube/Vimeo/Loom)
- [ ] the asset `uid` if shown
- [ ] Download each referenced **PDF** and note each **video URL** into
  `serious-buyer-harvest/assets/`.

Also capture the landing page's **FAQ accordion**: every question + answer.

## 6. Forms & the quiz logic (to rebuild in October Forms)
- [ ] **Consultation / "Book a free consultation"** form: open it and record
  every field (label, type, required), the submit behaviour, and where the lead
  goes (Fillout form structure, or the Brevo form). Screenshot each step.
- [ ] **Email gate** form (unlocks gated assets): fields + what it does on
  submit (how does it set `?u=1` / unlock the session?).
- [ ] **Remind-me** bar: confirm it posts to Brevo (list + transactional
  template) — note the list ID and template ID (values, not the API key).
- [ ] **Qualification quiz:** write out the full logic — each question, each
  answer option, the branching, and the outcome shown for each path (this is the
  heart of the "serious buyer" method).

## 7. Tracking & analytics — full inventory
- [ ] List every pixel/tag actually firing (from `?step=landing` page source):
  X, Meta, Pinterest, GA4, Google Ads — with their IDs.
- [ ] Note every custom event name fired (`sbm_*`, `asset_click`, etc.) and when.
- [ ] Is there a **GTM** container? If so, note the container ID and export the
  container (GTM → Admin → Export Container) if you have access.

## 8. Any other custom code
- [ ] **WPCode / Code Snippets / mu-plugins**: list and copy every active PHP or
  JS snippet not already in the child theme's `functions.php`.
- [ ] **Customizer → Additional CSS** and any Elementor "Custom CSS" on the
  Studio/Learn templates.
- [ ] Header/footer scripts (theme options or a plugin).
- [ ] The active plugin list (screenshot **Plugins → Installed**) so we know
  every dependency in play.

## 9. Brand assets
Into `serious-buyer-harvest/assets/`:
- [ ] Logo (all variants), favicon, trust badges (RIBA / ARB / AIA), any icons/
  SVGs used in "How we work", hero/section images.

---

## Deliverable
Zip `serious-buyer-harvest/` (rendered pages, elementor JSON, fonts, assets,
PDFs) **plus** the running notes document (tokens, field definitions, relation
config, listing queries, the content table, the quiz logic, tracking inventory,
extra code). Upload that here. With it we can build the plugin as a working
model in one focused pass rather than round-tripping for missing detail.
