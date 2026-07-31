# October Forms

The WordPress plugin behind [nvelope.co](https://nvelope.co) — a self-hosted, multi-client lead-generation form system. Replaces Fillout and Gravity Forms.

nvelope.co runs a separate lead-capture funnel for each client (Forgeworks is one of many). This plugin lets you author and theme one form per client, embed it on the client's landing page, and pipe submissions straight into Brevo.

## What it does

- **Two form types per form:**
  - **Standard form** — the classic multi-step form (below).
  - **AI form** — the *same* questions, but presented as a **chat**. Claude asks them conversationally, one at a time, adapts to whatever the visitor says, and extracts structured answers. When every required question is captured, the submission completes through the identical pipeline (Brevo, notification email, analytics). Powered by the Claude API; the API key lives server-side and is never exposed to the browser.
- **Multi-step forms** with progress bar, back / skip / continue, and Fillout-style image-card pickers.
- **One form per client** as a CPT — duplicate the schema, retheme, point at a different Brevo list.
- **Conditional logic** for steps and questions (`is`, `is_not`, `contains`, `is_set`, `gt`, `lt`, …).
- **File uploads** with size + type whitelist, stored under `wp-content/uploads/ocf/<form>/<submission>/` (locked down with .htaccess).
- **Partial submission capture** — every step saves to the DB so abandoned forms still capture an email.
- **Per-client theming** (colour, font, radius, logo).
- **Brevo integration** — contact upsert with attribute mapping + Track Event (both flows), with retry queue for transient API failures.
- **Spam protection** — Cloudflare Turnstile, honeypot, per-IP rate limit.
- **CSV export** of submissions.
- **Analytics dashboard** per form: views, starts, partial / completed submissions, step funnel, median time on form, daily activity chart.
- **External JSON API** (read-only, API-key auth) for piping all of this into the Platform reporting app — see [API.md](API.md).
- **Shortcode** `[nvelope_form id="123"]` and a Gutenberg block.

## Install

1. Copy the `oc-forms/` directory into `wp-content/plugins/`.
2. Activate "October Forms" in Plugins.
3. **Settings → October Forms**: paste your Brevo API key (and optionally the Marketing Automation key for `trackEvent`, plus Cloudflare Turnstile keys). For **AI forms**, also paste a Claude (Anthropic) API key and pick a default model.
4. **October Forms → Add New**: build a form from scratch in the visual builder, or open the **JSON** tab and paste in `seeds/forgeworks.json` to bootstrap from the existing Forgeworks Fillout form as a starting point.
5. Embed: `[nvelope_form id="<post_id>"]` on the client's landing page.

## Per-client setup

- Duplicate an existing form (use the **JSON** tab to copy/paste the schema between posts).
- Override theme colours / logo in the **Theme** tab.
- Map each question to the right Brevo attribute and list in the **Brevo** tab.
- Place `[nvelope_form id="..."]` on the client's landing page.

## AI forms (chat assistant)

An AI form is a normal form flipped into chat mode. You still define your questions in the builder's **Questions** tab (same editor as a standard form); the assistant works through them conversationally.

Setup:

1. **Settings → October Forms** — paste a Claude API key and choose a default model (Sonnet is the recommended balance of quality and cost; Opus is smartest; Haiku is cheapest).
2. Open a form, go to the **AI Assistant** tab, and switch **Form type** to *AI form*.
3. Set the assistant's **name**, an opening **greeting**, and a **persona / instructions** block (tone, background, rules). Optionally override the model per form and cap the conversation length.
4. Define your questions in the **Questions** tab as usual — label, type, options, required. These are the assistant's checklist, and the Brevo attribute mapping still applies.
5. Embed the same shortcode: `[nvelope_form id="…"]`.

How it works:

- The browser only ever talks to the plugin's own REST endpoint (`ocf/v1/chat`). The Claude API key never leaves the server.
- The server holds the transcript and the running set of captured answers on the submission (in the `meta` column). Each turn it sends the conversation + checklist to Claude via `wp_remote_post()` and uses [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) to get back the reply, any newly captured values, and a "complete" flag.
- The assistant **opens the conversation itself** (greeting + first question) as soon as the chat loads, so it's never an empty box.
- When it asks a choice-type question, the defined options are shown as **clickable cards/chips** (with images for image-card questions) — the visitor can click one *or* type a free-text answer.
- Captured values are cast to the same native shapes a standard form produces (arrays for multi-select, numbers, etc.), so partial capture, Brevo dispatch, notification email, and analytics all work unchanged.
- The submission only finalises when Claude signals completion **and** every required, visible question is actually filled in (the server is authoritative).
- The full chat transcript is saved and shown in the admin submission view alongside the extracted answers.

Files can't be collected in a chat, so `file_upload` questions are skipped in AI mode.

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
│   ├── class-ocf-analytics.php    view tracking + funnel / timeseries aggregations
│   ├── class-ocf-brevo.php        Brevo client (contacts + events)
│   ├── class-ocf-ai.php           Claude client + AI-form conversation engine
│   ├── class-ocf-spam.php         Turnstile + honeypot + rate limit
│   ├── class-ocf-renderer.php     shortcode + block
│   ├── class-ocf-rest-api.php     /view /start /save /upload /submit
│   └── class-ocf-public-api.php   external read-only JSON API (see API.md)
├── admin/
│   ├── class-ocf-admin.php             top-level menu + list table
│   ├── class-ocf-settings.php          Brevo, Turnstile, external API key
│   ├── class-ocf-builder.php           CPT edit-screen integration
│   ├── class-ocf-submissions-list.php  per-form submissions + CSV export
│   └── class-ocf-analytics-page.php    in-WP analytics dashboard
├── assets/
│   ├── js/frontend.js   multi-step form runtime
│   ├── js/builder.js    visual schema editor
│   ├── css/frontend.css
│   ├── css/builder.css
│   └── css/admin.css
└── seeds/
    └── forgeworks.json   importable schema for the Forgeworks form
```

The internal `OCF_` / `oc-forms` / `ocf-*` prefixes throughout the code are a historical artefact (October Comms Forms) and have no user-visible effect. The plugin presents to admins and visitors as **October Forms**.
