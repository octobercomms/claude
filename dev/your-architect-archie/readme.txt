=== Your Architect â Archie ===
Contributors: octobercomms
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 8.3
Stable tag: 0.7.35
License: GPLv2 or later

Archie â the conversational, fixed-price project builder for Your Architect. A
two-panel AI assistant (embeddable with [archie] or the Elementor widget) that
builds a homeowner's drawing package and price through a short chat, opens a
project record, and gates the full drawings behind payment.

== Description ==

Drop `[archie]` onto any page (or use the "Archie" Elementor widget). Archie asks
a few plain-English questions; the panel builds the package and a fixed price as
the visitor answers. The server owns the conversation and the pricing â Claude
never states a price. A project record is created from the first message (cookie),
so a returning visitor resumes.

Full studio workflow: a submitted project is approved, the client gets a
Claude-drafted confirmation email, pays via an embedded Stripe Payment Element on
a token-gated portal, and their drawings unlock there (served blurred + watermarked
until paid). Analytics track the funnel + revenue. Only the live **Historic England**
lookup and optional **Stripe Connect** payouts remain to wire.

== Setup ==

1. Install + activate (creates the tables and the "Your project" portal page).
2. Archie Projects â Settings â Claude API key; Stripe secret/publishable +
   webhook secret; Brevo API key + from name/address; portal page; rate limits.
3. Add `[archie]` (or the Elementor widget) to your homepage.
4. Point a Stripe webhook at `/wp-json/yaa/v1/stripe-webhook` (and, for tracking,
   a Brevo webhook at `/wp-json/yaa/v1/brevo-webhook`).

Mail should go via Brevo or an SMTP plugin. Rate limits + the daily token cap
protect your Claude spend. On Nginx, add a deny rule for `uploads/yaa-secure/`.

== Changelog ==

= 0.7.35 =
* The SMTP "Send test email" screen now shows the actual PHPMailer/SMTP error on
  failure (e.g. authentication failed, could not connect, IP not authorised)
  instead of only the generic "could not send it" line — so a misconfigured relay
  is diagnosable at a glance.

= 0.7.34 =
* Performance: Archie's web font (Plus Jakarta Sans) now loads non-render-blocking
  (print-media swap with a noscript fallback) and preconnects to the Google Fonts
  origins, so it no longer adds to first-paint/main-thread work on a heavy page.
  Text shows immediately in the system-font fallback and upgrades once the font
  arrives. (Page-level speed still depends on the site's other scripts — this just
  makes sure Archie isn't part of the problem.)

= 0.7.33 =
* Fixed the remaining first-load scroll problem on phones. Shortly after the page
  loaded, Archie auto-scrolled the window (smoothly) as the opening message
  rendered — which fought the visitor's own finger-scroll and made the page feel
  frozen for a second or two. First load is now completely passive: Archie never
  moves the page until the visitor actually types, taps a reply, or adds a photo,
  and it no longer grabs the keyboard focus on load. Once they're in the
  conversation, the page still follows new messages (instantly, never animating
  against a drag).

= 0.7.32 =
* Smaller chat header on phones. The "Talk to Archie — your personalised price
  builds as you answer" line wrapped to six lines and ate the top of the screen;
  on mobile it's now a single compact "Talk to Archie" line next to Start over, so
  the conversation is visible straight away. The full line still shows on desktop.

= 0.7.31 =
* Fixed the mobile scroll freeze. On phones the embedded chat was a full-height app
  with its own scrolling message pane (and a fixed bottom-sheet summary with a
  second inner scroll), nested inside the scrolling page. On touch, the inner pane
  swallowed the drag and wouldn't hand it back to the page, so the page appeared
  frozen until layout settled — and the finished quote summary couldn't be scrolled
  to. The embed now flows in the page as a single scroll surface: no inner scroll
  panes, the composer sticks to the bottom of the viewport while you're in the chat,
  and the full quote summary and submit button sit directly beneath, always
  reachable by scrolling.
* Archie now shows a "thinking" indicator the moment the chat loads, so it never
  looks like a blank panel while the first message is fetched.
* New messages scroll the page to follow the conversation (previously an inner pane
  that no longer exists), and finishing the chat scrolls the summary into view.

= 0.7.30 =
* SMTP credentials can now be supplied from wp-config.php constants or environment
  variables (YAA_SMTP_HOST / PORT / SECURE / USER / PASS / FROM) so the relay key
  is never stored in the database or committed anywhere. Defining YAA_SMTP_HOST is
  enough to turn the relay on. Any constant/env value overrides the matching
  Settings field, so you can keep host/port/login in Settings and supply only the
  key from wp-config. Intended for routing all outbound mail through Brevo's relay.
* Every message now leaves as the aligned From address (forced), so nothing slips
  out as the WordPress default and breaks SPF/DKIM alignment, and a relay send that
  fails is logged rather than silently reverting to the unsigned PHP mail() path.
* Added a 15-second relay timeout so a slow or dead SMTP host can't hang a request.

= 0.7.29 =
* Archie now knows the practice's credentials. When a visitor asks whether Your
  Architect is a real or qualified architect, for the ARB registration number, who
  the trading entity is, or in whose name invoices are issued, Archie states the
  facts confidently — ARB registration 091365K & 091921G, Tiam Architects LLP,
  company number OC437815 — instead of deflecting to "check the ARB website". The
  numbers come from the ARB / Company fields in Settings, so they stay editable,
  and Archie still offers arb.org.uk as independent verification.

= 0.7.28 =
* One-click updates — no more uploading zips. A GitHub Action now publishes each
  new version as a release, and the plugin's new self-updater surfaces it under
  Dashboard → Updates like any other plugin. One-time setup: install this version,
  then in Archie → Settings → Software updates paste a GitHub fine-grained token
  (Contents: read on the octobercomms/claude repo), Save, and hit "Test update
  connection". After that, every future version is a one-click update.

= 0.7.27 =
* Lighter, sharper Archie face. Swapped the 50KB PNG avatar used in the chat
  header and on every message for the 8.8KB SVG of the same face — ~42KB less to
  download on first load and crisper on high-resolution phone screens.

= 0.7.26 =
* Fixed the mobile chat being almost unusable. The embedded chat used a small
  fixed-height scroll box nested inside a scrolling page, so the two fought each
  other — you couldn't scroll and could only see half of a question. On phones
  Archie now fills the screen as a proper app: one scroll area for the
  conversation, the composer pinned above it, and the price/"Save & submit" panel
  as a tap-up sheet at the bottom (always reachable). Also dropped the heavy drop
  shadow on mobile, which was hurting scroll performance.

= 0.7.25 =
* Fixed a critical error on submit. Project submission could fail with a WordPress
  "critical error" when the notification emails were slow or errored (e.g. a
  hanging SMTP relay tripping the max-execution-time limit). The studio/client
  notifications are now sent AFTER the response reaches the client and are fully
  isolated — a mail problem can no longer delay or break a submission the customer
  has already completed. The project reference is also generated before sending.
* The chat no longer shows a raw error or a false "Submitted ✓" if a submit ever
  does fail — it now shows a friendly "please try again" message and re-enables the
  button.
* Phone question no longer shows tap buttons (they made no sense for a phone number). Archie now asks it as a plain open question and tells the person they can simply type "no" to skip it.

= 0.7.24 =
* Tightened the optional phone question wording — dropped the apologetic "no problem if you'd rather stick to email" line. It's still optional (tap to skip), just asked plainly rather than apologetically.

= 0.7.23 =
* Optional phone number. After the email question, Archie now asks softly for a
  phone number as a just-in-case ("if a quick question came up that might hold
  your drawings up…"), with tap-to-skip. It's genuinely optional — never blocks
  finishing — and shows on the project record and the studio/client emails when
  given.
* Terms as a question + auto-submit. When the quote is ready, Archie asks the
  client to confirm they're happy with the Terms and Privacy Policy, with an
  "I agree — submit my project" button in the chat. On agreement the Save & submit
  button runs a short visible countdown ("Submitting in 0:05 · send now") and
  submits itself — or sends instantly if they click it. The button stays for
  anyone who'd rather just press it, and typing another message cancels the
  countdown so they can keep editing. Consent timestamp recorded at submit. This
  targets quote-ready leads who never pressed submit.

= 0.7.22 =
* Secret keys can now be cleared. Each secret field (Claude, Stripe, Brevo, SMTP
  password) shows a "Clear this key" tickbox when a value is stored — tick it and
  save to remove the key. Previously a blank field kept the saved value, so there
  was no way to unset one (e.g. to turn Brevo off and route everything via SMTP).
* New "Avg questions answered" stat tile on the Archie Projects list — the mean
  number of questions answered across all submissions, so you can see at a glance
  how far people get into the chat, not just whether they finished.

= 0.7.21 =
* Every email now sends from the configured "Email from address" (Settings),
  not a hardcoded noreply@. The client emails (quotes, summaries, resume nudges,
  sign-in links, revision alerts) previously went out as noreply@<domain>, which
  an authenticated SMTP relay (e.g. StackMail logging in as info@domain) can
  reject because the mailbox doesn't exist. They now use the same real, relay-
  accepted sender as the staged emails. Still overridable via the
  yaa_notify_from_email filter.

= 0.7.20 =
* Built-in SMTP delivery (Archie → Settings → "Email delivery (SMTP)"). Route
  every email through an authenticated relay instead of raw server mail, so
  quotes and summaries land reliably and pass SPF/DKIM — no separate WP Mail SMTP
  plugin needed. Password stored encrypted; a one-click "Send test email" button
  confirms it works. Leave the Brevo API key blank to send everything through the
  relay (and get our own open/click tracking on the staged emails too).
* "Limited stats" chip on the email log (row + detail panel) for recipients whose
  provider makes open tracking unreliable — Outlook/Hotmail (blocks tracking
  images, so opens under-count) and Apple iCloud/Mail Privacy Protection
  (pre-loads images, so opens over-count). A reminder that, for those, clicks are
  the honest signal. This is provider-level and the same whether we send via
  Brevo or SMTP.

= 0.7.19 =
* Our own open + click tracking on **every** email the system sends — not just the
  staged client emails. Quote copies, new-enquiry and revision alerts, portal
  sign-in links, project summaries and resume nudges now all carry a tracking
  pixel and click-wrapped links, so engagement is visible whether or not an ESP
  is configured. (Opens rely on image loading — Gmail/Apple Mail can hide or
  inflate them — so clicks are the stronger signal.)
* Every open and click is recorded as its own timestamped event, so you can see
  exactly when a recipient opened a message and how many times — not just a
  single first-seen time.
* Rebuilt the Email log: headline stats (delivered, opened %, clicked %, failed),
  an Engagement column on each row, a per-row **Resend** button, and clicking a
  row now slides in a detail panel on the right (full delivery facts, the
  open/click history with timestamps, and the message as sent) instead of loading
  a separate page. Resending a quote regenerates it with the latest price.

= 0.7.18 =
* Fixed the "Projects (submitted)" and "Conversion rate" tiles on the Projects
  list reading 0 when projects had moved past submission. "Submitted" now counts
  every project that reached submission or beyond (approved, in progress, preview,
  paid), and recovered chats are left out of the conversion base.

= 0.7.17 =
* Fixed the "Email the client their quote" button not showing on a project at the
  "Quoted" stage (the exact case it's needed for) — it now appears on any
  unpaid project that has a priced quote and an email on file.

= 0.7.16 =
* The "Save & submit project" button now pulses and glows once the quote is
  ready, drawing the eye to it — kept exactly where it is, beside the terms.
* The quote is now actually emailed the moment a customer gives their email (not
  only on submit), so the "we'll email your quote" promise is kept, it lands in
  the email log, and they have their fixed price to return to. That email carries
  a "Finish & submit your project" button that reopens their saved quote on any
  device (via a secure link) so they can accept the terms and submit — it never
  submits on its own.
* New "Email the client their quote" button on a project, to resend on demand.
* New "Chat page URL" setting (where the Archie chat lives), used by that email
  button; blank uses the home page.

= 0.7.15 =
* Prompt caching cuts the AI cost. Archie's large, unchanging instructions are
  now cached and re-read at roughly a tenth of the price on every turn after the
  first — about half the cost per conversation. The Analytics cost card shows the
  cache hit rate and the cheaper estimate.
* Returning visitors are recovered. When someone submits, any earlier abandoned
  chats from the same address are folded into that lead (new "Recovered" tab and
  badge in Projects) and no longer counted as drop-offs, so the conversion rate
  reflects unique leads rather than every restart.

= 0.7.14 =
* The project-summary email now asks the client to send their existing drawings
  when they said they have some but didn't upload, and replies to that email now
  reach the studio.
* Clients can request more than one change from the portal — the form stays
  available after each request, and their past requests are listed.
* The Email log is now clickable: open any row to see the actual message that was
  sent (the full HTML), with its delivery details.
* New AI cost panel on the Analytics dashboard: estimated spend this month and
  last, Archie turns and tokens used, and your cost guardrails at a glance. Set
  your model's per-million token rates and currency under Settings.

= 0.7.13 =
* Blurred drawing previews in the client portal can now be tapped to enlarge —
  the customer can study the (still blurred and watermarked) preview full-screen
  before paying. It stays locked and unreadable until payment clears.
* Clients can now request a change from the portal before paying, not only after.
  The "Need a change?" box now also appears while they're reviewing the preview,
  so they can ask for tweaks before committing.

= 0.7.12 =
* Existing drawings are no longer required to submit. If a customer says they
  have their own plans, Archie now says we'll need them and they can upload now
  or send them later — and the quote can be submitted either way, so people no
  longer get stuck at the finish line over a file.
* Archie always ends with a clear prompt to press "Save & submit project" once
  everything is collected — it was occasionally signing off ("That's everything
  I need!") without telling the customer to submit, leaving the quote stranded.
* The project workflow now also flags "Client's own drawings — not yet received"
  (alongside the measured-survey flag) and warns before starting drawings until
  the plans are in, whether that's the client's own file or an arranged survey.

= 0.7.11 =
* Fixed the quick-reply chips getting stuck on an earlier question — e.g. still
  offering the "3D visualisation" options while Archie had already moved on to
  asking about existing drawings. Tapping one of Archie's own options now records
  the answer directly, so the chips always keep step with the question.
* Archie no longer re-asks about an add-on (3D visualisation, submit & manage,
  site visit) the customer has already accepted or declined — the decisions it
  has made are now carried explicitly in its context.

= 0.7.10 =
* New measured-survey gate. When a client had no existing drawings (so a survey
  must be arranged separately), the project now shows a loud amber “Measured
  survey required — not yet received” flag with a “Mark survey received” button,
  and clicking “Mark drawings started” first asks you to confirm while no survey
  is in. Once marked received it turns green with the date, and can be undone.

= 0.7.9 =
* New Email log (Archie Projects → Email log): a system-wide record of every
  email the plugin sends — staged client emails, new-enquiry and revision
  alerts to the studio, quote summaries, portal sign-in links and payment
  receipts — each with its recipient, direction (to client / to studio) and
  sent-or-failed status.
* On a submitted project the Approve and "Not accepted / decline" buttons now
  sit together, with a line making clear that neither emails the client
  automatically — you prepare, edit and send the email yourself afterwards.

= 0.7.8 =
* Archie now asks for the customer's name and email as two separate questions
  (name first, then email) instead of bundling both into one, so people don't
  answer with just one and have to be asked again.

= 0.7.7 =
* Meta Pixel conversion tracking for ads. A successful project submission fires
  a "Lead" event (value = quoted total, GBP) and the confirmed Stripe payment
  fires a "Purchase" event (value = amount paid, GBP) on the portal return. Both
  are guarded so they only run once consent has loaded the pixel, and the
  Purchase event is deduped per payment so a page refresh can't double-count.

= 0.7.6 =
* Cart confirmations now always name each line that changed and state the new
  total, and adding a service back adds only the one named — mitigating a rare
  case where asking for one removed service back could also re-add another.

= 0.7.5 =
* Fixed the last cart-sync bug (critical): removing an item with the panel ✕ now
  writes a line into the conversation, so Archie sees the removal and no longer
  claims a removed service is "already in your quote" or re-adds it on the next
  question. A hard rule also ties Archie's view of the cart to the live quote, so
  if a service isn't listed it's genuinely gone and can be re-added on request.
* If the daily / per-device usage cap is hit mid-chat, the message box now
  disables (with the explanation) instead of looking live and failing on retry.
* Shortened the on-screen prompts further so they can't clip on the narrowest
  phones. (If you still see the long old placeholder, purge the site/CDN cache so
  the new script loads.)

= 0.7.4 =
* Fixed the root cause of the cart-desync (critical): the model re-sent the whole
  cart every turn and overwrote removals made with the panel's ✕ button, so the
  quote could silently rewrite itself (and read back the wrong figures). Archie now
  only ADDS or REMOVES individual services as deltas, never the whole cart, and is
  told the live quote — including ✕ removals — is the single source of truth.
* Every service line now has its own ✕, so the last remaining service can be
  removed too.
* The "Email me my quote" field now shows a privacy notice with a Privacy Policy
  link.
* If the global daily cap is spent, the widget now shows a clear "very busy" notice
  on load instead of looking live and failing on every message.
* Removed the misleading "updated on the right" wording (wrong on mobile), and
  shortened the on-screen prompts so they no longer clip on narrow phones.

= 0.7.3 =
* Fixed a silent service removal: declining an optional add-on (e.g. "no thanks,
  just the two") could drop a chosen service from the quote with no mention.
  Archie now only removes a service when explicitly asked to remove that service,
  and states any add/remove and reads the quote back.
* Hardened the daily usage cap so one visitor can't take the funnel offline: a new
  per-device daily limit on AI turns stops a single client (or script) draining
  the global token budget. Both caps are configurable in Settings, and the
  messages now explain what's happening. Cheap scripted steps don't count toward
  either cap.

= 0.7.2 =
* Second round of QA-report fixes:
  * Fixed the "Great choice!" stub at the service step — tapping a service now
    always asks the next question (handled instantly, no model round-trip).
  * All quick-reply chips (project type, add-ons, etc.) are now rendered from the
    price list, so options can't go missing, get invented ("New home"), or lag
    behind the question being asked.
  * Archie can now read a customer their own quote and running total when they
    ask — the live line items are passed into its context — while still never
    inventing, changing or discounting a price.
  * The message box stays usable after the quote is ready, so people can keep
    asking questions or add another service without pressing Start over.
  * The advice path no longer offers a planning opinion (e.g. "permitted
    development") — it recommends a service and leaves the planning position for
    the team to confirm.

= 0.7.1 =
* Project exports (Archie Projects admin):
  * "Print / Save as PDF" on each project — a clean standalone sheet with all the
    details as a cover page plus the full Archie transcript, ready to print or
    save to PDF for the project file.
  * "Export CSV" on the list — exports every project in the current tab/search
    (ref, contact, address, services, total, paid, flags, consent, dates).
* Fixed the root cause of the "Archie is just catching up" message: the rate
  limiter reset its 60-second window on every turn, so a normal multi-turn
  conversation accumulated hits and throttled itself. It now uses a true
  per-minute window.

= 0.7.0 =
* Round of fixes from the 27 Sep QA test report:
  * Multiple of our own services can now be added to one quote (e.g. planning +
    building regulations) and are all priced. Third-party work (measured survey,
    structural engineer) stays "sourced separately" and is never added as a
    priced line — Archie says so clearly.
  * Archie no longer describes or invents what the quote panel shows, and never
    states a price; it points to the customer's own quote as it builds.
  * The chat no longer auto-submits. Pressing "Save & submit project" is the
    customer's explicit go-ahead, with a privacy notice + Terms/Privacy links and
    an optional marketing opt-in; details are still captured in the back office.
  * The opening address/postcode steps are answered instantly (no model round
    trip), cutting the slowest waits at the start.
  * The advice path ("I'm not sure") now diagnoses and recommends a service
    instead of deflecting to a phone call.
  * Refund/cancellation questions link to the Terms of Service rather than
    stating a position; new Terms/Privacy URL settings.
  * Mobile: the widget no longer overflows narrow phones.
  * "London pricing" badge reworded to "Site visits available" (no phantom
    surcharge); new-dwelling referrals show "Priced on consultation" instead of
    £0 with delivery/revisions.
  * Service quick-replies are rendered from the price list so services can't go
    missing; 1,000-character input cap (client + server); the rate-limit notice
    is reworded and retries once automatically.

= 0.6.3 =
* Fixed two conversation bugs seen in testing:
  * The service menu no longer appears as tappable options while Archie is still
    asking for the address or postcode (those are free-text answers).
  * Archie no longer dead-ends on "Got it — thanks" when the model returns a
    tool-only turn: it now falls back to the next question (e.g. after the
    postcode it asks which service you need), and the prompt requires a spoken
    reply on every turn.

= 0.6.2 =
* Client portal security & revisions (from the Sep 7 Tiam call):
  * One-click email sign-in: the portal now emails a secure sign-in link to the
    address on file and keeps that browser signed in for 7 days — so only the
    emailed recipient can view the project. No passwords.
  * Payment-link emails sign the client straight in (the button carries the
    one-click link).
  * Copyright / ownership notice on the portal, and the watermark on locked
    previews now includes "© Tiam Architects LLP".
  * "Request a revision" form appears once the drawings are unlocked; it alerts
    the studio notify list.

= 0.6.1 =
* Workflow & emails (from the Sep 7 Tiam call):
  * Corrected the email sequence: reviewed → we prepare drawings & send a
    watermarked preview → then a secure link to confirm and pay. The payment
    ask no longer appears on the approval email.
  * New staged workflow in the project admin: Approve → (optional) mark drawings
    started → send the "preview ready" payment-link email → paid. Plus a
    "Not accepted / decline" path with its own email.
  * Every client email (approval, in-progress, preview/pay, decline, receipt)
    is an editable default in Archie → Settings, and can still be tweaked
    per-client before sending. Tokens: {first_name}, {ref}, {total}.
  * Payment receipt email now sends automatically when a payment clears.
  * "Also notify (extra emails)" setting — new-project and revision-request
    notifications can go to several studio addresses at once.
  * Reordered the "what happens next" steps in the client's submission email to
    match the corrected sequence.

= 0.6.0 =
* Conversation layer (from the Sep 7 Tiam call):
  * Address is captured up front and must be complete — Archie now requires a
    valid UK postcode before a project can be submitted (we can't do the work
    without it), and picks the postcode out of a full address automatically.
  * Non-UK properties are declined immediately: Archie explains we only work on
    UK properties and does not build a quote or open a project.
  * The answer box now shows a contextual placeholder that reiterates what's
    being asked (an address box, a postcode box, an email box, etc.).
  * If someone says they already have drawings/plans/a survey, uploading the
    file is now required before the project can be submitted.
  * Always-on "Email me my quote" field (appears a couple of questions in) so
    anyone can save their quote by email at any point without finishing — this
    saves the address for later and does not submit the project.
  * Default delivery estimate now reads "typically within 14 days" with a note
    that dates are subject to availability and any survey/site visit, confirmed
    on review.

= 0.5.8 =
* The "Could not send" confirmation-email error now shows the actual reason
  (e.g. wp_mail failure) plus a hint to set up an email service, instead of a
  generic message.

= 0.5.7 =
* Fixed the critical error when uploading a document/drawing in the admin. The
  secure-uploads directory filter called wp_upload_dir() from inside the
  upload_dir filter, causing infinite recursion (stack overflow). It now builds
  the path from the data already provided.
* Fixed a follow-on fatal in 0.5.6 (the upload error handler called a logging
  method that did not exist).
* Stopped a warning flood: the REST meta endpoint still read the old pricing keys
  (delivery_days etc.) renamed in 0.5.0; it now reads the current structure.

= 0.5.6 =
* Fixed the "I need advice" path showing the full service menu under unrelated
  questions (e.g. when Archie asked for your email or name). Archie now flags the
  advice/contact path so those open questions no longer get service chips.
* Admin file upload no longer white-screens on failure: a failed upload now shows
  the reason as an admin notice instead of a critical error, and is caught + logged.

= 0.5.5 =
* Removed the duplicate "Your Architect" wordmark inside the client portal (the
  page's own logo sits above it); the reference stays, right-aligned.

= 0.5.4 =
* Archie now submits the project automatically as soon as it has a valid email —
  no "Save & submit" click needed. The button remains only as a "Submitted ✓"
  confirmation. Its closing message confirms the quote has been sent, rather than
  asking the visitor to press a button.

= 0.5.3 =
* Archie now writes plain text only (no stray ** asterisks in replies).
* Fixed the price-panel caption that still said "survey included where added" â
  it now reads "survey & structural sourced separately".
* Clearer finish: once Archie has your details it asks you to press "Save &
  submit project" to send it, instead of implying it is already submitted.

= 0.5.2 =
* Client portal wrapper padding removed (was 24px/18px) so page-builder
  spacing (e.g. Elementor) fully controls it.

= 0.5.1 =
* Fix the Delete button on a project (and the "Save draft" button) showing blank
  until hover â a base button style was overriding their text colour.
* Client portal now fills the width of its page container (was capped at 1000px),
  so it can be used full-width in a page template.

= 0.5.0 =
* New pricing model: a SERVICE MENU instead of two fixed packages. Archie asks
  which service you need (pre-planning Â£450, full planning Â£690, building regs
  Â£900, listed consent Â£550, permitted development / lawful development Â£450,
  change of use Â£450, retrospective Â£450, new dwellings on request) and builds
  your total additively â no more "select to remove" items.
* Editable in the admin: a new "Archie â Pricing & Services" screen where you
  can edit every service, add-on, price, delivery/validity, phone, booking link
  and a couple of canned replies. Archie and the price panel follow it live â no
  code changes needed to update pricing.
* Add-ons Archie asks about and adds: submit & manage the application (+Â£100,
  planning only), 3D visualisation (+Â£250), site visit (London/M25, +Â£350).
* Survey question simplified to "Do you have existing plans drawn up?"; if not,
  Archie reassures we'll arrange a trusted independent surveyor. Structural
  "not sure" now gets a warm, editable reply.
* An "I'm not sure â I need advice" path, plus a phone number and optional
  15-minute-call booking link.

= 0.4.9 =
* Correct legal entity to Tiam Architects LLP (was "Ltd") across Archie, the
  emails and the site footer, and fill in the real registration details:
  ARB 091365K & 091921G, Company no. OC437815.

= 0.4.8 =
* A partial submission is now only recorded once someone actually starts the chat
  (their first message), not every time the page loads. Simply opening or
  refreshing the page no longer creates an empty "Anonymous / 0/5 / Â£0" row â the
  greeting is shown without saving anything, and the project is created on the
  first real answer. This keeps the funnel counts honest.
* Bulk delete in Archie Projects: tick the checkbox on any rows (or the header
  checkbox to select the whole list) and "Delete selected" removes them and all
  of their data in one go. The single-row trash button still works too.

= 0.4.7 =
* Submission emails are now branded to match the Archie site (navy header, the
  Your Architect wordmark, clean card layout) instead of plain text.
* The studio notification comes from "Your Architect Submission"
  &lt;noreply@yourarchitect.uk&gt; with the subject "New Project | &lt;name&gt;" (falls
  back to the postcode or reference when no name was given), and carries the full
  project: the fixed-price total, reference, submitted/started times, contact, every
  question and answer, the priced package breakdown with delivery/revision/validity
  notes, any London/listed/conservation flags, and a button to open it in the admin.
  Reply goes straight to the client when we have their address.
* When we captured the visitor's email, they now also receive a branded confirmation
  summarising what they told Archie, their fixed price, and what happens next.

= 0.4.6 =
* You can now delete submissions/projects from the admin â a trash button on each
  row and a Delete button on the detail page (both with a confirm). Deleting
  removes the record and everything attached to it (events, drafted emails, and
  any uploaded files, including the originals on disk).
* Terminology: only a submitted entry (one with a reference) is called a
  "Project" now. Everyone who started but didn't submit is a "partial submission".
  The dashboard tiles read All submissions / Partial submissions / Projects
  (submitted) / Conversion rate.

= 0.4.5 =
* Email is now properly captured. Archie asks for it as "so I can email you your
  quote and the team can get back to you" (not an optional "save & come back"),
  and the chat only completes once a valid email is given.
* Save & submit now requires a contact email: if you submit without one, Archie
  asks for it in the chat and finishes the submission automatically once you reply
  â so no project can be opened with no way to contact the client.

= 0.4.4 =
* Taller chat: the embedded builder now fills 90vh of the viewport (min 560px) so
  more of the conversation and package are visible without scrolling.

= 0.4.3 =
* Quick-reply chips are reliable again: the server now derives suggested answers
  deterministically from the next unanswered question (`suggested_options()`), so
  tappable options appear every turn even when the model doesn't return its own â
  and you can still type a free-text answer instead.
* Restored the photo/file upload in the chat: tap the camera in the composer to add
  a photo, sketch or PDF of the property. Files are stored against the project in the
  protected `uploads/yaa-secure/` area via a new nonce-checked /upload endpoint, and
  Archie confirms receipt in the conversation.
* New Archie face: the avatar is now the blue hand-drawn Archie portrait (PNG) across
  the chat header and message bubbles.

= 0.4.2 =
* Fix "Sorry â something went wrong" on the first message when the site is page-cached
  (StackCache) or behind a CDN: the REST nonce localised into the page could be stale
  or its custom header stripped, failing the nonce check. Archie now takes a fresh
  nonce from the (uncached) /start call and also sends it in the request body, so
  writes work regardless of caching. Bad-nonce responses now return a clear message.
* Theme: when this plugin is active, the archlie theme no longer registers its legacy
  archlie_project CPT + AJAX intake â removes the duplicate "Your Architect Projects"
  admin menu. The theme's own project store only runs standalone.

= 0.4.1 =
* File security hardening for the live server: all project files (drawings + docs)
  are now stored in a protected uploads/yaa-secure/ directory (deny-all .htaccess
  + web.config + index.php) instead of the public media library, and served only
  through the token + payment-checked endpoint. Removes the guessable-URL bypass.
  (Nginx: add a deny rule for that path â .htaccess is Apache/LiteSpeed only.)

= 0.4.0 =
* Studio workflow, end to end. A submitted project can now be driven all the way
  to paid + delivered inside the Archie Projects admin.
* Approve â Claude drafts a warm "good to go" confirmation email â Tiam edit the
  subject/body â send. Sending goes via Brevo's transactional API (open/click
  tracking through its webhook) when a key is set, else wp_mail with a tracking
  pixel + click redirect. Email opens/clicks show on the project.
* Client portal ([archie_portal], token-gated, auto-created on activation): the
  confirmed project + fixed price, an embedded Stripe Payment Element while
  unpaid, a receipt once paid, the client's uploads, and Tiam's files.
* Payments: server-side PaymentIntent, embedded Payment Element on the portal,
  and a signature-verified Stripe webhook that marks the project paid and unlocks
  the drawings (idempotent).
* Drawings paywall: Tiam upload drawings + third-party documents in the admin;
  until paid, drawings are served as server-generated blurred + watermarked
  previews (images) or locked placeholders, with originals streamed only through
  a token + payment-checked endpoint. Third-party docs note "paid direct to the
  provider, not Tiam".
* Analytics dashboard with date-range toggles (7 / 30 / 90 / all): revenue, paid
  count, avg value, the startedâsubmittedâapprovedâpaid funnel, revenue-over-time,
  add-on attach rates, and London / listed / conservation splits.
* New settings: Brevo API key, from name/address, Stripe webhook secret, portal
  page. New tables: yaa_emails, yaa_files (schema v2).

= 0.3.0 =
* Project side moved from a CPT + postmeta to custom tables (YAA_DB): a
  yaa_projects row per visitor with a status state-machine and denormalised
  columns, plus a yaa_events audit/funnel log. Foundations for the studio
  workflow (approve â email â payment â portal â analytics).
* New branded "Archie Projects" admin: headline funnel stats, Started /
  Submitted / RIBA / Abandoned tabs, and a per-project detail view that shows
  the collected answers as a form (with "stopped at: â¦") so you can see where
  people abandon â alongside the package, an activity timeline and the full
  conversation. Styled to match the site.
* Theme/plugin separation: the archlie theme now renders the [archie] shortcode
  when the plugin is active (and stands its own scripted demo down), so the
  theme can be rebuilt or swapped without touching Archie.
* Follow-up cron + submit notifications rewritten onto the new tables.

= 0.2.0 =
* Archie is now a helpful guide, not a form-filler. Every question is written to be
  answerable by someone with no knowledge of planning or architecture, defines its
  jargon, and offers an "I'm not sure â explain this" path that explains the term in
  plain English and re-asks.
* Tap-or-type quick replies: Archie proposes short answer buttons each turn (via the
  set_fields `replies` field) rendered under the composer, while the text box stays
  open so people can tap an option OR type their own.
* Location-aware questions: the address lookup now also flags conservation areas
  (alongside listed buildings and London/M25), and what we know about the property is
  fed into Archie each turn so he asks intelligent, reassuring follow-ups.

= 0.1.0 =
* Initial scaffold: Claude proxy (tool-use field extraction), server-side pricing
  + package builder, project CPT with cookie session, REST API, [archie] shortcode
  + Elementor widget, encrypted secrets, rate limiting, admin settings, follow-up
  cron, and Stripe/portal/Historic-England stubs.
