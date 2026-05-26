# nvelope Forms

The WordPress plugin behind [nvelope.co](https://nvelope.co) — a self-hosted, multi-client lead-generation form system. Replaces Fillout and Gravity Forms.

nvelope.co runs a separate lead-capture funnel for each client (Forgeworks is one of many). This plugin lets you author and theme one form per client, embed it on the client's landing page, and pipe submissions straight into Brevo.

## What it does

- **Multi-step forms** with progress bar, back / skip / continue, and Fillout-style image-card pickers.
- **One form per client** as a CPT — duplicate the schema, retheme, point at a different Brevo list.
- **Conditional logic** for steps and questions (`is`, `is_not`, `contains`, `is_set`, `gt`, `lt`, …).
- **File uploads** with size + type whitelist, stored under `wp-content/uploads/ocf/<form>/<submission>/` (locked down with .htaccess).
- **Partial submission capture** — every step saves to the DB so abandoned forms still capture an email.
- **Per-client theming** (colour, font, radius, logo).
- **Brevo integration** — contact upsert with attribute mapping + Track Event (both flows), with retry queue for transient API failures.
- **Spam protection** — Cloudflare Turnstile, honeypot, per-IP rate limit.
- **CSV export** of submissions.
- **Shortcode** `[nvelope_form id="123"]` and a Gutenberg block.

## Install

1. Copy the `oc-forms/` directory into `wp-content/plugins/`.
2. Activate "nvelope Forms" in Plugins.
3. **Settings → nvelope Forms**: paste your Brevo API key (and optionally the Marketing Automation key for `trackEvent`, plus Cloudflare Turnstile keys).
4. **nvelope Forms → Add New**: build a form from scratch in the visual builder, or open the **JSON** tab and paste in `seeds/forgeworks.json` to bootstrap from the existing Forgeworks Fillout form as a starting point.
5. Embed: `[nvelope_form id="<post_id>"]` on the client's landing page.

## Per-client setup

- Duplicate an existing form (use the **JSON** tab to copy/paste the schema between posts).
- Override theme colours / logo in the **Theme** tab.
- Map each question to the right Brevo attribute and list in the **Brevo** tab.
- Place `[nvelope_form id="..."]` on the client's landing page.

## Sample schemas

The `seeds/` directory holds reference schemas for individual clients. They're imported through the builder's **JSON** tab.

- `forgeworks.json` — the Forgeworks form: project type, property status, brief + uploads, timing, budget, contact, source.

Add new client schemas to `seeds/` as you migrate them off Fillout, so they live in version control next to the plugin.

## Replacing Fillout & Gravity

The intent is to retire both subscriptions. The trade-offs:

- This plugin does not yet have: form analytics dashboards, partial-submission email triggers (you can do this through Brevo automations on the captured contact), or third-party integrations beyond Brevo. If you need Slack, Zapier, etc., use the `ocf_after_submit` action hook:
  ```php
  add_action( 'ocf_after_submit', function ( $submission_id, $form_id, $answers ) {
      // post to Slack, fire a Zapier webhook, whatever.
  }, 10, 3 );
  ```
- Failed Brevo calls are retried hourly via WP-Cron up to 5 attempts.

## File layout

```
oc-forms/
├── oc-forms.php              bootstrap
├── includes/
│   ├── class-ocf-activator.php
│   ├── class-ocf-schema.php       schema shape + sanitization
│   ├── class-ocf-cpt.php          registers the form CPT
│   ├── class-ocf-logic.php        server-side conditional logic eval
│   ├── class-ocf-submission.php   DB model
│   ├── class-ocf-brevo.php        Brevo client (contacts + events)
│   ├── class-ocf-spam.php         Turnstile + honeypot + rate limit
│   ├── class-ocf-renderer.php     shortcode + block
│   └── class-ocf-rest-api.php     /start /save /upload /submit
├── admin/
│   ├── class-ocf-admin.php           top-level menu + list table
│   ├── class-ocf-settings.php        Brevo + Turnstile keys
│   ├── class-ocf-builder.php         CPT edit-screen integration
│   └── class-ocf-submissions-list.php
├── assets/
│   ├── js/frontend.js   multi-step form runtime
│   ├── js/builder.js    visual schema editor
│   ├── css/frontend.css
│   ├── css/builder.css
│   └── css/admin.css
└── seeds/
    └── forgeworks.json   importable schema for the Forgeworks form
```

The internal `OCF_` / `oc-forms` / `ocf-*` prefixes throughout the code are a historical artefact (October Comms Forms) and have no user-visible effect. The plugin presents to admins and visitors as **nvelope Forms**.
