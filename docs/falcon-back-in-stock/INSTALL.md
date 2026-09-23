# Falcon stock system: master install runbook

**For:** Claude in Chrome (browser only, no terminal).
**Scope:** back-in-stock waitlist and preorders for Falcon Enamelware, replacing Purple Dot.
**Systems:** three Shopify stores, one Cloudflare account, one Brevo account.
**Report to:** Daniel (October). Every **STOP** below means: stop work, send Daniel the report asked for, and wait for his written go-ahead.

| Store code | Storefront | Currency | Wording |
|---|---|---|---|
| `uk` | https://www.falconenamelware.com | GBP | British, "Pre-order", `12 November 2026` |
| `us` | https://us.falconenamelware.com | USD | American, "Preorder", `November 12, 2026` |
| `eu` | https://eu.falconenamelware.com | EUR | British, "Pre-order", `12 November 2026` |

**Companion documents** (all in `docs/falcon-back-in-stock/` of the GitHub repo `octobercomms/claude`):

- `ARCHITECTURE.md`: the design. Read sections 1 to 3 before starting.
- `INSTALL-THEME.md`: theme and notification steps. Phases 5 and 6 point into it; its steps are not repeated here.
- `WORKER.md`: Worker behaviour.
- `EMAILS.md`: Brevo template names, subjects and parameters.
- `research/shopify.md`, `research/brevo-compliance.md`: background for the VERIFY items.

Source files are in `dev/falcon-back-in-stock/` of the same repo. To copy a file: open it on github.com, click the **Copy raw file** button (two overlapping squares, top right of the file view), then paste. Ask Daniel which branch to use; use `main` if he says the work is merged.

---

## Ground rules (read before every session)

1. **Secrets never leave their fields.** The Shopify Admin API tokens, the Brevo API key, the Turnstile secret key, `FLOW_KEY` and `LINK_SECRET` are typed or pasted only into a Cloudflare **Secret** field or a Shopify Flow **Secret** field. Never paste a secret into a document, a chat message, a report, the repo, a Brevo template or a Shopify note. Never take a screenshot while a secret is visible on screen. If a secret is exposed by accident, report it to Daniel and rotate it (Appendix D).
2. **Public values are fine to report:** Worker URL, Turnstile **site key** (starts `0x`), Brevo template IDs, myshopify domains, Flow names.
3. **Order of stores:** do every phase on **UK first**, then US, then EU, unless a step says "once".
4. **No customer email until Phase 9.** `DRY_RUN` stays `"true"` until Phase 9 step 9.2. While it is on, every customer email goes to the store's staff address.
5. **Do not change live-store behaviour without the phase that says so.** Theme work happens on a duplicate theme. The only live changes before Phase 9 are notification templates (Phase 6), metafield definitions (Phase 4) and Flows (Phase 7), each of which is inert until a preorder exists.
6. **Never cancel, refund or change marketing consent** for any real customer. Test orders you placed yourself are the only exception.
7. **If what you see differs from this runbook** (a menu label, a field, a missing option), do not improvise on anything touching payments, consent, DNS or secrets. Record exactly what you see and STOP. For cosmetic label differences, carry on and note the real label in your report.
8. Keep a running **install log** (a plain text note, no secrets) with: date, store, phase, step, result, and every value marked "record" below.

---

## Placeholders used in this runbook

Replace these with the real values as you find them, and record them in the install log.

| Placeholder | Example | Found in |
|---|---|---|
| `<WORKER_URL>` | `https://falcon-stock.falcon-enamelware.workers.dev` (no trailing slash) | Phase 2 |
| `<UK_MYSHOPIFY>`, `<US_MYSHOPIFY>`, `<EU_MYSHOPIFY>` | `falcon-uk.myshopify.com` | Phase 0 |
| `<TURNSTILE_SITE_KEY>` | `0x4AAAAAAA...` (public) | Phase 1 |
| `<UK_SENDER>`, `<US_SENDER>`, `<EU_SENDER>` | `hello@falconenamelware.com` | Phase 1, agreed with Daniel |
| `<UK_STAFF>`, `<US_STAFF>`, `<EU_STAFF>` | staff inbox for alerts | Phase 0, agreed with Daniel |
| `<REPLY_TO>` | monitored inbox for customer replies | Phase 0, agreed with Daniel |
| `<LOGO_URL>` | `https://cdn.shopify.com/s/files/.../falcon-logo.png` | Phase 3 |
| `<ID_BIS>`, `<ID_DELAY_UK>`, `<ID_DELAY_US_NOTICE>`, `<ID_DELAY_US_CONSENT>`, `<ID_STAFF>` | `12` | Phase 3 |
| `<A>`, `<B>`, `<C>`, `<D>` | numeric variant IDs of the test product | Phase 5 |

---

## Phase 0: pre-flight audit (read only)

Change nothing in this phase. Collect facts, export files, and report.

### 0.1 Shopify plan and Flow (per store)

1. Open the store admin. Go to **Settings** > **Plan**.
2. Record the plan name. Expected: **Grow** (called "Shopify" on older plans), **Advanced** or **Plus**. If the plan is **Basic** or **Starter**, mark it as a blocker: Flow's **Send HTTP request** action is not available on it.
3. Go to **Settings** > **Domains**. Record the `.myshopify.com` domain as `<XX_MYSHOPIFY>`.
4. On the same page, record whether the bare domain `falconenamelware.com` (UK store only) redirects to `www.falconenamelware.com`. Open `https://falconenamelware.com` in a new tab and note the final address.
5. Go to **Apps**. Record whether **Shopify Flow** is installed. If not, note it; do not install it yet.
6. If Flow is installed, open it and record the names and on/off state of every existing workflow (some may already touch inventory or tags).

### 0.2 Purple Dot (per store)

1. Go to **Apps** > **Purple Dot**. Record whether it is installed and active.
2. In the Purple Dot dashboard, list every product or variant currently on preorder: product, variant, SKU, expected ship date, units sold, cap if shown.
3. List every **open, unshipped** Purple Dot order: order number, items, quantity, promised date.
4. For each of those orders record the **payment state** in Shopify (**Orders** > the order > payment status: **Paid**, **Authorized**, **Partially paid**, **Pending**). Purple Dot may authorise now and charge later; uninstalling it before those orders are charged could break capture.
5. Export Purple Dot's waitlist (sign-ups for sold-out items) if Purple Dot offers an export. Save the CSV to the location Daniel names. Do not import it anywhere.
6. Record how Purple Dot preorder variants are set in Shopify: open two of them and note **Track quantity**, **Continue selling when out of stock**, and the current quantity (it may be negative).
7. Go to **Online Store** > **Themes** > **Customize** > **App embeds** (left sidebar icon). Record whether the Purple Dot embed is on.

### 0.3 Existing waitlist and consent (per store)

1. Go to **Customers**. Filter by tag `restock-request`.
2. Record the total count.
3. Select all matching customers and **Export** as CSV ("Current search", CSV for Excel or plain CSV). Save the file where Daniel names. Do not open it in any third-party tool.
4. From the export, record: how many of these customers have **Accepts Email Marketing** = yes, and how many have no `restock-<number>` tag (sign-ups that lost their variant to the old JavaScript bug).
5. Do **not** change any customer. Consent remediation is Falcon's decision. The options to put to Daniel are:
   - **Option A: leave as is.** Every existing sign-up keeps its current consent state. Risk: some were opted into marketing by Shopify's newsletter form without asking.
   - **Option B: downgrade only the unproven ones.** Set to "not subscribed" those who were tagged `restock-request` by the old form and have no other evidence of a marketing opt-in (for example no newsletter sign-up source, no Shopify Email engagement). Needs a careful list and a record of why.
   - **Option C: re-permission.** Leave consent as is but exclude these customers from marketing sends until they confirm through a re-permission email.
   - Whatever Falcon chooses is done by Falcon or by a separate instruction, never as part of this install.

### 0.4 Fulfilment and stock (per store)

1. Go to **Settings** > **Locations**. Record every location and whether it belongs to an app (a 3PL or fulfilment service shows the app name).
2. Go to **Apps**. Record any fulfilment, shipping, warehouse or ERP app (for example ShipStation, Shiphero, Linnworks, a 3PL connector).
3. Ask Daniel (or check the app's settings page) how stock quantities arrive in Shopify: typed by hand, CSV import, or an app/ERP sync. Record the answer and the app name.
4. Record whether that app sends orders to the warehouse automatically, and whether it respects **On hold** fulfillment orders. If you cannot tell from its settings, mark it UNKNOWN.

### 0.5 Theme lines to be removed or fixed (per store)

1. Go to **Online Store** > **Themes** > the live theme > **...** > **Edit code** > `layout/theme.liquid`.
2. Search `trackedlink` and `_dmSetDomain`. Record whether Dotdigital lines exist.
3. Search `scriptasyncsrc`. Record whether the broken Klarna tag exists (known on UK).
4. Search `klarnaservices`. Record the Klarna script URL and client id shown (the client id is public).
5. Close the editor without saving.

### 0.6 Email, DNS and accounts (once)

1. Ask Daniel who owns the Cloudflare account to use (Falcon's or October's) and whether you have access.
2. Ask Daniel whether a Brevo account already exists, and on which plan.
3. Find where DNS for `falconenamelware.com` is managed: ask Daniel, or check **Settings** > **Domains** on the UK store (Shopify-managed domains say so). Record the DNS host.
4. At that DNS host (read only), record any existing TXT record at `_dmarc.falconenamelware.com` and any existing SPF TXT record at `falconenamelware.com`. Copy the record text into the log (these are public).
5. Ask Daniel for: the sender address and name for each store, the staff alert inbox for each store, the reply-to inbox, the DMARC report (`rua`) address, and where to store `FLOW_KEY` (a password manager entry he controls).
6. Open `https://eu.falconenamelware.com/pages/withdrawal`. Record whether it exists (it will be the EU withdrawal link in date-change emails).
7. On each store, go to **Settings** > **Customer accounts**. Record whether it uses **new customer accounts** or **classic** (affects self-serve cancellation, a VERIFY item).

### 0.7 Report and STOP

Send Daniel this table, filled in, plus the saved export file locations.

| Item | UK | US | EU |
|---|---|---|---|
| Plan (must be Grow or above) | | | |
| myshopify domain | | | |
| Flow installed / existing workflows | | | |
| Purple Dot installed / app embed on | | | |
| Purple Dot active preorder products (count, list attached) | | | |
| Purple Dot open unshipped orders (count) | | | |
| ... of which not fully paid (Authorized / Pending) | | | |
| Purple Dot waitlist export saved (yes/no, where) | | | |
| Customers tagged `restock-request` | | | |
| ... with marketing consent = yes | | | |
| ... with no `restock-<id>` tag | | | |
| Customer CSV export saved (where) | | | |
| Locations (and owning apps) | | | |
| 3PL / fulfilment app, respects holds? | | | |
| How stock updates arrive (manual / CSV / app, name) | | | |
| Dotdigital lines present | | | |
| Broken Klarna tag present | | | |
| Customer accounts (new / classic) | | | |
| Apex domain redirects to www (UK) | | n/a | n/a |

Once: Cloudflare account owner, Brevo account and plan, DNS host, existing DMARC and SPF records, sender and staff addresses, reply-to, `rua` address, withdrawal page exists (yes/no).

**STOP.** Do not continue until Daniel confirms: every store is Grow or above, the consent option Falcon chose (or that the decision is deferred and install may continue), the Purple Dot plan, the addresses above, and how test orders will be kept away from the 3PL (Phase 8).

---

## Phase 1: accounts and secrets

### 1.1 Cloudflare Workers Paid (once)

1. Log in to the Cloudflare dashboard with the account Daniel named.
2. Go to **Workers & Pages** > **Plans** (or **Compute (Workers)** > **Plans**).
3. Record the current plan. If it is not **Workers Paid**, **STOP** and ask Daniel to approve the purchase ($5 per month). Do not enter payment details yourself unless Daniel tells you to.
4. After approval, select **Workers Paid** and complete the purchase as Daniel instructs.
5. Expected: the Plans page shows **Workers Paid** as active.

### 1.2 Cloudflare Turnstile widget (once)

1. In the Cloudflare dashboard go to **Turnstile** (left menu, or **Application security** > **Turnstile**).
2. Click **Add widget**.
3. **Widget name:** `Falcon restock form`.
4. **Hostnames:** add `www.falconenamelware.com`, `us.falconenamelware.com`, `eu.falconenamelware.com`. If Phase 0.1 step 4 showed the bare domain serving pages without redirecting, add `falconenamelware.com` too and tell Daniel.
5. **Widget mode:** **Managed**.
6. Leave pre-clearance off. Click **Create**.
7. Record the **Site key** as `<TURNSTILE_SITE_KEY>` (public).
8. Leave this page open. The **Secret key** is entered in Phase 2 step 2.12 by copying it straight from this page into the Cloudflare secret field. Do not copy it anywhere else.

### 1.3 Brevo account and plan (once)

1. Log in to Brevo (or create the account with the details Daniel gives).
2. Go to the account menu > **Plans** (or **My plan**). Record the plan.
3. If it is the **Free** plan, **STOP** and ask Daniel to approve a paid plan (Starter or above). The free plan caps sending at 300 emails a day across all mail, which one popular restock can exceed.

### 1.4 Brevo sender domain authentication (once)

1. In Brevo go to **Senders, Domains & Dedicated IPs** > **Domains** > **Add a domain**.
2. Enter `falconenamelware.com` (or the mail subdomain Daniel chose).
3. Brevo lists the DNS records to add. Expected: a **Brevo code** TXT record, a **DKIM** record (TXT or CNAME), and a **DMARC** TXT record. Copy each record's name and value into the install log (they are public DNS values, not secrets).
4. **STOP** and send Daniel the list of records and the existing DMARC/SPF records from Phase 0.6. DNS changes on the live domain need his go-ahead.
5. After approval, at the DNS host add the **Brevo code** TXT record exactly as shown.
6. Add the **DKIM** record exactly as shown.
7. DMARC: if **no** `_dmarc` record exists, add one TXT record at `_dmarc` with value `v=DMARC1; p=none; rua=mailto:<rua address>`. If one **already exists**, do not add a second: edit the existing record only to add or correct the `rua=mailto:<rua address>` tag, keeping its current `p=` policy. There must be exactly one DMARC record.
8. If the DNS host is Cloudflare, set every added record to **DNS only** (grey cloud), not proxied.
9. Back in Brevo, click **Authenticate this domain** (or **Verify**). DNS can take up to 48 hours.
10. Expected: Brevo shows the domain as **Authenticated** with green ticks for Brevo code, DKIM and DMARC. Record the date.

### 1.5 Brevo senders (once)

One sender per store, so a transactional unsubscribe on one store does not silence the others.

1. Go to **Senders, Domains & Dedicated IPs** > **Senders** > **Add a sender**.
2. Add the UK sender: **From name** and **From email** as Daniel agreed (`<UK_SENDER>`).
3. Add the US sender (`<US_SENDER>`).
4. Add the EU sender (`<EU_SENDER>`).
5. If Brevo refuses the same email address twice, **STOP** and ask Daniel for three distinct addresses (for example `hello@`, `us@`, `eu@`).
6. Expected: three senders, each verified (the domain is authenticated, so no confirmation email should be needed; if Brevo sends one, ask Daniel to click it).

### 1.6 Brevo settings that must stay off (once)

1. Search Brevo's settings (**Settings**, **Contacts** > **Settings**, and **Automations**) for any option that blocklists contacts from **transactional** email when they unsubscribe from **marketing** (wording varies, for example "sync unsubscribes", "apply marketing unsubscribes to transactional", or an automation that adds unsubscribed contacts to the transactional blocklist).
2. Make sure it is **off**. Do not turn it on. Legally required preorder delay notices must reach customers who opted out of marketing.
3. Record the exact label and its state in the install log.

### 1.7 Brevo API key (once)

1. Go to **SMTP & API** > **API keys** > **Generate a new API key**.
2. Name it `falcon-stock worker`.
3. Leave the dialog open with the key shown. You will paste it into Cloudflare in Phase 2 step 2.11. Do not copy it anywhere else. If the dialog must be closed first, delete the key later and generate a new one at step 2.11.
4. Go to **Security** > **Authorised IPs** (or the account's API security settings). If Brevo blocks API calls from unknown IP addresses, **deactivate** IP blocking for API keys: Cloudflare Workers call from changing IP addresses. Record the setting. (VERIFY item V14.)

### 1.8 Shopify custom app and Admin API token (per store)

The Worker needs one Admin API access token per store with exactly these scopes:

```
read_products, write_products,
read_inventory,
read_customers, write_customers,
read_orders, read_all_orders, write_orders,
read_merchant_managed_fulfillment_orders, write_merchant_managed_fulfillment_orders
```

Add `read_third_party_fulfillment_orders, write_third_party_fulfillment_orders` only if Phase 0.4 showed a 3PL or fulfilment-service app that owns a location.

`read_all_orders` is required: without it the Admin API only returns orders from the last 60 days and older preorders would be missed.

Two routes exist. Find out which one the store offers, report it, then follow it.

**Route A: Settings > Apps > Develop apps (legacy custom apps)**

1. Go to **Settings** > **Apps** (or **Apps and sales channels**) > **Develop apps**.
2. If Shopify says custom app development is not allowed, click **Allow custom app development** only if Daniel approves (store owner permission may be needed).
3. Click **Create an app**. **App name:** `Falcon stock worker`. **App developer:** your staff account.
4. Open **Configuration** > **Admin API integration** > **Configure**.
5. Tick exactly the scopes listed above. Nothing else.
6. Leave webhooks empty. Set the **Webhook API version** to the newest offered (record it).
7. Click **Save**.
8. Open **API credentials** > **Install app** > **Install**.
9. Under **Admin API access token**, the token (starts `shpat_`) can be revealed **once**. Do not reveal it yet. Go to Phase 2 step 2.10 with this page open, then click **Reveal token once**, copy it and paste it straight into the Cloudflare secret field.

**Route B: Dev Dashboard (if "Develop apps" is missing or says new apps must be made in the Dev Dashboard)**

1. From **Settings** > **Apps** > **Develop apps**, follow the link to the **Dev Dashboard** (dev.shopify.com), signed in as a store owner or collaborator.
2. **Create app** > name `Falcon stock worker` (one per store, or one app installed on all three, whichever the dashboard offers).
3. In the app version's **Access** (scopes) settings, enter the scopes above. If the dashboard asks for **protected customer data** access, request **Email** and **Name** and give the reason "Back-in-stock and preorder service emails the customer asked for".
4. **Release** the version, then **Install** it on the store.
5. Find how a permanent Admin API access token is issued. If the only route produces a token that expires (for example a client-credentials token valid for 24 hours), or needs a terminal or an OAuth redirect server, **STOP**: the Worker expects a non-expiring token and a code change would be needed.

**Report and STOP (per store, before revealing any token):** tell Daniel which route applies, the app name, the exact scope list shown, and whether `read_all_orders` appears as granted. Continue after his go-ahead.

### 1.9 Generate FLOW_KEY and LINK_SECRET (once, done during Phase 2)

These are generated in the browser and pasted straight into their fields in Phase 2 steps 2.13 and 2.14. Method, used for both:

1. Open Chrome DevTools on any tab (**More tools** > **Developer tools** > **Console**).
2. Paste and run the line below. It copies a 64-character random hex value to the clipboard **without printing it**:
   ```js
   copy([...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join(''))
   ```
3. Expected: the console prints `undefined`. The value is on the clipboard only.
4. Paste it straight into the target secret field. Never paste it anywhere else.

`FLOW_KEY` must also go into three Shopify Flow secrets (Phase 7.1) and into the password manager entry Daniel named. Do those pastes in the same sitting while the clipboard still holds it. If it is lost, generate a new one and update all five places (Appendix D).

---

## Phase 2: deploy the Worker (once)

### 2.1 Create the Worker

1. Cloudflare dashboard > **Workers & Pages** > **Create** > **Create Worker** (or **Start with Hello World!**).
2. **Name:** `falcon-stock`. Click **Deploy**.
3. Expected: a success page with a URL like `https://falcon-stock.<subdomain>.workers.dev`. Record it, without trailing slash, as `<WORKER_URL>`.
4. Open `<WORKER_URL>` in a new tab. Expected: "Hello World!".

### 2.2 Paste the code

1. On the Worker page click **Edit code**.
2. In a second tab open `dev/falcon-back-in-stock/worker/worker.js` on github.com (`octobercomms/claude`, branch as agreed). Click **Copy raw file**.
3. Back in the Cloudflare editor, click in the main file (`worker.js` or `index.js`), select all (Ctrl/Cmd+A) and paste.
4. Check: the file starts with `/**` and ` * Falcon stock Worker (`falcon-stock`)`, contains `export default {`, and ends with `};`. The editor shows about 1,847 lines.
5. Click **Deploy** (or **Save and deploy**).
6. Expected: no build error. If the editor reports a syntax error, the paste was cut short: repeat steps 2 to 5.
7. Open `<WORKER_URL>/`. Expected: plain text `falcon-stock ok`.

### 2.3 Variables and secrets

Go to the Worker > **Settings** > **Variables and Secrets** > **Add**. Add each entry below with exactly this name and type. Names are case-sensitive.

| # | Name | Type | Value |
|---|---|---|---|
| 2.3.1 | `API_VERSION` | Text | `2026-07` |
| 2.3.2 | `DRY_RUN` | Text | `true` |
| 2.3.3 | `WORKER_URL` | Text | `<WORKER_URL>` (no trailing slash) |
| 2.3.4 | `SHOPS` | JSON (or Text if JSON is not offered) | template below |
| 2.10 | `ADMIN_TOKEN_UK`, `ADMIN_TOKEN_US`, `ADMIN_TOKEN_EU` | Secret | from Phase 1.8, one per store |
| 2.11 | `BREVO_API_KEY` | Secret | from Phase 1.7 |
| 2.12 | `TURNSTILE_SECRET` | Secret | the Turnstile widget's **Secret key** |
| 2.13 | `FLOW_KEY` | Secret | generated, Phase 1.9 |
| 2.14 | `LINK_SECRET` | Secret | generated, Phase 1.9 (a different value from `FLOW_KEY`) |

Steps:

1. Add `API_VERSION` = `2026-07`.
2. Add `DRY_RUN` = `true`.
3. Add `WORKER_URL` = `<WORKER_URL>`.
4. Add `SHOPS`. Fill in the template below, replacing every `<...>`. Template IDs are `0` for now and are filled in Phase 3. `withdrawal_url` is `null` for UK and US.
   ```json
   {
     "uk": {
       "domain": "<UK_MYSHOPIFY>",
       "storefront": "https://www.falconenamelware.com",
       "sender": { "name": "Falcon Enamelware", "email": "<UK_SENDER>" },
       "reply_to": { "email": "<REPLY_TO>", "name": "Falcon Enamelware" },
       "templates": { "bis": 0, "delay_uk": 0, "delay_us_notice": 0, "delay_us_consent": 0, "staff": 0 },
       "staff_email": "<UK_STAFF>",
       "withdrawal_url": null,
       "logo_url": "<LOGO_URL>"
     },
     "us": {
       "domain": "<US_MYSHOPIFY>",
       "storefront": "https://us.falconenamelware.com",
       "sender": { "name": "Falcon Enamelware", "email": "<US_SENDER>" },
       "reply_to": { "email": "<REPLY_TO>", "name": "Falcon Enamelware" },
       "templates": { "bis": 0, "delay_uk": 0, "delay_us_notice": 0, "delay_us_consent": 0, "staff": 0 },
       "staff_email": "<US_STAFF>",
       "withdrawal_url": null,
       "logo_url": "<LOGO_URL>"
     },
     "eu": {
       "domain": "<EU_MYSHOPIFY>",
       "storefront": "https://eu.falconenamelware.com",
       "sender": { "name": "Falcon Enamelware", "email": "<EU_SENDER>" },
       "reply_to": { "email": "<REPLY_TO>", "name": "Falcon Enamelware" },
       "templates": { "bis": 0, "delay_uk": 0, "delay_us_notice": 0, "delay_us_consent": 0, "staff": 0 },
       "staff_email": "<EU_STAFF>",
       "withdrawal_url": "https://eu.falconenamelware.com/pages/withdrawal",
       "logo_url": "<LOGO_URL>"
     }
   }
   ```
   Notes: `domain` is the `.myshopify.com` domain, not the storefront. `storefront` must be exactly the origin the browser shows (scheme + host, no path, no trailing slash); it is the only origin allowed to call `/subscribe` for that store. If `<LOGO_URL>` is not known yet, remove the `logo_url` line for now (Phase 3 sets it). If the EU withdrawal page does not exist (Phase 0.6), put `null` and add it to the legal list.
5. Before saving `SHOPS`, check it is valid JSON: paste it into the DevTools console as `JSON.parse(\`...\`)` and confirm no error. (It contains no secrets.)
6. Add `ADMIN_TOKEN_UK` as **Secret**: with the UK custom app page open (Phase 1.8), reveal the token, copy, paste into the value field, **Save**. Repeat for US and EU.
7. Add `BREVO_API_KEY` as **Secret** from the open Brevo dialog.
8. Add `TURNSTILE_SECRET` as **Secret**: on the Turnstile widget page click **Copy** next to **Secret key**, paste.
9. Add `FLOW_KEY` as **Secret** using the Phase 1.9 method. While it is still on the clipboard, paste it into Daniel's password manager entry. Keep the clipboard untouched until Phase 7.1 is done for all three stores, or retrieve it later from the password manager.
10. Add `LINK_SECRET` as **Secret** using the Phase 1.9 method (run the line again for a new value).
11. Click **Deploy** (Cloudflare applies variable changes on deploy).
12. Expected: the Variables and Secrets list shows 4 plain variables and 7 secrets with the exact names above. Secrets show as "Value encrypted".

### 2.4 Cron trigger

1. Worker > **Settings** > **Triggers** > **Cron Triggers** > **Add**.
2. Enter the cron expression `0 7 * * *` (daily 07:00 UTC). **Add** / **Save**.
3. Expected: one cron trigger listed, "At 07:00 every day" (UTC).

### 2.5 Logs

1. Worker > **Settings** > **Observability**. Turn on **Workers Logs** (persistent logs). Save.
2. Expected: the **Logs** tab on the Worker shows recent requests.

### 2.6 Smoke tests

Run each fetch in the DevTools **Console**. Record the printed status and JSON.

**A. CORS preflight and `/subscribe` from the storefront origin (per store)**

1. Open `https://www.falconenamelware.com` (UK) in a tab. Open DevTools > **Console**.
2. Run:
   ```js
   fetch('<WORKER_URL>/subscribe', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({store: 'uk', variant_id: '1', email: 'smoke-test@example.com', marketing: false, turnstile_token: 'x'})}).then(r => r.json().then(j => console.log(r.status, j)))
   ```
3. Expected: `200 {ok: false, error: "bot"}`. This proves CORS works (the browser let the page read the answer) and the Turnstile secret is set (the fake token was rejected). In the **Network** tab an `OPTIONS` request to `/subscribe` returned **204**.
4. In the same console, change `store: 'uk'` to `store: 'us'` and run again.
5. Expected: a CORS error in the console (for example "blocked by CORS policy" or "Failed to fetch"). The UK origin may not subscribe to the US store. This is a pass.
6. Repeat steps 1 to 3 on `https://us.falconenamelware.com` with `store: 'us'` and on `https://eu.falconenamelware.com` with `store: 'eu'`.

If step 3 shows a CORS error instead: `SHOPS.<store>.storefront` does not match the address bar origin exactly. Fix `SHOPS` and deploy.
If step 3 shows `{ok:false, error:"server"}` or `500`: open the Worker **Logs** and report the `subscribe_error` or `unhandled_error` line.

**B. Hooks refuse calls without the key (once)**

1. Open `<WORKER_URL>/` in a tab (same origin, so the console can read responses). Open DevTools > **Console**.
2. Run:
   ```js
   for (const p of ['order', 'inventory', 'daily']) fetch('<WORKER_URL>/hooks/' + p, {method: 'POST', body: '{}'}).then(r => r.json().then(j => console.log(p, r.status, j)))
   ```
3. Expected: three lines, each `401 {ok: false, error: "unauthorised"}`.
4. Run:
   ```js
   fetch('<WORKER_URL>/hooks/order', {method: 'POST', headers: {'X-Falcon-Key': 'wrong'}, body: '{}'}).then(r => console.log(r.status))
   ```
5. Expected: `401`.
6. Open `<WORKER_URL>/hooks/order` in the address bar (a GET). Expected: `{"ok":false,"error":"method_not_allowed"}`.
7. Open `<WORKER_URL>/u?t=bad`. Expected: a Falcon page headed "This link has expired".

Record every result. If any differs, **STOP** and report.

---

## Phase 3: Brevo templates (once)

Five templates, shared by all three stores. Names, subjects and preview text come from `EMAILS.md`; read its **Setup notes** first.

### 3.1 Logo

1. In the UK Shopify admin go to **Content** > **Files**. Find the Falcon logo (PNG, about 360 px wide or larger). If it is not there, ask Daniel for the file and upload it.
2. Copy its URL (starts `https://cdn.shopify.com/`). Record it as `<LOGO_URL>`.
3. Open `<LOGO_URL>` in a new tab. Expected: the logo shows.

### 3.2 Create each template

Repeat for each row. Source files are in `dev/falcon-back-in-stock/emails/`.

| File | Template name | Subject (paste exactly) | `SHOPS.templates` key |
|---|---|---|---|
| `bis.html` | `Falcon – Back in stock` | `Back in stock: {{ params.product_title }}` | `bis` |
| `delay-uk.html` | `Falcon – Pre-order date change (UK/EU)` | `{% if params.earlier %}Good news: your pre-order {{ params.order_name }} is coming sooner{% else %}Your pre-order {{ params.order_name }} has a new date{% endif %}` | `delay_uk` |
| `delay-us-notice.html` | `Falcon – Preorder delay notice (US)` | `{% if params.earlier %}Good news: your preorder {{ params.order_name }} will ship sooner{% else %}Your preorder {{ params.order_name }}: new ship date {{ params.new_date }}{% endif %}` | `delay_us_notice` |
| `delay-us-consent.html` | `Falcon – Preorder delay, action needed (US)` | `Action needed by {{ params.keep_by_date }}: your preorder {{ params.order_name }}` | `delay_us_consent` |
| `staff.html` | `Falcon – Staff alert` | `{{ params.subject }}` | `staff` |

1. Brevo > **Transactional** (or **Campaigns** > **Templates** under Transactional) > **Templates** > **New template**.
2. **Template name:** from the table.
3. **Subject line:** from the table.
4. **Preview text:** leave empty (each file carries its own hidden preheader).
5. **From:** the UK sender (the Worker overrides the sender per store on every send).
6. **Reply-to:** `<REPLY_TO>`.
7. Choose **Paste your code** (or **Code your own**).
8. On github.com open the file, **Copy raw file**, paste into the code box.
9. **Save** and exit the editor.
10. **Activate** the template (toggle or **Activate** button on the template list). Inactive templates cannot be sent by the API.
11. Record the numeric **Template ID** shown on the templates list (column **ID**, or in the template URL).

### 3.3 Subject check

1. Open the `Falcon – Pre-order date change (UK/EU)` template settings and confirm Brevo accepted the `{% if %}` subject without an error.
2. If Brevo rejects it or shows the raw `{% if %}` text in a preview, change the subject to `Your pre-order {{ params.order_name }} has a new date` and record V11 as failed. Do the same for the US notice with `Your preorder {{ params.order_name }}: new ship date {{ params.new_date }}`.

### 3.4 Test sends

1. Open each template > **Preview** or **Send a test**.
2. If the editor offers a box for sample parameters (JSON), paste the sample JSON for that template from `EMAILS.md` (the blocks under each template heading; the `delay-uk` sample is EU; for UK also try `"withdrawal_url": ""`). Send the test to your own test inbox or `<UK_STAFF>`.
3. If no parameter box is offered, send the test anyway and note that parameters render blank. Full parameter rendering is checked in Phase 8 through the Worker.
4. For each test email check: it arrives (not spam), the logo shows, no `{{` or `{%` text is visible, no `REPLACE_ME` text shows except in the logo URL fallback when `logo_url` is empty, and links point where expected.
5. Record pass/fail per template.

### 3.5 Put the template IDs into SHOPS

1. Cloudflare > `falcon-stock` > **Settings** > **Variables and Secrets** > `SHOPS` > **Edit**.
2. In all three stores, replace the five `0` values with the IDs from 3.2 step 11 (the same five IDs in each store).
3. Add or correct `logo_url` in all three stores with `<LOGO_URL>`.
4. Validate the JSON (Phase 2.3 step 5). **Save** and **Deploy**.

---

## Phase 4: variant metafield definitions (per store)

1. Go to **Settings** > **Custom data** > **Variants** > **Add definition**.
2. Create the six definitions below, one at a time. For each: enter **Name**, click **Namespace and key** and enter it exactly, select the **Type**, choose **One value**, add the **Description**, **Save**.

| Name | Namespace and key | Type | Description | Pin |
|---|---|---|---|---|
| Falcon: expected dispatch date | `falcon.expected_date` | **Date** | Date the pre-order is expected to ship. Must be a real supplier date. | Yes |
| Falcon: pre-order limit | `falcon.preorder_limit` | **Integer** | Maximum units to sell below zero. Blank or 0 turns pre-order off. | Yes |
| Falcon: pre-order note | `falcon.preorder_note` | **Single line text** | Optional extra line shown under the date, for example "From the January container". | Yes |
| Falcon: delay reason | `falcon.delay_reason` | **Single line text** | One sentence, customer-facing, used in the date-change email. Fill in before moving a date later. | Yes |
| SYSTEM Falcon: notified date | `falcon.notified_date` | **Date** | System managed by the Falcon Worker. Do not edit. | No |
| SYSTEM Falcon: delay count | `falcon.delay_count` | **Integer** | System managed by the Falcon Worker. Do not edit. | No |

3. Leave **Storefronts** access at its default (the theme reads metafields through Liquid, which does not need it).
4. Expected: six variant definitions under the `falcon` namespace. Keys and types must match exactly; a typo silently disables preorders.
5. Open any variant. Expected: the four pinned fields show under **Metafields**.

`notified_date` and `delay_count` are written only by the Worker. Staff must never edit or clear them: doing so either resends date-change emails or suppresses them.

---

## Phase 5: theme install on a duplicate theme (per store)

Follow `INSTALL-THEME.md` sections 0 to 6 and 8, then run its section 9 tests **9.1 to 9.16 and 9.21 to 9.23** only. Tests 9.17 to 9.20 (orders and shipping emails) are run in Phase 6.

Additions to `INSTALL-THEME.md` for this runbook:

1. In `falcon-config`, use `<WORKER_URL>` and `<TURNSTILE_SITE_KEY>`.
2. **Test product.** Create it per `INSTALL-THEME.md` section 8, named `Falcon system test (do not buy)`. Make it reachable by URL but not listed: status **Unlisted** if the store offers it, otherwise **Active** but in no collection, with every sales channel except **Online Store** turned off (keep it out of Google, Meta and any feed). Record the variant IDs as `<A>`, `<B>`, `<C>`, `<D>` (in the variant URL or `?variant=` on the storefront).
3. **Preview on the storefront domain.** The address bar must show the store's own domain (`www.`, `us.` or `eu.falconenamelware.com`) with `?preview_theme_id=...`. A `shopifypreview.com` or `.myshopify.com` preview will fail the notify form (CORS and Turnstile hostname). If Shopify's **Preview** opens another domain, copy the `preview_theme_id` value and open `https://<store domain>/products/<test handle>?preview_theme_id=<id>` instead.
4. Tests 9.14 and 9.15 call the real Worker. After each, check the Worker **Logs** for a `subscribed` event with the right `store` and `variant_id`.
5. Do **not** publish the theme at the end of `INSTALL-THEME.md`. Publishing is Phase 9.

**STOP (per store):** report the test table (9.1 to 9.16, 9.21 to 9.23), the result of 9.9 (does `app.js` send line item properties), 9.12 (quick cart), any other template found in section 4, and whether US/EU had the Klarna typo.

---

## Phase 6: notification blocks (per store)

1. Follow `INSTALL-THEME.md` section 7 (Order confirmation and Shipping confirmation). Save the original template text in a note first, as it says.
2. Before placing test orders, agree with Daniel how test orders are kept away from the 3PL (Phase 0 STOP). Options: pause the 3PL's order import, tag test orders `falcon-test` and have the 3PL skip that tag, or cancel line A before the 3PL picks it up.
3. Ask Daniel how to pay for test orders: a 100% discount code limited to the test product plus a free-shipping code, or a real card refunded afterwards. Do not switch the store to the **Bogus gateway** or test mode without his explicit approval: it affects every live checkout.
4. Run `INSTALL-THEME.md` tests **9.17 to 9.20**. Flows are not built yet, so no holds are placed; you can fulfil A and B by hand.
5. Cancel and refund the Phase 6 test orders (they are yours), per `INSTALL-THEME.md` section 9 clean-up.
6. Record pass/fail for 9.17 to 9.20.

Notification templates go live on save. The blocks only show for lines carrying `_preorder_date`, which only the new (unpublished) theme adds, so live customers see no change yet.

---

## Phase 7: Shopify Flows (per store)

Three workflows per store. Replace `uk` with `us` or `eu` in every body on those stores.

### 7.1 Flow secret

1. Go to **Apps** > **Shopify Flow**.
2. Open Flow **Settings** (gear or **Settings** link) > **Secrets** > **Create secret** (label may differ; record it).
3. **Handle:** `falcon_worker_key`.
4. **Value:** `FLOW_KEY` (from the clipboard or the password manager). Do not show it on screen longer than needed.
5. **Save**. Expected: the secret is listed as `falcon_worker_key` with the value hidden.

### 7.2 Flow 1: `Falcon – preorder order`

1. **Create workflow**. Rename it `Falcon – preorder order`.
2. **Select a trigger:** **Order created**.
3. Add **Condition**. Build: **Order** > **Line items** > **Custom attributes** > **Key** **is equal to** `_preorder_date`. Where Flow asks how to treat the list, choose **At least one of**.
4. On the **Then** (true) branch add action **Send HTTP request**:
   - **HTTP method:** `POST`
   - **URL:** `<WORKER_URL>/hooks/order`
   - **Headers:** `Content-Type` = `application/json`; `X-Falcon-Key` = `{{secrets.falcon_worker_key}}`
   - **Body:**
     ```
     {"store":"uk","order_id":"{{order.id}}"}
     ```
5. `{{order.id}}` gives a GID like `gid://shopify/Order/1234567890`. The Worker takes the trailing digits, so the GID is fine; `{{order.legacyResourceId}}` also works.
6. Leave the **Otherwise** branch empty.
7. **Turn on workflow**.
8. Expected: Flow shows the workflow **On** with no validation errors. If Flow cannot build the condition in step 3, remove the condition (the Worker ignores orders with no `_preorder_date`) and record it.

### 7.3 Flow 2: `Falcon – inventory changed`

1. **Create workflow**. Rename it `Falcon – inventory changed`.
2. **Select a trigger:** **Product variant inventory quantity changed** (older name: "Inventory quantity changed").
3. Add **Condition**: **Product variant** > **Inventory quantity** **is greater than** the trigger's **Inventory quantity prior** (`inventoryQuantityPrior`).
4. If the condition builder only accepts a fixed number and not another field (VERIFY V8), do not add a condition. The Worker re-reads the live quantity and does nothing harmful on decreases. Record which you did.
5. Add action **Send HTTP request** (on the **Then** branch, or directly after the trigger if there is no condition):
   - **HTTP method:** `POST`
   - **URL:** `<WORKER_URL>/hooks/inventory`
   - **Headers:** `Content-Type` = `application/json`; `X-Falcon-Key` = `{{secrets.falcon_worker_key}}`
   - **Body:**
     ```
     {"store":"uk","variant_id":"{{productVariant.id}}","inventory_quantity":"{{productVariant.inventoryQuantity}}","inventory_quantity_prior":"{{inventoryQuantityPrior}}"}
     ```
6. The Worker needs only `store` and `variant_id` (GID or number). The two quantities are logged only, and are quoted so an empty value cannot break the JSON.
7. **Turn on workflow**.

### 7.4 Flow 3: `Falcon – run daily check now`

Lets staff (and you, in Phase 8) run the daily job on one store without handling the key. Flow's **Run Flow automation** button on a product only works with the **Product created** trigger.

1. Create a product named `Falcon system check (do not publish)`, status **Draft**, no sales channels, tag `falcon-run-check`. Record its admin URL.
2. **Create workflow**. Rename it `Falcon – run daily check now`.
3. **Select a trigger:** **Product created**.
4. Add **Condition**: **Product** > **Tags** **includes** (or at least one of, equal to) `falcon-run-check`. This stops it running when real products are created.
5. On **Then**, add **Send HTTP request**:
   - **HTTP method:** `POST`
   - **URL:** `<WORKER_URL>/hooks/daily`
   - **Headers:** `Content-Type` = `application/json`; `X-Falcon-Key` = `{{secrets.falcon_worker_key}}`
   - **Body:** `{"store":"uk"}`
6. **Turn on workflow**.
7. Test: open the `Falcon system check` product > **More actions** > **Run Flow automation** > choose `Falcon – run daily check now` > **Run**.
8. Expected: in Flow > the workflow > **Run history**, the run shows the HTTP request with status **200**. The Worker **Logs** show `daily_done` for `store: "uk"`. `DRY_RUN` is on, so any digest goes to `<UK_STAFF>`.
9. If the run shows a timeout (Flow waits 30 seconds), check the Worker logs for `daily_done` for that store. If it is there, record V9 as "slow but completes". If it is missing, **STOP** and report.

### 7.5 Check

1. Expected per store: three workflows **On**, each using `{{secrets.falcon_worker_key}}` (never the raw key), each with the right store code in the body.
2. Take a screenshot of each workflow's canvas (the key is not visible there) for the report.

**STOP (per store):** report the three workflows, which condition variant you used in 7.2 and 7.3, the Flow secret label, and the 7.4 test result.

---

## Phase 8: end-to-end tests with DRY_RUN on (per store)

`DRY_RUN` is `"true"`. What it does (from `WORKER.md`):

- Every customer email goes to the store's `staff_email` instead. **The email content looks exactly like the customer version** (the templates do not print the `dry_run_banner` parameter). To see who it would have gone to, open the Worker **Logs** and find the `email_sent` event: `to` is the masked real recipient, `dry_run: true`.
- It does **not** add the "customer was told" tags and metafields: no `restock-{id}` to `restock-notified-{id}` swap, no `preorder-notice-...`, `preorder-delay-{n}` or `preorder-keep-by-...` tags, no `notified_date` or `delay_count` update after a change. So a repeated run emails staff again.
- It caps each batch at 5 emails.
- Holds, releases, the cap, cancel/keep tags and staff alerts run for real.
- Brevo drops a repeat of the same email within 30 minutes (same idempotency key). If a repeated test produces no email, look for `email_duplicate_suppressed` in the Worker logs: that is a pass. The daily digest has one key per store per day, so wait 30 minutes between two digest checks.

**Setup (per store):**

1. Use the test product from Phase 5 with variants set as `INSTALL-THEME.md` section 8: A in stock (5), B preorder (qty 0, continue selling, `expected_date` 6+ weeks ahead, `preorder_limit` 3, note set), C sold out, D misconfigured.
2. Run `Falcon – run daily check now` (7.4) once. Expected: B now has `falcon.notified_date` equal to its `expected_date` (open B > **Metafields**, or **Show all**). This records the date customers are shown.
3. Test customers: create a Gmail-style plus address you control, for example `<yourinbox>+falcon-new-uk@...` (new) and a second one you register first as a customer by hand, `<yourinbox>+falcon-existing-uk@...` (existing).
4. Use the storefront domain preview of the duplicate theme for every storefront step.
5. Keep the Worker **Logs** tab open (filter by `store`).

**Tests.** Record pass/fail and notes in the table at the end of this phase.

| # | Test | Steps | Expected |
|---|---|---|---|
| 8.1 | Notify, new customer, marketing unticked | On C, submit the notify form with the new test address, box unticked | Inline thank-you. Customer created, tags `restock-request`, `restock-<C>`. **Email marketing: Not subscribed**. Log `subscribed` with `marketing: false` |
| 8.2 | Notify, existing customer, marketing ticked | On D, submit with the existing test address, box ticked | Tags `restock-request`, `restock-<D>` added; any earlier tags kept. **Email marketing: Subscribed**. Log `subscribed` with `marketing: true` |
| 8.3 | Notify, existing customer, second variant, unticked | On C, submit with the existing address, box unticked | `restock-<C>` added, `restock-<D>` kept. Consent unchanged (stays Subscribed: the Worker never downgrades) |
| 8.4 | Notify, bad email and bot | Submit `abc@` | Inline error, no request in Network. (Bot rejection was proven in 2.6) |
| 8.5 | Back-in-stock fan-out | Set C **Available** to 5 (**Products** > test product > C > quantity) | Flow `Falcon – inventory changed` run shows HTTP 200. Log `inventory_hook`, then `email_sent` template `bis` (up to 2 lines, masked test addresses), `dry_run_keep_waitlist_tags`, `fanout_done`. `<XX_STAFF>` receives "Back in stock: Falcon system test..." with product, variant, price in store currency, image, correct storefront link, "Remove me" link. Customer tags **unchanged** (DRY_RUN) |
| 8.6 | Remove-me link | In the 8.5 email, open the remove link | GET shows "Stop back-in-stock emails?" with a **Remove me** button and changes nothing (tags unchanged). Click **Remove me**: page "You have been removed"; that customer's `restock-<id>` tags are all gone, `restock-request` stays |
| 8.7 | Reset C | Set C back to 0. Re-subscribe the new test address on C (for Phase 9) | Tag `restock-<C>` back |
| 8.8 | Preorder purchase, preorder only | On B, click **Pre-order**, qty 1, check out (payment as agreed in Phase 6) | Order created. Flow `Falcon – preorder order` run 200. Order tags `preorder`, `preorder-v<B>`. Order page: B's line **On hold** with reason note "Pre-order, expected {date}". Line shows property "Pre-order: Ships from {date}" (US "Preorder: ..."). B's quantity now -1 |
| 8.9 | Mixed basket | Add A (qty 1) and B (qty 1), check out | Tags `preorder`, `preorder-v<B>`. **Only B is on hold**; A sits in its own **Unfulfilled** fulfillment order ready to ship. B quantity -2. Order confirmation email has the pre-order box and "Anything else ... ships now" |
| 8.10 | Cap reached, policy set to Deny | Order B again, qty 1 (B reaches -3 = limit) | Order held as 8.8. Log `mutation_ok` action `productVariantsBulkUpdate`. B's **Continue selling when out of stock** is now **off**. Storefront B now shows the notify form, not Pre-order |
| 8.11 | Over cap (optional) | Only if Daniel wants it: re-enable continue selling on B and order 1 more | Order tagged `preorder-over-cap`, staff alert "Pre-order order ... needs attention" with row "Over cap". Afterwards set continue selling off again |
| 8.12 | Partial release, oldest first | B is at -3 with three held orders (8.8 oldest, 8.9, 8.10; if you ran 8.11, cancel that order first so B is back at -3). Set B **Available** to -1 (2 units arrived) | Flow inventory run 200. Log `release_plan` with `held_units: 3`, `stock_for_preorders: 2`, releasing the 8.8 and 8.9 orders. Those two orders: hold released, tag `preorder-released-v<B>`, B line now fulfillable. 8.10 order still **On hold** |
| 8.13 | Date change, later, no reason | On B set `expected_date` 10 days later than `notified_date`. Leave `delay_reason` empty. Run 7.4 | No customer email (unless the old date is within 2 days). Staff digest row "Date moved later but no delay_reason" |
| 8.14 | Date change, later, with reason | Set `delay_reason` to "The shipment from our factory left two weeks late." Run 7.4 (wait 30 minutes after 8.13 if you need to see a new digest) | One email to `<XX_STAFF>` for the 8.10 order only (released orders are skipped). UK/EU: template `Falcon – Pre-order date change (UK/EU)`, subject "Your pre-order #... has a new date", old and new dates in `12 November 2026` form, the reason, a **cancel** link; EU also shows the **withdrawal** block linking to `withdrawal_url`, UK does not. US: `Falcon – Preorder delay notice (US)`, dates `November 12, 2026`, the "silence means you agree" sentence, 7 business days. Log `email_sent` with the right `template`. B's `notified_date` and `delay_reason` **unchanged** (DRY_RUN) |
| 8.15 | US only: long delay needs consent | Set B `expected_date` 45 days after `notified_date`. Run 7.4 | Template `Falcon – Preorder delay, action needed (US)`, subject "Action needed by {date}: ...", keep-by date = the old date, or 7 days from today if the old date is sooner, **Keep my order** and **cancel** links |
| 8.16 | Date moved earlier | Set B `expected_date` 5 days **before** `notified_date` (still in the future). Run 7.4 | UK/EU: "Good news: your pre-order ... is coming sooner", no apology. US: notice template with the "ship sooner" wording |
| 8.17 | US only: keep link | DRY_RUN adds no delay tags, so first add by hand to the 8.10 order the tags a live run would add: `preorder-delay-1` and `preorder-keep-by-<old date as YYYY-MM-DD>`. Open the **Keep my order** link from the 8.15 email | GET shows "Keep your preorder?" with a **Keep my order** button and changes nothing. Click it: "Thank you, your order is kept"; order tag `preorder-kept-1` added. Opening the link again shows "Your order is kept" |
| 8.18 | US only: consent deadline passed | On the 8.10 order remove `preorder-kept-1` and change the keep-by tag to yesterday: `preorder-keep-by-<yesterday>`. Run 7.4 | Order tagged `preorder-cancel-due`. Staff alert "Cancel and refund #... by {date}" with a date 7 business days ahead. Opening the old keep link now shows "This link can no longer be used". The Worker did **not** cancel or refund |
| 8.19 | Cancel link | Open the **cancel** link from the 8.14 email | GET shows "Cancel this pre-order?" (US "preorder") and a button; order unchanged. Click it: page "We have your cancellation request"; order tags `preorder-cancel-requested` and `preorder-cancel-requested-on-<today>`; staff alert "Cancel request: #..., refund by {date}" (UK/EU today + 14 days, US + 7 business days). Order **not** cancelled |
| 8.20 | Config alert digest | Make sure D is still continue selling with no metafields. On the 8.19 order add tag `preorder-cancel-requested-on-<date 5 days ago>`. Wait 30 minutes after the last digest, run 7.4 | One staff email "Falcon XX \| Daily check: N items need attention" with rows "Continue selling without pre-order setup" (D), "Cancel request still open after 3 days" (the 8.19 order) and any real-catalogue problems |
| 8.21 | Logs clean | Worker **Logs** for this store's tests | No `unhandled_error`, `shopify_graphql_error`, `hook_error`, `email_failed` or `turnstile_wrong_action`. Any of these: copy the log line (it has no secrets) into the report |
| 8.22 | Brevo logs | Brevo > **Transactional** > **Logs** (or **Statistics** > **Logs**) | Every email above shows **Delivered** to `<XX_STAFF>`, sender = this store's sender |

**Clean up (per store):**

1. Cancel and refund every Phase 8 test order (your own orders only).
2. Release any remaining hold on them first if Shopify requires it.
3. Remove test tags from the test customers; keep the customers for Phase 9.
4. Reset the test product: A 5, B 0 with continue selling on, `expected_date` back to the original, `delay_reason` empty, C 0, D as before.
5. Do not edit B's `notified_date` or `delay_count`. If they no longer match `expected_date`, record it and tell Daniel; he will decide whether to delete the test product and make a fresh one.

**Pass/fail table (fill in per store):**

| # | UK | US | EU | Notes |
|---|---|---|---|---|
| 8.1 notify new, unticked | | | | |
| 8.2 notify existing, ticked | | | | |
| 8.3 existing, second variant | | | | |
| 8.4 bad email | | | | |
| 8.5 back-in-stock fan-out | | | | |
| 8.6 remove-me link | | | | |
| 8.8 preorder only, hold | | | | |
| 8.9 mixed basket, only preorder held | | | | |
| 8.10 cap reached, Deny | | | | |
| 8.11 over cap (optional) | | | | |
| 8.12 partial release oldest first | | | | |
| 8.13 later date, no reason | | | | |
| 8.14 later date with reason, right template | | | | |
| 8.15 long delay consent | n/a | | n/a | |
| 8.16 earlier date | | | | |
| 8.17 keep link | n/a | | n/a | |
| 8.18 consent deadline | n/a | | n/a | |
| 8.19 cancel link | | | | |
| 8.20 config digest | | | | |
| 8.21 Worker logs clean | | | | |
| 8.22 Brevo delivered | | | | |

**STOP (per store):** send Daniel the table, screenshots of one email per template, and every failing log line.

---

## Phase 9: go live

Do one store at a time, UK first. Only start when Daniel has approved that store's Phase 8 results.

### 9.1 Publish the theme (per store)

1. **Online Store** > **Themes** > `Falcon stock test {date}` > **Publish**.
2. Keep the previous theme unpublished (do not delete it) for at least two weeks.
3. Open the live storefront product page of the test product with `?variant=<B>`, `<C>`. Expected: same states as Phase 5.

### 9.2 Turn DRY_RUN off (once, after the first store's theme is live)

`DRY_RUN` is global. Turning it off makes the Worker email real customers on every store, including stores whose theme is not published yet (waitlist fan-out and date changes read Shopify data, not the theme). **STOP** and get Daniel's go-ahead, naming the time.

1. Cloudflare > `falcon-stock` > **Settings** > **Variables and Secrets** > `DRY_RUN` > **Edit** > `false` > **Save** > **Deploy**.
2. Expected: `DRY_RUN` shows `false`.

### 9.3 First real back-in-stock send on the test product (per store)

1. Confirm only your test addresses carry `restock-<C>` (**Customers** > filter tag `restock-<C>`).
2. Set C **Available** to 1.
3. Expected: your test inbox (not staff) receives "Back in stock: ...". The customer's tags change: `restock-<C>` removed, `restock-notified-<C>` added. Log `email_sent` with `dry_run: false`.
4. Set C back to 0.

### 9.4 First real waitlist (per store)

1. From the Phase 0 export, pick with Daniel one real variant with a small waitlist (under 20 customers) that is about to be restocked.
2. When stock is added (by Falcon's normal route), watch Flow run history, the Worker logs (`fanout_done` with `sent` = waitlist size) and Brevo logs (delivered, bounces, spam complaints).
3. Expected: every waiting customer emailed once, tags swapped.
4. Report counts to Daniel. Large waitlists may take several runs: each invocation sends at most 400, the rest go at the next inventory change or the 07:00 UTC daily run.

### 9.5 Monitoring (tell Daniel and staff where to look)

| What | Where | Look for |
|---|---|---|
| Worker activity | Cloudflare > Workers & Pages > `falcon-stock` > **Logs** | `event` values: `email_failed`, `mutation_user_errors`, `mutation_failed`, `hook_error`, `unhandled_error`, `daily_store_error`, `hook_unauthorised`, `turnstile_failed` (spam bursts) |
| Daily run | Same, around 07:00 UTC | `daily_done` for each store |
| Email delivery | Brevo > **Transactional** > **Logs** / **Statistics** | Bounces, blocked, spam complaints, "unrecognised IP" errors |
| Flow runs | Shopify > **Apps** > **Flow** > each workflow > **Run history** | Failed HTTP requests (non-200) |
| Staff alerts | Each store's `staff_email` inbox | Subjects starting `Falcon UK |`, `Falcon US |`, `Falcon EU |` |

### 9.6 Staff operating guide (give this section to Falcon staff)

**Put a variant on pre-order**

1. Confirm a real supplier date and keep the evidence (purchase order or supplier email). US law requires a reasonable basis for any date shown.
2. Open the product > the variant.
3. **Inventory:** **Track quantity** on.
4. Set `Falcon: expected dispatch date`.
5. Set `Falcon: pre-order limit` (units you are willing to sell before stock arrives).
6. Optional: `Falcon: pre-order note`.
7. Last: tick **Continue selling when out of stock**. Never tick it without the date and the limit.
8. **Save**.
9. Run the check: open `Falcon system check (do not publish)` > **More actions** > **Run Flow automation** > `Falcon – run daily check now`. This records the date customers are being shown. (If you skip this, it happens at 07:00 UTC the next day. Do not change the date before then.)
10. When the limit is reached, the system turns **Continue selling** off by itself. To sell more, raise the limit, then tick **Continue selling** again.

**Change the expected date**

1. First fill in `Falcon: delay reason`: one plain, customer-facing sentence, no dashes as punctuation (for example "The shipment from our factory left two weeks late.").
2. Then change `Falcon: expected dispatch date`. **Save**.
3. Customers are emailed at the next 07:00 UTC check, or straight away if you run `Falcon – run daily check now`.
4. A later date without a reason is held back and flagged in the daily email until 2 days before the old date, then sent without a reason.
5. An earlier date sends a "good news" email; no reason needed.
6. Never edit `SYSTEM Falcon: notified date` or `SYSTEM Falcon: delay count`.

**Stock arrives**

1. Receive stock the normal way. Held pre-order lines are released automatically, oldest order first, as far as the stock covers whole orders. Released orders get tag `preorder-released-v<variant id>`.
2. If a release fails, a staff alert says which order; release the hold by hand (order > fulfillment order > **Release hold**).
3. When the pre-order run is over: untick **Continue selling**, clear the expected date and the limit.

**Cancellation requests**

| Tag / alert | Meaning | Do this | Deadline |
|---|---|---|---|
| `preorder-cancel-requested` (+ alert "Cancel request: ...") | Customer clicked cancel in a date-change email | Cancel the pre-order item(s) and refund in full. UK/EU: include delivery. Then remove the `preorder-cancel-requested` tag (keep the `...-on-<date>` tag as a record) | UK/EU: 14 days from the request. US: 7 business days |
| `preorder-cancel-due` (US only, alert "Cancel and refund ...") | US customer did not confirm "Keep my order" by the deadline | Cancel and refund in full. The customer does not need to ask | 7 business days (date in the alert) |
| Reply to a delay email asking to cancel | Same as a click | Add tags `preorder-cancel-requested` and `preorder-cancel-requested-on-<YYYY-MM-DD>` and process as above | As above |
| US reply saying "keep it" | Express consent | Add tag `preorder-kept-<n>` where n is the highest `preorder-delay-<n>` on the order | Before the keep-by date |
| `preorder-over-cap` | An order took the variant past its limit | Decide whether it can be fulfilled; if not, contact the customer | As soon as possible |

The system never cancels, refunds or changes marketing consent. Staff do.

**Where alerts arrive:** the store's staff inbox (`<UK_STAFF>`, `<US_STAFF>`, `<EU_STAFF>`), subject starting `Falcon UK |`, `Falcon US |` or `Falcon EU |`. The daily check email arrives after 07:00 UTC only when something needs attention.

**STOP (per store):** report 9.1 to 9.4 results to Daniel.

---

## Phase 10: Purple Dot migration and switch-off (per store)

Start only after Phase 9 is complete on the store and Daniel has approved the plan based on the Phase 0 report.

1. Freeze: agree with Daniel a switch date for each Purple Dot preorder product.
2. On the switch date, for one product: in the Purple Dot dashboard, turn off preorders for that product (label varies; record it).
3. On the Shopify variant, set the Falcon fields as in 9.6 "Put a variant on pre-order": `expected_date` = the current real date, `preorder_limit` = remaining units Falcon is willing to sell (Daniel supplies it; subtract units already sold through Purple Dot if stock is shared).
4. Check **Continue selling** and the quantity. If Purple Dot left the quantity at an odd value (for example a reserved or negative amount), **STOP** and report before saving.
5. Run `Falcon – run daily check now`.
6. On the live storefront, check the variant shows **Pre-order** with the right date and the Purple Dot widget is gone for it.
7. Place no test order on real products. Watch the first real Falcon pre-order: it must be tagged `preorder` and held (9.5 monitoring).
8. Repeat steps 2 to 7 for each Purple Dot product.
9. Existing Purple Dot orders stay with Purple Dot. They carry no `_preorder_date`, so the Worker does not hold, release or email them. Purple Dot keeps handling them until they ship.
10. Each week, re-check the list of open Purple Dot orders and their payment state. Report the count to Daniel.
11. When every Purple Dot order has shipped and every payment is captured (none **Authorized** or **Pending**), **STOP** and ask Daniel for approval to switch Purple Dot off.
12. Export Purple Dot's order and waitlist data again and save it where Daniel names.
13. **Online Store** > **Themes** > **Customize** > **App embeds**: turn the Purple Dot embed **off**. **Save**.
14. Check three product pages and the cart: no Purple Dot widget, no console errors.
15. Wait 48 hours with no issues.
16. **Settings** > **Apps** > **Purple Dot** > **Uninstall**, with Daniel's go-ahead.
17. **Edit code** on the live theme: search `purple` and `purpledot`. Report any leftover references; do not delete them without instruction.
18. The Purple Dot waitlist export is handled as Falcon decides (Phase 0 options). Do not import it into Shopify tags unless Daniel instructs it and confirms the consent basis.

---

## Appendix A: open VERIFY items

Each item: how to check it from the browser, and what to do if it fails. Most are confirmed by the Phase 8 tests; a failure usually shows as a Worker log line `shopify_graphql_error` naming the field, or a `mutation_user_errors` line. For Admin API items you can also read the reference page at `https://shopify.dev/docs/api/admin-graphql/2026-07/...` in the browser.

| # | Item | How to check | If it fails |
|---|---|---|---|
| V1 | Customer tag search `tag:'restock-123'` may also match `restock-1234` | Phase 8: the Worker re-checks exact tags, so check the result, not the search. Create a customer with tag `restock-<C>1` (an extra digit) and run 8.5: that customer must not be emailed | STOP and report; code fix |
| V2 | Order tag search with hyphens (`tag:'preorder-v<id>' AND status:open`) | 8.12 and 8.14 find the right orders | STOP; code fix |
| V3 | `Customer.defaultEmailAddress { emailAddress marketingState }` on 2026-07 | 8.1 to 8.3 succeed, no `shopify_graphql_error` | STOP; code fix |
| V4 | `customerCreate` with `email` + `tags`, and no account invite email sent | 8.1: customer created; your test inbox gets no account invite | If an invite is sent, report it (Daniel decides) |
| V5 | `customerEmailMarketingConsentUpdate` input shape | 8.2: consent becomes Subscribed; no `mutation_user_errors` | STOP; code fix |
| V6 | `fulfillmentOrderHold` with `handle` and `fulfillmentOrderLineItems`; non-held lines move to a new open fulfillment order | 8.9: only B held, A shippable | STOP; this is core behaviour |
| V7 | `fulfillmentOrderReleaseHold(holdIds:)` releases only Falcon holds | 8.12 | STOP; code fix. Release by hand meanwhile |
| V8 | Flow condition can compare `inventoryQuantity` with `inventoryQuantityPrior` | Phase 7.3 | Run without condition (allowed) and record |
| V9 | Flow **Send HTTP request** 30-second limit and retry on non-2xx; daily run within 30 s | 7.4 run history; `daily_done` in logs | If the daily check always times out, report; the cron still runs it daily |
| V10 | Brevo idempotency header name (`idempotencyKey` inside `headers`) | Repeat 8.14 within 30 minutes: second attempt logs `email_duplicate_suppressed`, no second email | If a second email arrives, report (duplicate protection falls back to Shopify tags only) |
| V11 | Brevo evaluates `{% if %}` in the subject field | Phase 3.3 and 8.14 / 8.16 subjects | Use the fixed subjects in 3.3 and report |
| V12 | `{% autoescape off %}` renders `rows_html` in `staff.html` | 8.19 alert shows a table, not raw `<table>` text | Report; template fix |
| V13 | `ProductVariant.media` and `Product.featuredMedia` image URL | 8.5 email shows the product image | If blank, report (email still works) |
| V14 | Brevo authorised IP blocking | First Worker email in 8.5 | If logs show `email_failed` with an IP message, turn off IP blocking (1.7 step 4) |
| V15 | Notification Liquid reads `line.properties` (order) and `line.line_item.properties` (shipping) | `INSTALL-THEME.md` 9.17 to 9.20 | Report; template fix |
| V16 | 3PL or stock sync fires the **Product variant inventory quantity changed** trigger | After go-live, the first real stock receipt shows a Flow run | If no run appears, stock arrives without the trigger: report; the 07:00 UTC daily run releases holds and sends waitlists as a fallback (up to a day late) |
| V17 | 3PL handles split and held fulfillment orders (does not ship held lines) | Watch the first real mixed order in the 3PL | STOP; staff hold the whole order by hand until resolved |
| V18 | Partial hold allowed on a fulfillment order already on hold by another app | Only if another app holds orders (Phase 0.4) | Worker alerts staff "Hold failed"; staff hold by hand |
| V19 | Custom app route and non-expiring token | Phase 1.8 | STOP at 1.8 |
| V20 | `read_all_orders` granted | Phase 1.8 scope list; later, a date change on a preorder older than 60 days | STOP; request the scope |
| V21 | Self-serve cancellation (new customer accounts) available per store | **Settings** > **Customer accounts** / **Returns** | Informational for legal review (EU withdrawal function) |
| V22 | Apex `falconenamelware.com` serves pages without redirecting to `www` | Phase 0.1 step 4 | Add it to Turnstile hostnames; ask Daniel about a redirect (the Worker allows only the `www` origin for UK) |
| V23 | Feedoptimise can map `availability=preorder` and `availability_date` from `falcon.expected_date` | Ask Daniel / Feedoptimise support | Report; feeds keep showing out of stock until solved |
| V24 | Flow metafield-changed trigger now exists | Flow trigger picker: search "metafield" | Informational only; the daily check covers date changes |

## Appendix B: legal review items (for Falcon to sign off before Phase 9)

| # | Item | Where it lives |
|---|---|---|
| L1 | **US keep-by date rule:** the customer must click "Keep my order" by the currently promised date, or by 7 days after the notice if that is sooner. Counsel to confirm this meets "before the current deadline" in 16 CFR 435.2(c) | Worker `classifyDelay`; `delay-us-consent.html` |
| L2 | **FTC wording:** silence-equals-consent sentence in the first-delay notice (definite date, 30 days or less); cancel as an equal option; refund within 7 business days (the Worker counts Monday to Friday and ignores public holidays) | `delay-us-notice.html`, `delay-us-consent.html` |
| L3 | **US reply handling:** replies are treated as keep or cancel by staff; the reply-to inbox must be monitored | `EMAILS.md` setup notes, 9.6 |
| L4 | **EU withdrawal button:** the EU date-change email links to `https://eu.falconenamelware.com/pages/withdrawal`. Falcon must confirm that page is a working "withdraw from contract here" function (Directive 2023/2673, from 19 June 2026), not just information | `SHOPS.eu.withdrawal_url`; EU store pages |
| L5 | **UK/EU cancellation wording:** cancellation stated as a legal right, full refund including delivery within 14 days | `delay-uk.html`, order confirmation block |
| L6 | **Back-in-stock email as a solicited service message:** neutral, single product, no marketing | `bis.html` |
| L7 | **Existing waitlist consent remediation** (Phase 0.3 options) | Falcon decision |
| L8 | **Reasonable basis for dates:** expected dates must come from real supplier ETAs with evidence kept | Staff guide 9.6 |
| L9 | **Postal address in email footers** (not currently included) | `EMAILS.md` setup notes |

## Appendix C: rollback plan

Use the smallest step that fixes the problem. Report to Daniel before and after.

| Problem | Rollback |
|---|---|
| Wrong or unwanted customer emails | Cloudflare: set `DRY_RUN` to `true`, **Deploy**. Customer emails stop at once (they go to staff) |
| Worker misbehaving generally | Turn off the three Falcon Flows on the affected store (Flow > workflow > **Turn off**). Remove the cron trigger in Cloudflare. The storefront notify form keeps working if the Worker is up; preorder orders will then not be held automatically, so also do the theme rollback |
| Storefront problem | **Online Store** > **Themes** > previous theme > **Publish** |
| Notification emails wrong | **Settings** > **Notifications** > template > **Edit code**: paste the saved original, **Save** |
| Preorders must stop now | On each preorder variant untick **Continue selling when out of stock** (or clear `preorder_limit`) |
| Orders held by mistake | Order > fulfillment order > **Release hold** (by hand) |
| Purple Dot needed again (before Phase 10 step 16) | Turn the Purple Dot app embed back on and re-enable its products |
| Brevo template problem | Deactivate the template in Brevo (sends fail and are logged as `email_failed`; staff are not alerted by email if `staff` is the broken one, so watch logs) |

## Appendix D: secret rotation

| Secret | How to rotate |
|---|---|
| `ADMIN_TOKEN_XX` | Uninstall and reinstall the custom app (Route A) or rotate in the Dev Dashboard; paste the new token into the Cloudflare secret; **Deploy** |
| `BREVO_API_KEY` | Brevo > **SMTP & API** > generate a new key; paste into Cloudflare; **Deploy**; delete the old key |
| `TURNSTILE_SECRET` | Turnstile widget > **Rotate secret key**; paste into Cloudflare; **Deploy** |
| `FLOW_KEY` | Generate (1.9); paste into Cloudflare and **Deploy**; then update `falcon_worker_key` in all three stores' Flow secrets and the password manager. Flows fail with 401 in between, so do it in one sitting |
| `LINK_SECRET` | Generate (1.9); paste; **Deploy**. Every link already emailed (remove, keep, cancel) stops working. Avoid unless exposed |
