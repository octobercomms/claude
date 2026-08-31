# Section 7 — Tracking & analytics inventory (from live page source, `/studio/nvelope/`)

Confirms and extends the Section 2 finding that the per-Studio pixel fields
(`x_pixel_id`/`meta_pixel_id`/`pinterest_tag_id`/`ga4_id`/`google_ads_id`) are all empty on this
reference Studio — none of X/Meta/Pinterest/Google Ads actually fire on nvelope. What DOES fire:

| Pixel/tag | Present? | ID(s) |
|---|---|---|
| Google Analytics 4 (`gtag`) | **Yes** | `G-V85R42JXZH` (appears 3×, main property) and `G-EQDN3BWDSD` (appears once — possibly a Site Kit auxiliary or leftover property; worth Daniel confirming which is intentional) |
| Google Tag Manager | No | no `googletagmanager.com/gtm.js` reference, no `GTM-XXXX` container ID anywhere — GA4 is loaded directly via gtag.js, not proxied through a GTM container. **No GTM container exists to export.** |
| Meta/Facebook Pixel (`fbq`) | No | — |
| Pinterest tag (`pintrk`) | No | — |
| Google Ads (`AW-XXXX`) | No | — |
| **Microsoft Clarity** | **Yes (not in the original brief's list)** | confirmed via live network request during the Section 6 quiz walkthrough: `POST https://e.clarity.ms/collect` firing repeatedly as the chat was used. This is session-recording/heatmap tracking, not a studio-level field — likely injected globally (Site Kit doesn't do Clarity, so this is either a separate snippet or a theme option Script). Flag as an extra to account for in the plugin. |

GA4 is most likely wired through **Site Kit by Google** (confirmed installed and active in
Section 8's plugin list) rather than a per-Studio field — Site Kit typically injects gtag.js
site-wide from its own settings, which would explain why the JetEngine `ga4_id` field on the
Studio post is empty but GA4 still fires.

## Custom event names (`sbm_*`, `asset_click`, etc.)
Not confirmed via live network sniffing in the time available — the brief's expected place to
find these is `class-ocf-analytics.php` (October Forms plugin, Section 8), which was located but
not fully read. **Recommended next step**: open that file in the Plugin File Editor
(Plugins → Plugin File Editor → October Forms → `includes/class-ocf-analytics.php`) the same way
class-ocf-ai.php and class-ocf-rest-api.php were read in Section 8 — screenshot-scroll through it
for the actual event constant names, rather than relying on live traffic sniffing.

## GTM container
Confirmed: **no GTM container is in use on this property.** Nothing to export for Section 7's GTM
ask.
