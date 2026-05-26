# October Forms

Multi-step lead generation forms for WordPress — a self-hosted replacement for Fillout and Gravity Forms tailored to the way [nvelope.co](https://nvelope.co) collects leads for its architecture clients.

## What it does

- **Multi-step forms** with progress bar, back/skip/continue, and Fillout-style image-card pickers.
- **Per-client forms** as a CPT — one form per client. Clone & tweak.
- **Conditional logic** for steps and questions (`is`, `is_not`, `contains`, `is_set`, `gt`, `lt`, …).
- **File uploads** with size + type whitelist, stored under `wp-content/uploads/ocf/<form>/<submission>/` (locked down with .htaccess).
- **Partial submission capture** — every step saves to the DB so abandoned forms still capture an email.
- **Per-form theming** (colour, font, radius, logo).
- **Brevo integration** — contact upsert with attribute mapping + Track Event (both flows), with retry queue for transient API failures.
- **Spam protection** — Cloudflare Turnstile, honeypot, per-IP rate limit.
- **CSV export** of submissions.
- **Shortcode** `[oc_form id="123"]` and a Gutenberg block.

## Install

1. Copy the `oc-forms/` directory into `wp-content/plugins/`.
2. Activate "October Forms" in Plugins.
3. **Settings → October Forms**: paste your Brevo API key (and optionally the Marketing Automation key for `trackEvent`, plus Cloudflare Turnstile keys).
4. **October Forms → Add New**: build a form. Or open the **JSON** tab and paste in `seeds/forgeworks.json` to import the Forgeworks form from your existing Fillout setup as a starting point.
5. Embed: `[oc_form id="<post_id>"]` on any page.

## Per-client setup

- Duplicate an existing form post (use the **JSON** tab to copy/paste schema).
- Override theme colours / logo in the **Theme** tab.
- Map each question to the right Brevo attribute and list in the **Brevo** tab.
- Place `[oc_form id="..."]` on the client's landing page.

## Replacing Fillout & Gravity

The intent is to retire both subscriptions. The trade-offs:

- This plugin does not yet have: form analytics dashboards, partial-submission email triggers (you can do this through Brevo automations on the contact), or third-party integrations beyond Brevo. If you need Slack, Zapier, etc., use the `ocf_after_submit` action hook:
  ```php
  add_action( 'ocf_after_submit', function ( $submission_id, $form_id, $answers ) {
      // post to Slack, Zapier webhook, whatever.
  }, 10, 3 );
  ```
- Failed Brevo calls are retried hourly via WP-Cron up to 5 attempts.

## File layout

```
oc-forms/
├── oc-forms.php              bootstrap
├── includes/
│   ├── class-ocf-activator.php
│   ├── class-ocf-schema.php   schema shape + sanitization
│   ├── class-ocf-cpt.php      registers ocf_form CPT
│   ├── class-ocf-logic.php    server-side conditional logic eval
│   ├── class-ocf-submission.php   DB model
│   ├── class-ocf-brevo.php    Brevo client (contacts + events)
│   ├── class-ocf-spam.php     Turnstile + honeypot + rate limit
│   ├── class-ocf-renderer.php shortcode + block
│   └── class-ocf-rest-api.php /start /save /upload /submit
├── admin/
│   ├── class-ocf-admin.php           top-level menu + list table
│   ├── class-ocf-settings.php        Brevo + Turnstile keys
│   ├── class-ocf-builder.php         CPT edit-screen integration
│   └── class-ocf-submissions-list.php
├── assets/
│   ├── js/frontend.js   the multi-step form runtime
│   ├── js/builder.js    the visual schema editor
│   ├── css/frontend.css
│   ├── css/builder.css
│   └── css/admin.css
└── seeds/forgeworks.json   ready-to-import schema mirroring the Fillout form
```
