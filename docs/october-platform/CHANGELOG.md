# October Platform — changelog

The platform is the vanilla, no-build ES-module SPA in `dev/october-platform/`,
auto-deployed to Cloudflare Pages on merge to `main`.

## Per-page URLs (hash routing)

Each page now has its own URL — `…/#/events`, `…/#/contacts`, `…/#/assistant`, etc.
So a **refresh lands back where you were**, links are shareable, and the browser
back/forward buttons work. Nav clicks, dashboard shortcuts and the campaign
"back" all update the URL; on load the page is restored from it (defaulting to the
dashboard). No server config needed — it's hash-based, which works on static
hosting. Deep-links like `…/#/email` also work (e.g. from the plugin).

## Advanced email editor (GrapesJS)

The campaign builder now has two modes, switched at the top of the editor:

- **Simple builder** — the existing block-by-block builder (heading, text, image,
  button, columns, social, divider, spacer) with the AI co-pilot and live preview.
- **Advanced (drag & drop)** — a full visual HTML editor powered by **GrapesJS**
  (0.21.13) with the **newsletter preset** (1.0.2), for pixel-level control and
  pasting/editing rich HTML emails.

Details:

- The GrapesJS bundle is **self-hosted** (`assets/vendor/`, MIT) and **lazy-loaded**
  the first time Advanced mode is opened, so it never weighs on initial page load.
- Switching to Advanced seeds the canvas from your current simple blocks (or the
  previously saved advanced project), so work carries over.
- On save, Advanced mode exports **inlined** HTML to `body_html` (what actually
  gets sent) and stores the editable GrapesJS project in `body_json` under an
  `{"__mode":"advanced"}` marker — so reopening restores the canvas. Simple-mode
  campaigns are unchanged (`body_json` stays a block array). The send path is
  untouched: it always uses `body_html`.
