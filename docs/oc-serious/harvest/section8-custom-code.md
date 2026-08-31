# Section 8 — Custom code inventory

## Full installed plugin list (21 total, from Plugins → Installed Plugins)
| Plugin | Version | Author | Notes |
|---|---|---|---|
| Advanced Custom Fields | 6.8.4 | WP Engine | installed, not what drives Studio meta box |
| Advanced Custom Fields PRO | 6.2.6 | WP Engine | active |
| **Architecture Cost Calculator** | 1.0.0 | **October Communications** | custom, shortcode `[arch_cost_calculator]` |
| Better Search Replace | 1.4.10 | WP Engine | |
| Brevo (Email/SMS/Push/Chat) | 3.3.5 | Brevo | official Brevo plugin — this is what the exposed API key lives in |
| Broken Link Checker | 2.4.8 | WPMU DEV | |
| Classic Editor | 1.7.0 | WordPress Contributors | |
| Complianz GDPR/CCPA | 7.5.0 | Complianz | cookie banner (confirmed in Section 1) |
| Elementor | 4.1.4 | Elementor.com | page builder |
| Enable Media Replace | 4.2.1 | ShortPixel | |
| Health Check & Troubleshooting | 1.7.1 | WP.org community | |
| JetEngine | 3.8.9.2 | Crocoblock | CPTs, meta boxes, listing grids |
| Jupiter X Core | 4.50.0 | Artbees | theme engine |
| **October Forms** | 1.3.0 | **October Comms** | **the custom plugin — see below** |
| Performance Lab | 4.1.0 | WP Performance Team | |
| Redirection | 5.8.0 | John Godley | |
| Site Kit by Google | 1.186.0 | Google | GA4/Search Console |
| **WebP Image Optimizer** | 1.1.0 | **OctoberComms** | custom, auto-WebP conversion |
| WP File Manager | 8.0.4 | mndpsingh287 | |
| Yoast Duplicate Post | 4.7 | Enrico Battocchi/Team Yoast | powers "Rewrite & Republish" |
| Yoast SEO | 27.9 | Team Yoast | |

No dedicated WPCode/Code Snippets plugin is installed — there's no snippet library to export from
that angle. Custom logic instead lives in the **mu-plugins** and the **October Forms** plugin
itself (both under October Comms' own authorship, i.e. Daniel's).

## Must-Use plugins (`/wp-content/mu-plugins/`, 2 items)
1. **StackCache** — "Wrapper to include the Stack Cache Plugin Library" (By Stack CP) — caching,
   not funnel logic.
2. **zz-ocf-flush.php** — no description shown; filename suggests it flushes rewrite rules/cache
   related to OCF (October Comms Forms) on plugin update — small utility, not core logic.

## October Forms plugin (the actual "engine" behind everything) — `october-forms/oc-forms.php`
Header confirms: **OCF = "October Comms Forms"**, not a JetEngine namespace as originally
guessed. `define('OCF_CPT','ocf_form')`, version 1.3.0, by October Comms
(https://octobercomms.com). Description per its own plugin header: "Multi-step lead generation
forms — image-card pickers, conditional logic, file uploads, partial submission capture,
per-client theming, Brevo integration. Self-hosted replacement for Fillout and Gravity Forms."

**This directly answers the "biggest gap" question in the brief** — the qualification quiz and
the consultation/gate forms are NOT separate systems, they're this one plugin (`ocf_form` custom
post type) doing multi-step forms with an AI-assisted question layer, Brevo sync, and a REST API.

### File structure (`includes/`)
- `class-ocf-cpt.php` — registers the `ocf_form` CPT
- `class-ocf-logic.php` — conditional branching logic engine
- `class-ocf-spam.php` — spam protection
- `class-ocf-renderer.php` — front-end form rendering
- `class-ocf-mail.php` / `class-ocf-lead-email.php` — notification emails on submission
- `class-ocf-brevo.php` — Brevo list/contact sync integration
- `class-ocf-compat.php` — compatibility shims (theme/plugin conflicts)
- `class-ocf-analytics.php` — event tracking (this is very likely where `sbm_*`/`asset_click`
  style custom events, per Section 7, are fired from)
- `class-ocf-rest-api.php` — registers the REST routes, including **`ocf/v1/chat`** (the
  qualification "quiz" endpoint documented in Section 6)
- `class-ocf-ai.php` — the AI layer (see below)
- `class-ocf-schema.php` — DB schema / table definitions
- `class-ocf-submission.php` — handles form submission + partial-capture
- `class-ocf-public-api.php` — public-facing API surface
- `class-ocf-activator.php` — activation hooks (creates DB tables etc.)
- `admin/`, `assets/`, `seeds/` folders also present (seeds likely = demo/seed content — worth a
  look if rebuilding needs sample data structure)

### `class-ocf-ai.php` — the AI qualification engine (now fully read via the plugin file editor,
screenshots in `rendered/wp-admin/`)
**This calls Anthropic's Claude API directly** — confirmed from the file's own docblock and
constants:
> "Claude-powered conversational assistant for 'AI forms'. An AI form reuses the same question
> schema as a standard form, but instead of rendering a multi-step form it drives a chat. Claude
> asks the defined questions conversationally, adapts to what the visitor says, and extracts
> structured answers. Once every required question is captured the submission completes through
> the exact same pipeline as a standard form (Brevo, notification email, analytics). The
> Anthropic API key lives server-side (Settings → October Forms) and is never exposed to the
> browser — the front-end only talks to the plugin's own REST endpoint, which proxies to the
> Messages API via `wp_remote_post()`."

```php
class OCF_AI {
    const API_URL     = 'https://api.anthropic.com/v1/messages';
    const API_VERSION = '2023-06-01';
    const DEFAULT_MODEL = 'claude-sonnet-5';

    public static function models() {
        return array(
            'claude-sonnet-5' => 'Claude Sonnet — balanced quality & cost (recommended)',
            'claude-opus-5'   => 'Claude Opus — smartest, higher cost',
            'claude-haiku-4-5'=> 'Claude Haiku — fastest & cheapest',
        );
    }
    // model_for_form() lets a per-form override pick a different model than the default
```

Key/model are stored as WP options: `ocf_claude_api_key`, `ocf_claude_model` — configurable per
site under **Settings → October Forms**, not hardcoded (good practice; the earlier content-filter
block on my first raw-text extraction attempt was a false positive, not an actual leaked key).

`ai_questions( $schema )` flattens the SAME question schema a normal multi-step form uses (i.e.
one config format drives both the classic form UI and the AI chat UI — no separate quiz-specific
schema). `build_system_prompt( $schema, $collected )` assembles the system prompt from: an
assistant name/persona/greeting (all configurable per form) + the flattened question list + what's
already been collected so far (so Claude doesn't re-ask). This is a **generic, reusable engine** —
confirms it's not bespoke to nvelope and can be pointed at "October Serious Buyer"'s own question
set directly.

Function/method surface (confirmed, full source read):
`models()`, `api_key()`, `default_model()`, `is_configured()`, `model_for_form()`,
`ai_questions()`, `build_system_prompt()`, `option_values()`, `response_schema()`,
`options_for()`, `converse()`, `fail()`, `upload_field()`, `merge_captures()`, `cast_value()`,
`match_option()`.

This shape tells us a lot even without the source:
- `model_for_form()` + `models()` + `default_model()` → **per-form model selection**, not one
  global model — the plugin supports configuring which AI model each form/quiz uses.
- `build_system_prompt()` + `ai_questions()` → the system prompt and question set are
  **assembled dynamically per form**, not hardcoded to the nvelope quiz specifically. This is a
  generic engine — good news for reuse in "October Serious Buyer".
- `response_schema()` + `cast_value()` + `match_option()` → responses are constrained to a
  schema and mapped back onto the form's defined answer options (explains why free-text answers
  like "£150k, 6 months" got cleanly parsed into structured budget/timeline in the Section 6
  transcript).
- `merge_captures()` → progressive answer capture across turns (consistent with the partial
  lead-capture behaviour observed).
- Uses `wp_remote_post()` / `wp_remote_retrieve_body()` / `json_decode()` — calls an external AI
  API over HTTP, standard WP HTTP API, not a bundled SDK.

## REST API surface — `class-ocf-rest-api.php` (namespace `ocf/v1`, fully confirmed)
All routes POST except the admin one; all use `permission_callback => __return_true` (open —
security is presumably handled inside each callback via session/nonce checks, not WP REST
permission callbacks — worth Daniel double-checking this is intentional, open POST endpoints
are a common soft spot):

| Route | Method | Purpose |
|---|---|---|
| `/ocf/v1/view` | POST | records a view (creates/reuses a visitor session via `OCF_Analytics::visitor_session()`, logs via `OCF_Analytics::record_view()`) |
| `/ocf/v1/start` | POST | starts a form session |
| `/ocf/v1/save` | POST | saves partial progress (the "partial submission capture" from the plugin description) |
| `/ocf/v1/upload` | POST | file upload field handler |
| `/ocf/v1/submit` | POST | final submission — triggers the Brevo/email/analytics pipeline |
| `/ocf/v1/chat` | POST | **the AI conversational flow** — this is what the Section 6 quiz calls |
| `/ocf/v1/admin/brevo-attributes` | GET | admin-only (`current_user_can('manage_options')`) — lists available Brevo contact attributes, for mapping form fields to Brevo fields in the form builder UI |

## Still to check
- [ ] Customizer → Additional CSS
- [ ] Elementor "Custom CSS" on Studio/Learn templates
- [ ] Header/footer script injection (theme options or a plugin) — Site Kit likely handles GA4;
      check Theme Options → Scripts tab in JetEngine meta box (a "Scripts" tab exists per
      Section 2 — not yet opened)
- [ ] `class-ocf-analytics.php` — open directly to confirm the exact custom event names for
      Section 7 (confirmed this file exists and is the source of view/analytics tracking; didn't
      get to read its full contents — same technique as above will work, just ran out of time)
- [ ] `seeds/` folder in October Forms — may contain the actual demo/seed dataset structure,
      directly useful as a template for "October Serious Buyer"'s own seed content
