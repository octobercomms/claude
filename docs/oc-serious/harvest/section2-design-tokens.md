# Section 2 — Design tokens (Studio post, ID 165, JetEngine meta box "Settings")

Correction to brief: the Settings meta box is **JetEngine** (CSS classes prefixed `je-`, `cx-` —
Crocoblock's Cx UI kit), not ACF, even though "ACF" also appears in the admin sidebar (ACF is
installed but not what drives this box — don't assume ACF field structure when rebuilding).

Tabs in the meta box: Fonts & Colors / Landing / FAQs / Quiz / Qualified & Booking / Not Ready /
Out of Scope / Scripts.

## Colors & typography (all confirmed live values)
| Field | Value |
|---|---|
| `studio_font_color` | `#8e8e7b` |
| `studio_accent_color` | `#4b4b40` |
| `studio_hover_color` | `#ffffff` |
| `studio_background_color` | `#d8d6d4` |
| `studio_panel_color` | `#ecece9` |
| `studio_heading_font_family` | `Inter` |
| `studio_heading_font_weights` | `200` |
| `studio_body_font_family` | `Inter` |
| `studio_body_font_weights` | `200` |
| `studio_font_size_base` | `16` |
| `studio_logo_width_px` | `250` |

## Logo / favicon
| Field | Value |
|---|---|
| `studio_logo` (dark) | `https://nvelope.co/wp-content/uploads/2026/01/logo-envelope.svg` |
| `studio_logo_light` | (empty on this Studio) |
| `studio_favicon` | `https://nvelope.co/wp-content/uploads/2026/01/logo-envelope-icon.svg` |
| `studio_organisations_logos` | RIBA + ARB checked (AIA present as an option but need to
  re-confirm checked state — screenshot shows RIBA/ARB ticked, scroll cut off AIA) |

## URLs / slugs
| Field | Value |
|---|---|
| `studio_website` | `https://nvelope.co/studio/nvelope/` |
| `learning_hub_slug` (Advice Hub URL) | `https://nvelope.co/learn/nvelope/` |
| `studio_slug` | `nvelope` |

## Tracking IDs — all EMPTY on this Studio
`x_pixel_id`, `meta_pixel_id`, `pinterest_tag_id`, `ga4_id`, `google_ads_id` are all blank on the
nvelope Studio itself. Don't assume any are firing on this reference property — re-check Section 7
via page source / GTM rather than relying on these fields being populated. `brevo_list_id` = `6`
(matches relation/Section 4's "relation ID 6" note — worth double-checking these are the same "6"
or a coincidence).

## Form / booking / video embeds
- `studio_form_embed` = `[nvelope_form id="1909"]` — **this is a shortcode from a custom "October
  Forms" plugin already installed on the site** (visible in the wp-admin sidebar menu), NOT
  Fillout as the brief assumed. Follow up: open "October Forms" → form 1909 in wp-admin to get
  its field schema (Section 6).
- `studio_calendar_embed` = present, 655 chars (likely a Calendly/booking iframe embed — not yet
  extracted in full, low priority vs. the form itself)
- `studio_intro_video` = `https://nvelope.co/wp-content/uploads/2026/02/nvelope-square.mp4`
  (self-hosted MP4, not YouTube/Vimeo — matches the autoplay video seen in the hero)

## Other field names present in this meta box (values not yet pulled — mostly landing page copy,
lower priority since it's readable straight off the rendered page)
about_heading_1, about_image, about_text_1, about_text_2, call_to_action_heading,
call_to_action_text, faqs_text_1..8, faqs_title_1..8, how_we_work_heading_1..3,
how_we_work_text_1..3, learn_button_text, learn_button_text_2, not_ready_copy, not_ready_heading,
out_of_scope_copy, out_of_scope_heading, panel_heading_1..2, panel_text_1..2, project_1..3_heading
/image/text, qualified_copy, qualified_heading, quiz_button_text, registered_practice_text,
studio_intro_heading, studio_intro_image, studio_intro_subheading, studio_footer_contact,
studio_footer_locations_served

## Still to check
- [ ] Google Fonts `<link>` in `<head>` — need exact URL (expect `family=Inter:wght@200` given
      the weights field, but should confirm rather than assume)
- [ ] Self-hosted fonts folder `/wp-content/uploads/fonts/` — check if it exists / has content
      (Adobe Caslon Pro etc. mentioned in brief may not apply to THIS studio if it's using Inter
      throughout — the brief's font reference may be aspirational/from another property)
- [ ] `brevo_template_id` and `studio_brevo_form_uid` fields named in the brief do **not** appear
      to exist as JetEngine fields on this post — the actual gate form is a hardcoded Brevo
      iframe embed inside Raven popup 848 (see section1-popups-forms.md), not a per-studio
      configurable field. Flag this mismatch to Daniel — the plugin's data model should probably
      make this configurable even though the reference implementation hardcodes it.
