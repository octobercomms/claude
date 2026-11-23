# nvelope-theme

The `jupiterx-child` theme from nvelope.co, as it stood on 23 November 2026.

Here for the record and as the specification for its replacement, not as the
thing to keep editing. The plan is to move its application code into a plugin
and leave the theme as presentation; until that lands, the live site is still
the running copy and this is a snapshot.

Planning, findings and the sequence live with the rest of nvelope:

**→ `docs/nvelope/agent-guide.md`**

One thing that belongs in both places. `assets/remind-form.js` carried a live
Brevo API key on line 1, in a file enqueued on every page load, so it was
readable with view-source. It was revoked on 23 November 2026 and the value is
not in this repo.

Scope, for proportion: that key belonged to the Brevo account nvelope uses,
which is separate from the accounts behind October's other products, and
nvelope had no active clients at the time. So the exposure was nvelope's own
lead lists and nothing else.

The rule still holds. A Brevo key is account-wide within its account: whoever
holds it can export every contact, send as the account and delete lists. Do not
put another one in client-side JavaScript. The replacement posts to WordPress
and keeps the key in `wp_options`, which is where `oc-forms` already holds its
own (`ocf_brevo_api_key`).
