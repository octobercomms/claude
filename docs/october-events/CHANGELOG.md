# October Events — changelog

The plugin self-updates from GitHub Releases tagged `oe-v<version>`. Bump the
`Version:` header in `october-events.php` (and the `Stable tag` in `readme.txt`)
and merge to `main`; the release workflow builds and publishes the release
automatically.

## 1.38.1 — Contacts screen split into tabs

The Contacts screen is now tabbed: **Overview** (your list at a glance as KPI cards),
**Lists** (your lists + member counts), **Contacts** (the table), and **Import & clean**
(Brevo import, rebuild, cleanup, plain-CSV — tools last). Less wall, easier to find.

## 1.38.0 — contact CleanUp (names + company from email)

The first half of AI list-building: a deterministic enrichment pass (no API cost).

- **`OE\Mail\Enrich`** derives each contact's **company from their email domain**
  (`jane@perkinswill.com` → *Perkinswill*; skips Gmail/Outlook/etc.) and **tidies
  names** (ALL-CAPS / all-lowercase → Title Case, keeping deliberate casing like
  "DeLeo", handling hyphens, apostrophes and the "Mc" prefix).
- Runs as a **background backfill** (hourly cron) plus a **"Run cleanup"** button on
  Contacts that shows how many remain and processes them in chunks.
- New contact columns `company`, `tags`, `enriched` (DB → v8); exposed in the
  REST DTO and shown as a **Company** column in both the plugin and platform
  contact tables.

Sets up the next step: Claude classifies people (architect / designer / press / …)
into lists using these signals.

## 1.37.0 — contact lists (foundation) + Brevo import

- **Lists** — new `oe_lists` + `oe_list_members` tables and `OE\Mail\Lists` model
  (manual lists now; a `type`/`rules` column is in place for dynamic segments next).
  REST under `oe/v1/lists` (CRUD, add/remove members, import-CSV-to-a-list), and
  the contacts list endpoint can filter by `?list=ID`.
- **Campaigns can target a list** — lists appear as audiences (`list:<id>`) in the
  builder and resolve to their subscribed members on send.
- **One-shot Brevo import** — upload your Brevo export (the CSV with `_listIds`) on
  the Contacts screen; it captures every contact (name, phone), respects
  email/SMS consent, and **auto-creates &amp; assigns all your lists** (Subscribers,
  Event — Tours, Volunteers, …) by their Brevo IDs. Idempotent — safe to re-run.
- Plugin Contacts screen now shows your lists + member counts. DB schema → v7.

## 1.36.1 — updater: rate-limit back-off + balanced cache

- The self-updater now **backs off when GitHub rate-limits the token** — it reads
  the `X-RateLimit-Reset` header and waits until the limit resets (capped at an
  hour) instead of retrying and making it worse. (This was the cause of updates
  not appearing: a 403 "API rate limit exceeded", not a token problem.)
- Release-lookup cache rebalanced to **1 hour** (down from 3) — responsive without
  hammering the API. The Updates "Check again" / force-check path and the
  Settings → Updates "Test update connection" button still check instantly.

## 1.36.0 — two brand-font weights; admin polish

- **Two font uploads** in Settings → Branding: a **Body font (regular)** and a
  **Heading font (bold)**. Both register as `@font-face` under the same family — the
  regular covers body weights, the bold covers headings — so type is easier to read.
  Exposed via `oe/v1/brand` (`font_url`, `font_url_bold`) and applied in both the
  plugin admin and the platform. Leave bold blank to use the regular for everything.
- **Removed the heavy underline** beneath admin page titles (the bento sits right
  below, so the rule was redundant).
- **Platform Contacts**: the full list renders below the search and is hardened so a
  single malformed record can't blank the table.

## 1.35.0 — approval queue fully on the Dashboard; Contacts tidied

- **Approval queue** now lives **only on the Dashboard** — the standalone Approval
  Queue menu item and page are removed. The Dashboard's "Approval queue" panel is
  always shown (with a friendly empty state when nothing's pending) and lists up to
  50 items with inline Approve/Reject. The "By listing type" rows now link to that
  type's manage screen.
- **Contacts** redesigned: the management controls sit in a white bordered panel
  split into three columns with sub-headings — **Your list** (counts), **Rebuild**,
  and a smaller **Import a CSV** — with the full contact list below.
- **Settings** accordions now all start **collapsed**.

## 1.34.0 — Email moves to the platform; tools fold into Settings

Completing the "campaigns live in the platform" split.

- The standalone **Email** admin screen is removed from the menu. Its setup tools
  move into **Settings**: SES transport status + **send-a-test** + **recent log** +
  **send digest now** are now under Settings → *Email tools — test, digest & log*
  (and the SES config stays in Settings → Email sending). Campaign building was
  already in the platform; the Dashboard's "Open the platform" button is the way in.
- Contact management stays on its own **Contacts** screen; the Dashboard action bar
  now links there.

## 1.33.0 — Settings: two columns, grouped, with per-key help

- Settings now lays out in **two columns** — **This site & content** (brand, theme,
  event readiness/mapping, pricing, rejection copy, AI Stories, support chat) and
  **Connections & system** (API keys, platform/CORS, SES, digest, reminders, SMS,
  Chatwoot, updates) — to cut the scroll. Stacks to one column on narrow screens.
- **Per-API-key help** under each field: where to get it and what to paste. The
  **Stripe webhook** hint shows this site's live endpoint URL
  (`…/wp-json/oe/v1/stripe-webhook`) and the exact events to send
  (`payment_intent.succeeded`, `charge.refunded`).
- Tidy-up: removed a stale duplicate SMS sender/enable control from the reminders
  section (the real toggle lives in the SMS section); retitled the page "Settings".

## 1.32.0 — approvals on the Dashboard

The Dashboard now shows a **"Needs your approval"** panel listing pending
submissions with inline **Approve / Reject** (the same actions as the queue, and
they return you to the Dashboard). The full Approval Queue page stays for
filtering. One less click for the most common daily action.

## 1.31.0 — admin menu consolidation (phase 1)

Streamlining the plugin admin toward "setup & data here, staff ops in the platform".

- **Events** — the readiness board is now the single Events screen; the redundant
  raw Events list is removed from the menu (events still editable via their rows).
- **Tickets** — Promo codes are now a **tab** inside Tickets (Registrations |
  Promo codes); the standalone Promo Codes menu item is gone.
- **Tasks** removed from the plugin menu (it's a platform/staff tool; its data +
  REST stay so the platform is unaffected).

Still to come: surfacing the approval queue on the Dashboard, moving Email's
deliverability tools into Settings (then dropping the Email menu item), a platform
"create opportunity" action so Volunteers can leave the plugin menu too, and the
Settings reorg (grouped by page, two columns).

## 1.30.0 — platform link + Volunteers create button

- The **"Open the platform"** buttons now prefer your real custom domain over the
  `*.pages.dev` build host when no explicit Platform URL is set (set one in
  Settings to override). Fixes the button pointing at `october-platform.pages.dev`.
- **Volunteers** gains a **+ New opportunity** button (Tasks, Promo Codes and
  Tickets already had inline create forms).
- De-branded the event ticket meta box title ("ADF — Tickets" → "Tickets &
  check-in") where the ticket types, venues and the **check-in PIN** are set.

## 1.29.0 — Settings as accordions

The Settings screen is now a stack of collapsible **accordion** sections (Brand,
Event readiness, Field mapping, API keys, Pricing, AI Stories, … Branding, plus
Test the voice and Test update connection) instead of one very long page. Brand
opens by default; deep-links like `…/oe-settings#platform` auto-open and scroll to
their section. All field names are unchanged — saving works exactly as before.

## 1.28.0 — Email screen rethink + contacts pull in users

- **Email** screen rebuilt into clear panels: a "design &amp; send in the platform"
  callout with a button that **opens the platform email builder in a new tab**,
  then SES transport status + test + log, audiences, the monthly digest, and —
  at the bottom on the same page — **contact management** (count cards, rebuild,
  recent list, manage link).
- **Contacts now include all WordPress users** — `backfill()` pulls every user
  (customers, staff) into the contact list (source `user`), alongside accounts,
  ticket buyers, volunteers and submitters.

## 1.27.0 — admin redesign: dashboard + tables match the platform

Making wp-admin feel like the planning platform.

- **Dashboard** is retitled "Dashboard", leads with the same **4 headline KPI
  cards** as the platform (tickets + revenue this year, subscribers, events
  confirmed), and gains an action bar: **+ New event**, Review submissions, Email,
  plus **Scan tickets ↗** and **Open the platform ↗** buttons when configured.
- **Unified tables** — every admin table now uses the calmer, padded,
  card-style "getting-started" look (no harsh zebra), with hover and chip statuses.
- **Create affordances** — primary **+ New / + Add** buttons on the Dashboard,
  Accounts and every listing screen, plus friendly empty states.
- **New settings** — *Platform URL* (for the "open in the platform" buttons) and
  *Check-in scanner page* (where `[oe_checkin]` lives, so a Scan tickets button can
  link straight to it).

## 1.26.0 — headline KPI feed for the dashboards

- New staff endpoint **`GET oe/v1/stats`** returns the festival's headline numbers:
  tickets sold and revenue **this year**, total email subscribers, and event
  readiness (confirmed / total), plus all-time totals and currency.
- `Orders::stats()` gains **this-year** ticket + revenue figures.
- Powers the redesigned dashboards (platform + plugin admin) so both show the same
  key data.

## 1.25.0 — human hand-off from the support chat

The public support chat now has a clear escape hatch to a real person.

- A **“Talk to a person”** button in the chat header. When Chatwoot is configured
  (existing settings), it opens the site's Chatwoot widget pre-filled with the
  customer's verified email and tags the conversation as coming from the bot — so
  an agent picks up with full context. With no Chatwoot, it falls back to a
  pre-filled support email (`mailto:` with the email + transcript).
- The assistant's system prompt now invites the customer to use that button
  whenever they want a human or it can't help.

Closes the loop on the three-part chat plan: staff assistant (1.23.0) → public
customer chat (1.24.0) → human hand-off (this release).

## 1.24.0 — public AI support chat (customer-scoped)

A floating "Need help?" chat on the public site that answers customers' detailed
questions about **their own** orders and tickets instantly — without ever exposing
anyone else's data.

- **Verification first** (`OE\AI\SupportAuth`) — the visitor enters their email and
  gets a 6-digit one-time code by email; the response is identical whether or not
  that email has orders, so the endpoint can't be used to enumerate customers.
  Codes are stored hashed, expire in 15 minutes, cap wrong attempts, and the whole
  flow is rate-limited per IP. A verified code mints a short-lived HMAC-signed
  session token scoped to that exact email.
- **`OE\AI\PublicAssistant`** — Claude with tool-use, but every tool is hard-scoped
  to the verified email (the scope is bound into the executor, never taken from the
  model or the conversation). Tools: my orders, my tickets, one order's detail,
  event info (only for events the customer holds tickets to), and resend-tickets
  (to their own verified address only). The system prompt forbids discussing any
  other customer's data and offers a human hand-off for anything out of scope.
- **Public REST** `oe/v1/support/request-code`, `/support/verify`, `/support/chat`
  — public endpoints that rate-limit and re-verify the token on every turn.
- **Frontend widget** (`OE\Frontend\SupportChat`) — a self-contained, dependency-free
  floating chat (or inline via the `[oe_support_chat]` shortcode), enabled with a
  single **AI support chat** toggle in Settings. Only loads when a Claude key is set.

Built on the same engine as the staff assistant (1.23.0), but locked to one
customer. The optional Chatwoot human hand-off remains available alongside it.

## 1.23.0 — staff AI assistant (live data, tool-use)

A staff-only AI assistant that answers detailed operational questions instantly by
looking things up in the live data — no dashboards to hunt through.

- **`OE\AI\Assistant`** — Claude with tool-use over the festival's own data. Eight
  tools: events overview, single-event readiness, ticket sales (today + all-time +
  per event), order lookup (by email / order id / Stripe payment id), recent failed
  card payments (from Stripe), contact search, volunteer coverage, and campaign
  stats. The model is told to use tools and answer with real numbers, never guess.
- **`ClaudeConnector::converse()`** — runs Anthropic's tool-use loop (ask → run the
  requested tool → feed the result back → repeat, capped at 6 rounds).
- **`StripeConnector::recent_failed()`** — recent failed charges with amount, email
  and failure reason.
- **REST** `POST oe/v1/assistant` (`current_user_can('edit_posts')`) — takes the
  running conversation, returns the reply.
- **Platform** gains an **Assistant** view: a chat with suggestion chips, a typing
  indicator and lightweight markdown rendering. Read-only — it can see everything
  but changes nothing.

This is the staff engine; the public, per-order-scoped customer chat (verified by
email + confirmation) reuses it and lands separately.

## 1.22.0 — richer email builder (columns, social, alignment)

The campaign builder gains the blocks needed for proper newsletters (matching the
kind of email the team sends):

- **2-column block** — image + text side by side, in a fluid-hybrid layout that
  stacks on narrow screens without media queries.
- **Social block** — a row of follow links, each with an optional icon picked from
  the media library (falls back to a text link).
- **Alignment** (left / center / right) on heading, text, image and button.
- The **Claude co-pilot** can emit these too — its block schema + validator now
  cover `columns`, `social` and `align`.

(Platform builder UI + plugin co-pilot schema; no schema change.)

## 1.21.0 — go-live gaps (event mapping, CSV import, resilient sending)

Closes the practical gaps before connector setup:

- **Event field mapping** — Settings → Event field mapping lets you point the
  planner at your existing (e.g. JetEngine) meta keys for dates/price/location/…
  The confirm→green readiness then reads them when its own field is empty, so
  existing events show real progress instead of 0%. A **Seed planning from
  existing fields** button on Event Planning copies them in as editable values
  (non-destructive).
- **Contact CSV import** — Contacts screen now imports a CSV (e.g. a Brevo
  export); detects email + optional name/first/last/phone columns. Closes the
  last migration gap.
- **Resilient campaign sending** — besides the per-minute cron, a throttled
  traffic-driven fallback drains the send queue (and an immediate kick on send),
  so campaigns still go out on a low-traffic site where WP-cron is unreliable.
- No schema change.

## 1.20.1 — design fixes

- **Admin styles never loaded when the menu was renamed.** The admin CSS was
  enqueued by matching the page *hook*, but WordPress builds that hook from the
  (brand-named) parent menu — e.g. `festival_page_oe-queue` — so it never
  matched and wp-admin stayed unstyled (no design, unstyled bento). Now matched
  on the `page` query param (`october-events` / `oe-*`) + our CPT screens.
- **Platform page-guide bento lost its background.** Its CSS referenced
  `--side` / `--ink` / `--muted`, which aren't tokens in the design system —
  fixed to `--text` / `--text-muted` so the dark bento renders correctly.

## 1.20.0 — "what you can do" guide on every screen

Every admin screen now opens with a dark **intro bento** — a one-line "what you
can do here" + a numbered set of steps — matching the platform's hero style, so
anyone landing on a page understands it at a glance. (The platform's pages get
the same, dismissible, guide.)

## 1.19.0 — upload your own brand font

Branding now takes an **uploaded font file** as well as a stylesheet URL — for
sites that self-host their type (no Google Fonts).

- **Settings → Branding**: a family-name field + an **Upload / choose font**
  button (media library) for `.woff2 / .woff / .ttf / .otf`. Font MIME types are
  allowed for uploads (admins only).
- The uploaded file is registered as `@font-face` and applied in **both** the
  platform (via `oe/v1/brand` → `font_url`) and the wp-admin screens; blank falls
  back to Brockmann. The old "stylesheet URL" option remains as an alternative.

## 1.18.0 — admin redesign (October design system)

The wp-admin screens now match the platform's October "Marketing Intelligence"
look (minus the sidebar — wp-admin has its own): self-hosted **Brockmann**,
off-white canvas, white bento cards with 2px soft-grey borders, big display
titles and brand-yellow pill buttons. Scoped to `.oe-admin`, so the rest of
wp-admin is untouched; the accent follows **Settings → Branding** per site.

## 1.17.0 — SMS (AWS) + live chat (Chatwoot), ready to switch on

The last "add it later" services are now built and wired — off until you paste
credentials, so the plugin runs anywhere and these light up from Settings once
your AWS / Chatwoot accounts exist.

- **SMS via AWS End User Messaging** (`OE\Connectors\SmsConnector`): SigV4-signed
  `SendTextMessage` (Pinpoint SMS Voice v2), no SDK. Volunteer-reminder texts now
  route through it; it's a no-op until enabled with an access key / secret /
  region / origination identity. **Settings → SMS** (secret also accepts the
  `OE_AWS_SECRET_ACCESS_KEY` constant). US sending needs a 10DLC number.
- **Live chat (Chatwoot)** (`OE\Chat`): injects the Chatwoot widget site-wide
  when a base URL + website token are set in **Settings → Live chat**; nothing
  loads otherwise.
- **Campaign footer postal address** (CAN-SPAM) is now editable in
  **Settings → Email**.
- No schema change.

## 1.16.0 — contacts in the platform

- **REST** `oe/v1/contacts` (list + search, paginated), `/contacts/meta` (counts)
  and `POST /contact/{id}` (subscribe / unsubscribe) — auth: can-edit.
- New `Contacts::get_by_id()` and `resubscribe()` (the latter also clears the
  address from the suppression list).
- The planning platform gains a **Contacts** view: totals, a search box, a table
  of contacts (email / name / source / status) and a one-click
  unsubscribe / re-subscribe toggle. No schema change.

## 1.15.0 — email co-pilot (Claude drafts campaigns)

Phase 5 of the email platform — the differentiator. Brief Claude in plain
language and it returns a finished campaign as editable builder blocks, in the
trained house voice, grounded in live festival data.

- New `OE\Mail\Copilot`: builds a draft from a brief (+ conversation + the
  current blocks for edits), using the AI Stories voice guide + examples as the
  system prompt and a compact **festival-data context** (confirmed upcoming
  events with dates/price/location/link, recent stories) as the only source of
  facts and links.
- **Guardrails**: output is strict JSON validated against the builder's block
  schema (heading / text / image / button / divider / spacer) and sanitised;
  image blocks come back as placeholders (suggested alt, no URL — you pick the
  real image); button links must be real URLs from the data; unverifiable facts
  become visible `[TODO: confirm …]` placeholders; the model never adds the
  unsubscribe/footer (the sender does).
- **REST** `POST oe/v1/campaigns/copilot` → `{ reply, subject, preheader,
  blocks }`. The platform's campaign editor gains an **AI co-pilot** panel:
  brief it, it fills the subject/preheader and loads blocks onto the canvas;
  follow-up briefs refine the draft in place.
- Reuses the existing Claude connector + tone-of-voice training. No schema change.

## 1.14.0 — retire Brevo (native transactional email)

Brevo is removed. Now that native contacts, SES sending, deliverability and
campaigns are in place, all email is owned by the plugin — no third-party
service, no list-ID mapping.

- New `OE\Mail\Transactional`: branded native HTML templates for every triggered
  email (account welcome, payment confirmed, submission received/approved/
  rejected, ticket delivery, volunteer confirmed/declined/reminder, daily sales
  report), sent through the site Mailer (SES when configured, else the site's
  default transport).
- The **monthly digest** now sends as a native campaign to all subscribers —
  reusing the throttled sender, open/click tracking and one-click unsubscribe.
- **Removed**: the `BrevoConnector`, the Brevo API key, and the Brevo template-ID
  / list-ID mappings in Settings. Contact capture stays (native contacts already
  record every signup); audiences replace the old Brevo lists.
- The **Email** admin screen now shows the transport status, native contact/
  audience counts and the email log instead of Brevo lists.
- **SMS** via Brevo is retired; volunteer-reminder SMS is a no-op until AWS End
  User Messaging lands (email reminders are unaffected). No schema change.

## 1.13.0 — email campaigns: bulk sender + tracking (backend)

Phase 4 (backend half) of the email platform — the campaign engine the platform's
drag-and-drop builder will drive. (The builder UI lands next.)

- New `oe_campaigns` + `oe_messages` tables (DB version → 6): a campaign holds the
  builder block JSON + rendered HTML, an audience, schedule, status and stats;
  one message row per recipient with a tracking token.
- **Audiences** resolved from native contacts — *all subscribers*, *SMS opt-in*,
  or *by source* (account / ticket / volunteer / submission), each with a live
  count.
- **Throttled bulk send**: queuing skips suppressed addresses; a new per-minute
  cron tick (`oe_mail_dispatch`) drains the queue in batches of 100 through the
  site Mailer (SES), so a blast never exceeds send limits. Scheduled campaigns
  auto-start at their time.
- **Compliance built into the send path**: every message gets the
  `List-Unsubscribe` headers + an unsubscribe footer (with the configurable
  physical address), an **open pixel**, and **click-tracking** links (HMAC-signed
  so the redirect can't be abused as an open redirect).
- **REST** `oe/v1/campaigns` (+ `/{id}`, `/{id}/test`, `/{id}/send`) and
  `/audiences` for the builder. **Send test** delivers a no-tracking preview.

## 1.12.0 — deliverability spine (unsubscribe + SES bounce/complaint)

Phase 3 of the email platform — the compliance + list-hygiene plumbing that has
to exist before any bulk send.

- **One-click unsubscribe** (`OE\Mail\Unsubscribe`): a signed, no-login link
  (`?oe_unsub=…&k=…`) + the `List-Unsubscribe` / `List-Unsubscribe-Post` headers
  email clients use for their built-in unsubscribe button (RFC 8058). Hitting it
  adds the address to the suppression list and marks the contact unsubscribed; a
  hosted confirmation page is shown for the GET link.
- **SES bounce/complaint ingestion** (`OE\Mail\SnsController`): a public
  `POST oe/v1/ses-sns` endpoint for the SNS topic SES publishes to. Permanent
  bounces and complaints are auto-suppressed (and the contact unsubscribed),
  keeping bounce/complaint rates low so AWS doesn't throttle. Every message's
  **SNS signature is verified** against the AWS signing certificate first, and
  subscription confirmations are auto-confirmed.
- No schema change (uses the existing suppression + contacts tables).

## 1.11.0 — native contacts (kills the manual import)

Phase 2 of the email platform: a unified, de-duplicated contact list built from
the data the plugin already owns, so contacts never have to be imported by hand
again.

- New `oe_contacts` table (auto-created on upgrade; DB version → 5): email
  (unique), name, phone, sms_opt_in, source, status.
- `OE\Mail\Contacts` — `capture()` (insert/merge, de-duped on email, fills blanks
  only, never silently re-subscribes), `backfill()` from accounts, ticket buyers
  and volunteers, plus search/counts/unsubscribe.
- **Forward-fill**: every account creation, ticket order, volunteer signup and
  listing submission now also captures a native contact (alongside the existing
  Brevo upsert), so the list stays current.
- **Contacts** admin screen: totals (subscribed / unsubscribed / SMS opt-in), a
  recent list, and a one-click **Rebuild from existing data**.
- Honours the suppression list — a suppressed email is captured as unsubscribed.

## 1.10.0 — email foundation: Amazon SES site mailer + log + suppression

Phase 1 of the email platform (see docs/october-events/EMAIL-PLATFORM.md). October
Events can become the site's outgoing-mail transport, so the SMTP/log plugins can
be retired. **Off by default** — until SES is enabled and configured, the site's
mail is untouched.

- **Amazon SES transport**: when enabled, all `wp_mail()` routes through SES via
  SMTP (configured on `phpmailer_init`), with a configurable From name/address.
- **Email log** (`oe_email_log`): every send recorded (to, subject, status,
  driver, error) — replaces "Check & Log Email". Visible under **Email**, with a
  **send-test** button.
- **Suppression list** (`oe_suppression`): unsubscribes/bounces are honoured on
  every send — suppressed recipients are stripped, a fully-suppressed message is
  skipped. (SES→SNS bounce ingestion comes in a later phase; the table + checks
  exist now.)
- **Settings → Email (Amazon SES)**: enable, region, SMTP user/password
  (encrypted at rest, or `OE_SES_SMTP_PASSWORD`), From name/address.
- New tables auto-create on upgrade (DB version → 4). Degrades gracefully: with
  no SES config the mailer is a transparent logger.

## 1.9.0 — platform branding (per-site theme)

The planning platform now adopts the October "Marketing Intelligence" design
system, and each site can override the look from here.

- **Settings → Branding (platform theme)**: accent colour, text-on-accent,
  sidebar colour, page background, light/dark **logo** URLs, and an optional
  **custom font** (family + stylesheet URL). Blank = the built-in October
  defaults (Brockmann + brand yellow).
- New **public** REST endpoint `GET oe/v1/brand` (no auth — the platform's
  sign-in screen themes before login) returns the brand name + any non-empty
  overrides; the platform applies them as CSS variables at runtime.
- No schema change.

## 1.8.3 — CORS: take sole ownership on our routes (beats JetEngine for real)

1.8.2 still lost: JetEngine's `rest_pre_serve_request` CORS callback runs *after*
even a `PHP_INT_MAX` handler, so cleaning up afterwards couldn't win — the live
preflight still returned two `Access-Control-Allow-Origin` values
(`…pages.dev`/custom domain **and** `*`).

- `OE\Cors` now hooks `rest_pre_dispatch` (which runs *before*
  `rest_pre_serve_request`) and, for `/oe/v1` requests only, **removes every other
  `rest_pre_serve_request` handler** — core's origin echo and JetEngine's blanket
  `*` alike — so our handler is the single source of CORS on our routes. Entries
  are unset directly, so closure-based callbacks are caught too. JetEngine's CORS
  is untouched on its own routes.

## 1.8.2 — CORS: win against late header appenders (JetEngine)

Follow-up to 1.8.1. On sites running **JetEngine**, every REST response gets a
blanket `Access-Control-Allow-Origin: *` appended *after* core's CORS — so our
1.8.1 handler (which ran at priority 20) cleaned up too early and the stray `*`
came back, leaving two values and a blocked browser request.

- `OE\Cors` now runs at **`PHP_INT_MAX`** on `rest_pre_serve_request`, so it's the
  last code to touch the headers: it strips the duplicate `Access-Control-Allow-
  Origin` (core's echo + JetEngine's `*`) and emits exactly one value for an
  allowed origin. Only affects `oe/v1` routes; JetEngine's own CORS is untouched
  elsewhere.

## 1.8.1 — CORS for the planning platform

Lets the off-site planning platform SPA call the `oe/v1` REST API from the
browser. WordPress core echoes the request Origin already, but many hosts /
security plugins *also* add a blanket `Access-Control-Allow-Origin: *`, and a
browser rejects a response that carries the header twice ("contains multiple
values … but only one is allowed").

- New `OE\Cors`: for `oe/v1` routes it takes ownership of the CORS headers —
  strips whatever was set (core's echo + a stray `*`) and emits exactly one
  valid `Access-Control-Allow-Origin` for an allowed origin, plus a clean
  preflight (methods, `Authorization`/`Content-Type` headers).
- **Settings → Planning platform (CORS)**: the allowed origins, one per line.
  Defaults to `october-platform.pages.dev` and
  `platform.atlantadesignfestival.net`, so it works out of the box.
- Note: PHP can only override headers it set; if a duplicate `*` is added by the
  web server itself (Apache `Header always set`, nginx `add_header`) it must be
  removed there.

## 1.8.0 — volunteer management API

A REST surface over the existing volunteer signups so the platform can give
Ashleigh a full management view (the same operations as the wp-admin Volunteers
screen, friendlier). No schema change — it reads/writes the existing
`oe_volunteer_signups` table.

- **REST** `oe/v1/volunteers/*` (auth: can-edit):
  - `GET /volunteers/opportunities` — every opportunity with capacity vs filled
    across its shifts and how many signups still need a decision.
  - `GET /volunteers/opportunity/{id}` — shifts (capacity, spots left, full) with
    the signups attached to each.
  - `POST /volunteers/opportunity/{id}/signup` — manually place a volunteer on a
    shift (bypasses the open/capacity gate; staff-placed signups start confirmed
    and still fire the confirmation + reminders).
  - `POST /volunteers/signup/{id}` — set status (confirm / decline / no-show /
    re-open) and/or toggle check-in.
  - `DELETE /volunteers/signup/{id}` — remove a signup.
- New read models on `OE\Volunteers` (`opportunity_summary`,
  `opportunity_detail`, `signup_dto`) and a `for_opportunity` query.

## 1.7.0 — shared Tasks

A shared, department-grouped task list for the whole team (replacing the
single-user Notion board) — org-wide, so it lives on the hub and is exposed to
the platform.

- New `oe_tasks` table (auto-created on upgrade; DB version → 3).
- **Tasks** admin screen: add/edit, grouped by department, inline status change
  (To do / In progress / Blocked / Done), due date, assignee, notes, delete.
- **REST** `oe/v1/tasks` (+ `/task/{id}`, `/tasks/meta`) — list/create/update/
  delete for the platform's Tasks board (auth: can-edit-events).
- Departments default to the festival's existing groups (Admin, Advertising,
  Content Marketing, Email, PR, Media Partners, Partners & Sponsors, Social,
  Website Dev, Website Support, Uncategorized).

## 1.6.0 — event planning + confirm→green (PM platform phase 1)

The first slice of the project-management platform, in the plugin (usable in
wp-admin now; the same data feeds the platform UI later via REST).

- **Confirm→green gating engine** (`OE\Planning\Gating`): an event can only be
  confirmed once the required fields are complete. Default required set = Elayne's
  essentials — **title, dates & times, price, location** — configurable under
  **Settings → Event readiness**.
- **Event planning** (`OE\Planning\Events`): canonical event info + sessions +
  internal notes stored as `_oe_plan_*` meta on the `events` CPT.
- **Event readiness meta box** on each event: a live checklist, the planning
  fields, a sessions list, and a **Confirm — go green** button that's disabled
  until complete. Confirming **publishes** the event to the public site;
  un-confirming returns it to in-progress.
- **Event Planning** admin screen: every event with a completion meter, status,
  and what it still needs.
- **REST** (`oe/v1/planning/*`): list events, read/update one, and confirm — the
  endpoints the platform's Events board will use (auth: can-edit-events).
- No schema/table changes; status auto-drops from green if a confirmed event later
  becomes incomplete.

## 1.5.0 — renamed to October Events (multi-site)

The plugin is renamed from **ADF Festival** to **October Events** so one codebase
can run on multiple sites (Atlanta Design Festival, Architecture Tours, …) under a
per-site brand set in **Settings → Brand**.

- Identifiers renamed: namespace `ADF\` → `OE\`, constants `ADF_*` → `OE_*`, text
  domain, slug (`october-events`), REST namespace (`oe/v1`), shortcodes (`oe_*`),
  release tags (`oe-v*`), and the data identifiers — tables (`wp_oe_*`), options
  (`oe_*`), and post meta (`_oe_*`) / our CPT slugs (`oe_*`).
- **One-time data migration** (`Activator::migrate_legacy()`, idempotent): renames
  the old `adf_*` tables/options/meta and `adf_*` post types to `oe_*` on first
  load — no manual data work.
- **Back-compat shims** (`Compat`): the old `[adf_*]` shortcodes still render, and
  the old `adf/v1/stripe-webhook` URL still works, so live pages and the Stripe
  webhook keep functioning during the transition.
- The encryption-key derivation is kept stable so secrets stored before the rename
  still decrypt.
- **Manual steps for the live ADF site** (slug change ⇒ the self-updater can't
  cross to the new slug automatically):
  1. Upload/activate the **October Events** plugin once (it migrates the data),
     then deactivate the old "ADF Festival" plugin.
  2. Rename any `ADF_*` constants in `wp-config.php` to `OE_*`
     (e.g. `ADF_STRIPE_SECRET_KEY` → `OE_STRIPE_SECRET_KEY`).
  3. Update the Stripe webhook URL to `…/wp-json/oe/v1/stripe-webhook` (the old
     `adf/v1` alias keeps working until you do).
  4. Set the site's display name under **Settings → Brand**.
- No feature changes; ads remain in the standalone oc-ad-manager plugin.

## 1.4.0 — separate the Ad Manager

## 1.4.0 — separate the Ad Manager

- **Removed the ad module from this plugin.** Ads are a cross-site ad network, not a
  festival-specific feature, so they now live solely in the standalone **oc-ad-manager**
  plugin (the festival site runs both). Bundling them in 1.0.0 was the wrong call; this
  corrects it and slims the festival plugin (63 → 48 PHP files).
- Removed: `ADF\Ads\*` (campaigns/creatives/tracking/bookings/serving/partner), the Ads
  admin screens, the `[adf_ad]` / `[adf_ad_book]` shortcodes, the ad REST endpoints
  (`/ad-render`, `/ad`, `/ad-promo`, `/ad-book-intent`) + the webhook `ad_booking` branch,
  the `wp adf migrate-ads` command, and all ad/syndication settings.
- No effect on tickets, listings, volunteers, email/SMS, or the self-updater.
- **Note:** the `adf_ad_*` tables from 1.0.0–1.3.0 are left in place (harmless) rather than
  dropped; remove them manually if you never used the bundled ad system.

## 1.3.0 — security hardening

Addresses the findings from the security audit (IDs reference the audit report):

- **ADF-01 (High) — payment-amount tampering on ticket checkout.** `/ticket-confirm`
  now derives the order solely from the verified PaymentIntent's metadata and
  rejects any order whose total exceeds the amount actually captured, instead of
  re-pricing from the (attacker-controllable) request body.
- **ADF-02 (High) — forged Stripe webhooks.** Unsigned webhook events are now
  rejected unless `ADF_ALLOW_UNSIGNED_WEBHOOK` is explicitly set (local dev only),
  closing free-ticket / fake-"paid" forgery when no signing secret is configured.
- **ADF-03 — check-in PIN brute force.** PIN attempts are throttled per IP+event
  (lock after 10 failures for 15 min).
- **ADF-04 — missing rate limiting / unauth upload.** Per-IP rate limits added to
  the public `ticket-intent`, `ticket-promo`, `volunteer-signup` and `ad-book-intent`
  endpoints; ad-booking uploads are now size- (≤5 MB) and MIME-checked before
  hitting the media library.
- **ADF-05 — secrets at rest.** API keys and the GitHub token are now encrypted in
  the database with libsodium (`Crypto`), keyed off `ADF_ENCRYPTION_KEY` or the WP
  salts. wp-config constants remain the recommended, DB-free option.
- **ADF-06 — confirm-payment authorization.** A listing's payment can only be
  confirmed by its own submitter.
- **ADF-07 — log hygiene.** The debug logger redacts sensitive keys and truncates
  long values (e.g. API response bodies).
- **ADF-08 — reproducible builds.** `composer.lock` is now committed so release
  builds pin exact dependency versions.

## 1.2.0

- **Editable API keys in admin** — Settings → API keys now has fields for the
  Stripe / Brevo / Claude / Google Maps keys with a show/hide (eye) toggle. A
  wp-config.php constant still wins where defined and locks its field; otherwise
  the entered key is stored in the database.
- **Automatic table upgrades** — a DB-version check (`ADF_DB_VERSION`) builds any
  new/changed tables on load via idempotent `dbDelta`, so updates no longer need a
  manual deactivate/reactivate. (1.0.0 → 1.2.0 sites get the ticketing/ads tables
  automatically.)
- **Bundled QR libraries** — `qrcode.min.js` (qrcodejs) and `html5-qrcode.min.js`
  are now shipped, so printed tickets render scannable QR codes and the check-in
  camera scanner works out of the box (no external CDN).

## 1.1.0

Major feature release — full Event Tickets + Ad Manager parity, backend manual
entry throughout, a door check-in PWA, and AI tone-of-voice training.

**AI Stories**
- Editable tone-of-voice training: a house style guide + example pieces feed
  Claude's system prompt on every generation, with a live "Test the voice" box.

**Ticketing (now relational: `adf_orders` / `adf_tickets` / `adf_checkins` / `adf_promo_codes`)**
- Multiple ticket types per event — price, sale price, "admits N" group tickets,
  per-type capacity and sale windows, event-wide sale close, check-in venues + PIN
  (event meta box).
- Orders → tickets model with unique 64-hex tokens; promo codes (percent/fixed,
  event-scoped, expiry, max-uses).
- Public Stripe checkout (`[adf_event_checkout]`) with server-side re-pricing and a
  webhook backup; order-confirmation email.
- Admin Registrations screen with manual comp/paid order entry, cancel + Stripe
  refund, CSV export; Promo Codes CRUD; sales totals + daily sales report.
- QR check-in PWA (`[adf_checkin]`): PIN-gated, camera scanning with manual
  fallback, valid/already/invalid overlays, check-in log.

**Ads (now `adf_ad_campaigns` / `adf_ad_creatives` / `adf_ad_tracking` / `adf_ad_bookings`)**
- Campaign + creative CRUD with a media-library picker (full manual entry),
  cap-aware random rotation, impression/click tracking with de-duplication.
- Ad serving (`[adf_ad]`) via a cache-safe REST render; tracked click redirect.
- Self-serve booking (`[adf_ad_book]`): creative uploads + packages + promo +
  Stripe; admin Activate creates the live campaign; per-campaign report.
- Hub/partner ad syndication (API-key-gated `/ad` feed + cached partner proxy).

**Migrations** — `wp adf migrate-tickets` / `migrate-ads` now import the legacy
plugins' real tables 1:1 (preserving ticket check-in tokens).

**Note:** the relational ticketing/ads tables are created on activation. Since
1.0.0 is already live, deactivate/reactivate once after updating to create the
new tables, then run the migrations.

## 1.0.0

Initial release: accounts, listings (directory/destinations/products/events/
stories), submission/approval, Stripe payments, Brevo email + SMS, volunteer
opportunities with shift signups and reminders, the AI Stories connector, the
Destinations map, the monthly digest, WP-CLI migrations, and the GitHub
self-updater.
