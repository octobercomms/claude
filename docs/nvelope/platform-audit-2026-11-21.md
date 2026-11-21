# nvelope.co — platform audit

Read-only audit run from the WordPress admin, 21 November 2026. Nothing was created, edited, saved or activated.

---

## 1. Installed stack

**Theme:** JupiterX Child `jupiterx-child` v1.0.1 (active), parent JupiterX `jupiterx` v4.63.0. Inactive: Twenty Twenty-Five v1.5.

The child theme is not cosmetic. It carries the per-studio tracking injection, typography/colour CSS, the asset-gate JavaScript and three shortcodes. Treat it as application code.

**Plugins:** 21 installed, 20 active, 1 inactive, 2 must-use.

| Plugin | Version | Status | Role here |
|---|---|---|---|
| JetEngine | 3.8.9.2 | Active (update required) | Registers both CPTs and the 91 studio meta fields |
| October Forms | 1.3.0 | Active | Your own multi-step form plugin |
| Jupiter X Core | 4.63.0 | Active | Raven widgets, popups, Layout Builder |
| Elementor | 4.4.1 | Active | Page/template builder (free tier) |
| Advanced Custom Fields PRO | 6.2.6 | Active | Used only by the JupiterX `group_jupiterx_post` field group; no UI field groups exist and the licence is not activated |
| Advanced Custom Fields (free) | 6.8.12 | **Inactive** | Redundant duplicate of the above |
| Architecture Cost Calculator | 1.0.0 | Active | Your own plugin, `[arch_cost_calculator]` |
| WebP Image Optimizer | 1.1.0 | Active | Your own plugin, writes .htaccess rules |
| Brevo | 3.3.6 | Active | **Tracking / marketing** — injects the Brevo tracker site-wide |
| Complianz GDPR | 7.5.7 | Active | **Access / consent** — cookie banner and consent mode |
| Redirection | 5.10.1 | Active | **Redirects** — 301s and 404 logging |
| Site Kit by Google | 1.192.0 | Active | **Tracking** — Search Console, Analytics, PageSpeed connected |
| Performance Lab | 4.2.0 | Active | Performance features |
| Yoast SEO | 28.9 | Active | SEO |
| Yoast Duplicate Post | 4.7 | Active | **How new clients get cloned** |
| WP File Manager | 8.0.7 | Active | **Server file access from the browser** |
| Classic Editor | 1.7.0 | Active | Forces the classic edit screen, which is what renders the 91 meta fields |
| Better Search Replace | 1.4.11 | Active | DB search/replace |
| Broken Link Checker | 2.4.15.1 | Active | Link scanning |
| Enable Media Replace | 4.2.3 | Active | Swap a media file in place, keeping the URL |
| Health Check & Troubleshooting | 1.7.1 | Active | Diagnostics |

**Must-use plugins** (`/wp-content/mu-plugins/`, always on, not visible in the normal list):

- `StackCache` — Stack CP host cache wrapper. **Caching.**
- `zz-ocf-flush.php` — no version or author header. Name suggests an October Comms Forms cache flush. Contents not readable from the admin UI.

**Caching note:** StackCache sits at host level. Anything OMI writes into the site will need a cache flush path, and `zz-ocf-flush.php` is probably already doing that for forms.

---

## 2. Content model

This is the important section, so here is the headline first.

**The unit that represents one client is a `studio` post.** Everything else hangs off it: 91 meta fields on that post carry the branding, the landing page copy, the form embed, the booking embed, the per-client ad pixels and the Brevo list ID. A paired `learn` post carries the advice hub, matched to the studio only by a slug.

### Post types

| Name | Slug | Entries | Meta storage |
|---|---|---|---|
| Studio | `studio` | 7 published | Standard `postmeta` (Custom Meta Storage is off) |
| Advice Hub | `learn` | 7 published | No custom fields at all |

### Meta boxes, relations, taxonomies, CCTs

All empty:

- JetEngine Meta Boxes: none
- JetEngine Relations: none
- JetEngine Taxonomies: none
- JetEngine Custom Content Types: none
- JetEngine Options Pages: none
- JetEngine Query Builder: no saved queries
- ACF field groups in the UI: none

So there is **no formal relation object** between a studio and its advice hub. The link is string matching on slugs, described in section 4.

### JetEngine modules enabled

On: Dynamic Calendar, Listing Grid injections, **Dynamic Visibility**, Custom Content Types.
Off: Grid Gallery, Slider Gallery, QR Code, Forms (Legacy), Profile Builder, Maps Listings, Data Stores, Rest API Listings, Fullwidth Block Editor.

Dynamic Visibility is enabled but is not what gates the PDFs. See section 4.

### `studio` meta fields — all 91, in order

Tabs are JetEngine UI grouping only and store nothing.

**Fonts & Colors** (tab `fonts_colors`)

| Key | Type |
|---|---|
| `studio_logo` | media |
| `studio_logo_light` | media |
| `studio_logo_width_px` | number |
| `studio_favicon` | media |
| `studio_organisations_logos` | checkbox (`riba`, `arb`, `aia`) |
| `studio_website` | text |
| `learning_hub_slug` | text |
| `studio_slug` | text |
| `studio_footer_locations_served` | text |
| `studio_footer_contact` | wysiwyg |
| `studio_font_color` | colorpicker |
| `studio_accent_color` | colorpicker |
| `studio_hover_color` | colorpicker |
| `studio_background_color` | colorpicker |
| `studio_panel_color` | colorpicker |
| `studio_heading_font_family` | text |
| `studio_heading_font_weights` | text |
| `studio_body_font_family` | text |
| `studio_body_font_weights` | text |
| `studio_font_size_base` | text |

**Landing** (tab `landing`)

| Key | Type |
|---|---|
| `studio_intro_heading` | text |
| `studio_intro_subheading` | wysiwyg |
| `quiz_button_text` | text |
| `learn_button_text` | text |
| `learn_button_text_2` | text |
| `studio_intro_image` | media |
| `studio_intro_video` | media |
| `panel_heading_1` | text |
| `panel_text_1` | wysiwyg |
| `panel_heading_2` | text |
| `panel_text_2` | wysiwyg |
| `about_heading_1` | text |
| `about_text_1` | wysiwyg |
| `about_text_2` | wysiwyg |
| `about_image` | media |
| `how_we_work_heading_1` | text |
| `how_we_work_text_1` | textarea |
| `how_we_work_heading_2` | text |
| `how_we_work_text_2` | textarea |
| `how_we_work_heading_3` | text |
| `how_we_work_text_3` | textarea |
| `project_1_image` | media |
| `project_1_heading` | text |
| `project_1_text` | text |
| `project_2_image` | media |
| `project_2_heading` | text |
| `project_2_text` | text |
| `project_3_image` | media |
| `project_3_heading` | text |
| `project_3_text` | text |
| `call_to_action_heading` | text |
| `call_to_action_text` | text |
| `registered_practice_text` | text |

**FAQs** (tab `faqs`) — `faqs_title_1` to `faqs_title_8` (text) and `faqs_text_1` to `faqs_text_8` (wysiwyg). Sixteen flat fields, not a repeater.

**Quiz** (tab `quiz`) — `studio_form_embed` (textarea).

**Qualified & Booking** (tab `qualified`) — `qualified_heading` (text), `qualified_copy` (wysiwyg), `studio_calendar_embed` (textarea).

**Not Ready** (tab `not_ready`) — `not_ready_heading` (text), `not_ready_copy` (wysiwyg).

**Out of Scope** (tab `out_of_scope`) — `out_of_scope_heading` (text), `out_of_scope_copy` (wysiwyg).

**Scripts** (tab `assets_scripts`)

| Key | Type |
|---|---|
| `x_pixel_id` | text |
| `meta_pixel_id` | text |
| `pinterest_tag_id` | text |
| `google_ads_id` | text |
| `ga4_id` | text |
| `brevo_list_id` | text |

### What this means for an API contract

Writing a studio is `wp_insert_post( post_type = studio )` followed by `update_post_meta()` for each key above. Media fields store an **attachment ID as a string**, except `studio_intro_video`, which stores a URL. `studio_organisations_logos` stores a keyed array with string values `"true"` / `"false"`, not booleans.

One risk: the **Delete metadata** toggle on the Studio post type is switched on. If a meta field is ever removed from the JetEngine definition, its stored data is deleted from the database rather than orphaned.

---

## 3. Three live landing pages

URL pattern is `/studio/{post_slug}/`. All seven studios are published.

| | Forgeworks (ID 13) | Tiam Architects (ID 84) | LOLO (ID 1721) |
|---|---|---|---|
| URL | nvelope.co/studio/forgeworks/ | nvelope.co/studio/tiam-architects/ | nvelope.co/studio/lolo/ |
| Post type | `studio` | `studio` | `studio` |
| `studio_slug` | forgeworks | tiam-architects | lolo |
| `learning_hub_slug` | full URL to /learn/forgeworks | full URL to /learn/tiam-architects | full URL to /learn/lolo |
| `studio_logo` | 15 | 90 | 1725 |
| `studio_logo_light` | empty | empty | empty |
| `studio_logo_width_px` | 215 | 340 | 150 |
| `studio_favicon` | 76 | 91 | 1724 |
| `studio_organisations_logos` | riba true, arb false, aia false | riba true, arb true, aia false | all false |
| `studio_font_color` | #000000 | #000000 | #20283c |
| `studio_accent_color` | #000000 | #aaaaaa | #e84c08 |
| `studio_hover_color` | #ffffff | #cccccc | #e8a88d |
| `studio_background_color` | #e0e0db | #ffffff | #ffffff |
| `studio_panel_color` | #d4d4cd | #f5f5f5 | #f5f5f5 |
| Heading font / weights | Adobe Caslon Pro / 700 | Karla / 300 | Syne / 200 |
| Body font / weights | Adobe Caslon Pro / 400 | Karla / 300 | Syne / 200 |
| `studio_font_size_base` | 14 | 14 | 16 |
| `studio_footer_locations_served` | London South West | empty | empty |
| `studio_footer_contact` | 240 chars | 353 chars | 240 chars |
| `studio_intro_heading` | empty | empty | set |
| `studio_intro_subheading` | empty | empty | set |
| `studio_intro_image` | empty | 1797 | empty |
| `studio_intro_video` | URL | empty | URL |
| `about_image` | 358 | 1843 | 188 |
| `project_1/2/3_image` | 359 / 357 / 360 | 1800 / 1796 / 1799 | 185 / 184 / 186 |
| All project headings and text | empty | empty | empty |
| All panel, about and how-we-work text | empty | empty | empty |
| `registered_practice_text` | empty | empty | All rights reserved |
| FAQs | only pair 4 populated | none | none |
| `studio_form_embed` | `[nvelope_form id="1944"]` | `[nvelope_form id="1945"]` | Fillout embed div + script |
| `studio_calendar_embed` | Google Calendar iframe | empty | Google Calendar iframe **and** a Calendly widget |
| `qualified_*`, `not_ready_*`, `out_of_scope_*` | empty | empty | empty |
| `google_ads_id` | set | empty | empty |
| `meta_pixel_id` | empty | set | empty |
| `x_pixel_id`, `pinterest_tag_id`, `ga4_id` | empty | empty | empty |
| `brevo_list_id` | 2 | 8 | empty |

### What is template and what is per-client

**Always per-client, always populated:** `studio_slug`, `learning_hub_slug`, `studio_website`, `studio_logo`, `studio_logo_width_px`, `studio_favicon`, the five colour fields, the four font fields, `studio_font_size_base`, `studio_footer_contact`, `studio_form_embed`, the four project/about image IDs.

**Per-client but inconsistently filled:** `studio_organisations_logos`, `studio_footer_locations_served`, `studio_intro_heading`, `studio_intro_subheading`, `studio_intro_image`, `studio_intro_video`, `studio_calendar_embed`, `registered_practice_text`, the FAQ pairs, all five tracking IDs, `brevo_list_id`.

**Defined but effectively dead:** every `panel_*`, `about_heading_1`, `about_text_*`, `how_we_work_*`, `project_*_heading`, `project_*_text`, `call_to_action_*`, `quiz_button_text`, `learn_button_text`, `learn_button_text_2`, and the whole `qualified`, `not_ready` and `out_of_scope` tabs. Empty on all three samples. The copy you see on the live pages for those sections is coming from the template, not from these fields.

That last group is 30-odd of the 91 fields. For OMI, the write surface that actually changes a page is roughly 25 fields, not 91.

---

## 4. The advice hub and its PDFs

### Structure

`/learn/{slug}/` where the slug matches `studio_slug`. The `learn` post has an **empty post content and zero meta fields**. Everything is rendered by the Advice Hub Single template.

The studio knows its hub through `learning_hub_slug`, which stores a full absolute URL rather than a slug, duplicating information already in `studio_slug`. The hub's route back to the studio is handled in PHP by `nvelope_get_parent_studio_id_for_learn()` in the child theme, which is also what lets the hub inherit the studio's branding and tracking.

Hubs are not identical. Tiam's hub renders 20 asset cards across four sections (Fees, How it works, Process, Decisions). Forgeworks' renders 14.

### How assets are defined

Four JetEngine Listing Items, all of source type **Repeater**, all built in Elementor:

- `hub_assets_fees`
- `hub_assets_how`
- `hub_assets_process`
- `hub_assets_decisions`

No repeater meta field named `hub_assets_*` exists on either post type, and there are no meta boxes, CCTs or saved queries. I could not locate where the repeater rows are stored.

### How PDFs are attached

Not by a media attachment, not by a repeater field on the studio, not by a separate post type. The files sit **unattached in the media library** and are referenced by the listing data.

136 PDFs in the library. Naming is `{number}-{CLIENT CODE}-{Guide title}.pdf`, for example `11-TIAM-Stages-of-a-residential-project.pdf`. Every client gets their own branded copy of the same guide.

| Prefix | Files |
|---|---|
| TIAM | 24 |
| MDS | 22 |
| FOR | 16 |
| NVE | 7 |
| SGD | 11 |
| APA | 2 |
| LOLO | 0 |

So guides are shared in content and duplicated as files. Coverage is uneven: Andrew Paine has two, LOLO has none, yet both have live hub pages.

### How access is gated

This is the part worth reading twice.

Every "Download PDF" and "Watch video" button on the hub, including the ones the card labels **Free**, is the same Raven button pointing at the same popup, `raven_popup_848`. On Tiam's hub that is 29 buttons, all identical.

The popup asks for an email and says the page will refresh and unlock all resources for the session.

The gate is implemented entirely in `/wp-content/themes/jupiterx-child/assets/js/script.js`:

- Returning to the page with `?u=1` sets `sessionStorage["nvelope_unlocked_session"] = "1"`.
- The clicked asset is held in `sessionStorage` under an active-asset key.
- `shouldShowUnlocked = (asset.gated === 'free') || isSessionUnlocked()`.

Two consequences:

1. **There is no server-side protection.** The gate is a browser session flag. Anyone who sets that sessionStorage value, or who has the file URL, has the PDF. The files are in the open media library.
2. **The free/gated distinction is broken.** Each card carries the attribute `data-asset-gated="{{hub_assets_fees_gated}}"` — the literal macro text, unrendered, identical on all 20 cards including the ones in the How it works, Process and Decisions sections. Elementor does not resolve dynamic tags inside custom HTML attributes. `asset.gated` is never `'free'`, so every asset is treated as locked regardless of the badge the visitor sees.

JetEngine Dynamic Visibility is enabled as a module but is not doing the gating.

---

## 5. Forms

Four October Forms, all published.

| ID | Name | Shortcode | Submissions |
|---|---|---|---|
| 1909 | nvelope | `[nvelope_form id="1909"]` | 1 complete, 8 partial |
| 1944 | Forgeworks | `[nvelope_form id="1944"]` | 1 complete, 4 partial |
| 1945 | Tiam Architects | `[nvelope_form id="1945"]` | 2 complete, 6 partial |
| 1946 | Manolo Design Studio | `[nvelope_form id="1946"]` | 0 complete, 3 partial |

### Which studio uses which form

| Studio | Form |
|---|---|
| nvelope Architects (165) | October Forms 1909 |
| Forgeworks (13) | October Forms 1944 |
| Tiam Architects (84) | October Forms 1945 |
| Manolo Design Studio (21) | October Forms 1946 |
| S G / D (85) | **Fillout** embed |
| Andrew Paine Architecture (1640) | **Fillout** embed |
| LOLO (1721) | **Fillout** embed |

Three of seven live clients are still on Fillout. The migration is not finished.

### Representative form — 1945 Tiam Architects

Seven steps, 11 questions. Form JSON version 1, mode `standard`.

| # | Step title | Step ID | Questions (id, type) |
|---|---|---|---|
| 1 | Project type | `project_type` | `q_6xqva865` image_cards_multi |
| 2 | Property status | `s_jho5z30f` | `q_put9ulqv` image_cards_multi |
| 3 | Description | `s_j5baveqc` | `q_izr9scdq` url; `q_gei9wh6c` file_upload; `q_djh8cn9m` long_text |
| 4 | Timing | `s_ocaqzgz7` | `q_ieowqjiv` image_cards |
| 5 | Budget | `s_ezp20j68` | `q_bcdwfit8` image_cards; `q_h7wkexm9` choice |
| 6 | Contact | `s_smr46gui` | `q_edgde32s` short_text; `q_q2lueupm` email; `q_k8j9a9ni` address |
| 7 | Source | `s_821voty8` | `q_dm6dyxpa` short_text |

Question IDs are generated slugs, not semantic keys. Useful detail: because the client forms were duplicated from one master, the IDs are **stable across forms** — `q_edgde32s` is the first-name field in both 1944 and 1945. That gives OMI a usable contract, as long as nobody rebuilds a form from scratch.

### Where submissions go

All three destinations, simultaneously:

1. **Stored in WordPress** — complete and partial counts are tracked per form, with a Submissions screen.
2. **Emailed** — notification block has two CC addresses and the subject `New Lead for {form} from {email}`.
3. **Brevo** — enabled, with per-form list IDs. Form 1944 posts to list 2, form 1945 to list 8. Both match the `brevo_list_id` on the matching studio post. Contact attribute mapping is thin: only `q_edgde32s` to `FIRSTNAME`. A Brevo event `lead_form_completed` is sent, with no event properties mapped.

Brevo API credentials are configured at plugin level, not in the form. No credential values are reproduced here.

### Other form settings

- Spam: honeypot and a rate limit of 5. Turnstile is off.
- AI Assistant block exists on the form with `assistant_name`, `greeting`, `persona`, `model`, `max_messages`. The model is not set, so it appears unused.
- Endings: **one ending only**, `default`, heading "Thanks — we got it." with optional CTA and redirect. There is no routing to qualified, not-ready or out-of-scope endings, even though the studio post type has copy fields for all three states.

---

## 6. Tracking as actually installed

### Where tags are injected

| Tag | Injected by | Where |
|---|---|---|
| X / Twitter, Meta, Pinterest, GA4, Google Ads | `nvelope_output_studio_tracking_tags()` in `jupiterx-child/functions.php`, hooked to `wp_head` priority 20 | Per studio, reading the five meta fields; works on both `/studio/` and `/learn/` |
| Microsoft Clarity | `jupiterx-child/assets/js/tracking.js`, enqueued by the child theme | Site-wide, inline in `<head>` |
| Brevo tracker | Brevo plugin | Site-wide (`sibautomation.com`, `cdn.brevo.com`, `sibforms.com`) |
| Google consent mode defaults | Complianz | Site-wide `gtag('consent','default', …)` |
| Google Tag Manager loader | Present on studio pages via the gtag config | Site-wide |
| Calendly | `assets.calendly.com` | Loads on studio pages regardless of whether the client uses Calendly |

There is no Google Tag Manager container doing the work. JupiterX's own Google Analytics ID field is empty. Site Kit is connected to Search Console, Analytics and PageSpeed, but no GA4 config call appears in the page source, so Site Kit's snippet placement looks to be off.

### Conversion events

One pattern drives everything:

```
$step  = $_GET['step']  ?: 'landing';
$event = 'sbm_' . $step;
```

Fired on every page where a studio can be resolved:

| Platform | Call |
|---|---|
| Google Ads / GA4 | `gtag('event', 'sbm_{step}')` |
| Meta | `fbq('trackCustom', 'sbm_{step}')` plus `fbq('track','PageView')` |
| X | `twq('track', 'sbm_{step}')` plus `twq('track','PageView')` |
| Pinterest | `pintrk('track','custom',{event:'sbm_{step}'})` plus `pintrk('page')` |

Confirmed firing live: `sbm_landing` on `/studio/forgeworks/`, with a Google Ads config call.

So the entire conversion model depends on the `?step=` parameter being present on the URL. There are no form-submit or download events wired to the ad platforms. A completed October Forms submission sends a `lead_form_completed` event **to Brevo only**.

### Configured but broken or orphaned

- Every tag fires only if a studio ID resolves. On a client with empty pixel fields, nothing fires at all. Only Forgeworks has a Google Ads ID; only Tiam has a Meta pixel ID. `x_pixel_id`, `pinterest_tag_id` and `ga4_id` are empty on all three studios sampled, so that code path has never run in production.
- No GA4 measurement ID is set anywhere: not in the studio fields sampled, not in JupiterX, and Site Kit is not emitting one. **GA4 is effectively not collecting on client pages.**
- Calendly's script loads on pages whose booking embed is a Google Calendar iframe.
- LOLO's `studio_calendar_embed` contains both a Google Calendar iframe and a Calendly widget in the same field.
- The ad optimisation loop cannot currently be trusted with budget. `sbm_landing` is the only event with evidence of firing, and the funnel steps that would produce `sbm_qualified` and similar are not wired into the form, which has a single ending.

No pixel or measurement IDs are reproduced in this document.

---

## 7. Templates

Elementor library, 7 templates:

| Template | Type | Display conditions as reported |
|---|---|---|
| Header | Header | All Studio, All Advice Hub |
| Header (Empty) | Header | Entire website |
| Footer | Footer | No Instance |
| Single Studio | Single | No Instance |
| Advice Hub Single | Single | No Instance |
| Studio Archive | Archive | No Instance |
| Default Kit | Kit | n/a |

Two headers are active and they overlap: "Header (Empty)" is set to the entire website while "Header" targets studio and advice hub pages.

The JupiterX Layout Builder reports Single, Archive and Footer templates as inactive with no instance, yet the pages plainly render those layouts. The conditions are presumably stored where the Layout Builder panel is not reading them. I could not verify this without opening the Elementor editor, which I avoided because it risks writing.

JetEngine Listings, all source type Repeater, all Elementor-built: `hub_assets_fees`, `hub_assets_how`, `hub_assets_process`, `hub_assets_decisions`.

There are no JupiterX popup templates. The email-gate popup is `raven_popup_848`, a Raven popup element placed inside the Advice Hub Single template rather than a standalone template.

**How a new client page gets its layout:** it does not need one. Create a `studio` post and the Single Studio template renders it; create a `learn` post with a matching slug and the Advice Hub Single template renders that. Layout is automatic. Content is not.

---

## 8. What looks manual

In order, to launch one new client:

1. Create a `studio` post, set the title and slug.
2. Upload logo, favicon, intro image or video, about image and three project images. Note the attachment IDs.
3. Fill the branding fields: five colours, four font fields, base size, logo width.
4. Fill `studio_slug` and `learning_hub_slug`, the second as a full URL. **Copy-pasted, and easy to get wrong.**
5. Fill `studio_footer_contact` and locations served.
6. Duplicate an existing October Form with Yoast Duplicate Post, rename it, change the Brevo list ID. **Copy-pasted.**
7. Paste the new form shortcode into `studio_form_embed`.
8. Paste a booking embed into `studio_calendar_embed`. **Copy-pasted, and currently inconsistent between Google Calendar and Calendly.**
9. Create a Brevo list, note its ID, and enter it in **two places**: `brevo_list_id` on the studio and the Brevo block on the form. **Easy to get out of sync.**
10. Create or request the ad pixel IDs and enter them in the Scripts tab. Currently skipped for most clients.
11. Produce 20-odd branded PDFs, export each with the right `{n}-{CODE}-{title}` filename, and upload them to the media library. **The largest manual block by far.**
12. Create a `learn` post with a title and a slug matching `studio_slug`.
13. Populate the four `hub_assets_*` listings so the right PDFs appear on the right hub.
14. Publish both posts.

### Easiest to get wrong

- The Brevo list ID lives in two places and nothing validates that they match. LOLO's studio field is empty.
- `learning_hub_slug` is a hand-typed absolute URL duplicating `studio_slug`.
- PDF filenames are the only link between a file and the client it belongs to. A typo in the prefix silently serves the wrong client's branded guide.
- Forms are duplicated, so an edit to the master never reaches the copies.
- Nothing stops publishing a studio with no form, no pixels, no Brevo list or no PDFs. Three clients are live in exactly that state.

### Where OMI gets the most leverage

PDF generation and upload with the correct filename convention, plus writing the studio meta in one transaction so the Brevo ID, the form shortcode and the hub slug cannot drift. Steps 2, 4, 6, 9, 11 and 13 are the whole job.

---

## The five things I am least sure about

1. **Where the `hub_assets_*` repeater data is stored.** The four listings declare a repeater source, but there is no repeater meta field, meta box, CCT or saved query anywhere in JetEngine. The cards render with real titles, so the data exists somewhere I did not find. Until this is known, PDF publishing to the hub cannot be automated.
2. **Elementor template display conditions.** The Layout Builder reports Single, Archive and Footer as "No Instance", which contradicts what the live pages do. I did not open the Elementor editor to check, because that risks a write.
3. **Whether Site Kit injects a GA4 tag.** It reports Analytics connected, but no GA4 config call appears in the source of the pages I checked. If GA4 is genuinely not firing, the measurement gap is larger than the empty `ga4_id` fields suggest.
4. **`zz-ocf-flush.php`.** A must-use plugin with no header, running on every request. Name suggests an October Forms cache flush. Contents not readable from the admin UI.
5. **Whether any of the dead landing fields are read by the template as fallbacks.** Thirty-odd fields are empty on all three studios sampled. They may be genuinely unused, or they may be optional overrides on template defaults. That changes whether OMI should write them.

Smaller uncertainty: I sampled three studios of seven. Andrew Paine, S G / D, nvelope Architects and Manolo were only checked for their form embed.

---

## Things you may not know are there

- **The free/gated flag on every advice hub asset is broken.** `data-asset-gated="{{hub_assets_fees_gated}}"` renders as literal text on all cards, in all four sections, on every hub. Nothing is ever treated as free, and the "Free" badges on the cards are cosmetic.
- **The PDF gate is client-side only.** A sessionStorage flag set by `?u=1`. The files are unattached in an open media library.
- **Three of seven live clients still run Fillout**, not October Forms: S G / D, Andrew Paine, LOLO.
- **LOLO has a live advice hub and zero LOLO-prefixed PDFs.** Andrew Paine has two.
- **Two header templates are active at once**, one scoped to the entire website.
- **ACF free 6.8.12 is installed but inactive** alongside an active ACF PRO 6.2.6 whose licence is not activated. PRO is only serving the JupiterX `group_jupiterx_post` field group.
- **The JupiterX licence reports another domain using it**, with a warning that it may be deactivated in a future release.
- **LOLO's `studio_calendar_embed` holds both a Google Calendar iframe and a Calendly widget.** Calendly's script also loads on studio pages that do not use it.
- **The Studio post type has "Delete metadata" switched on.** Removing a field definition deletes its stored data.
- **Four pages exist outside the client structure:** Ads, Documents, Onboarding, Cost Calculator. Worth confirming whether any are publicly reachable.
- **JetEngine has an MCP Server tab** in its dashboard. If that is a native MCP endpoint, it may be a faster route for OMI than a custom connector.
- **JetEngine needs an update** and is flagged as such in the plugins list.
- **A typo is live on every advice hub:** "Want answers tailored to your proiect?"
- The advice hub CTA cites "what 106 homeowners said they value" on every client's hub, identically.
