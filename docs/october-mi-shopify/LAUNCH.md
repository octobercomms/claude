# Shopify app — launch checklist

Everything still to do to get **October Marketing Intelligence** live on the Shopify App Store. The code is finished and merged; what's left is operational work: a Shopify Partner app entry, a subdomain to host it on, a privacy policy, listing assets, and the App Store submission itself.

Work through the steps in order. Each step ends with what to send back to me / what I'll do next.

**Estimated total time:** 4-6 hours of your time (most of it design + waiting), plus 1-2 weeks of Shopify review after submission.

---

## Step 1 — Create the Shopify Partner app entry (you, 15 mins)

1. Sign in to https://partners.shopify.com. If you don't have a Partner account, create one with `octobercomms.com` as the business email.
2. **Apps** → **Create app** → **Create app manually**.
3. App name: `October Marketing Intelligence`.
4. App URL: leave as a placeholder for now (e.g. `https://shopify-app.octobercomms.com`) — we'll set the real one in step 2.
5. Allowed redirection URLs: `https://shopify-app.octobercomms.com/auth/callback`, `https://shopify-app.octobercomms.com/auth/shopify/callback`, `https://shopify-app.octobercomms.com/api/auth/callback`.
6. Create. You'll land on the app's overview page.
7. Note the two values Shopify shows you:
   - **Client ID** (looks like `abc123def456...`)
   - **Client secret** (long string — copy somewhere safe, you only see it once)

**Send back to me:** the Client ID. (Not the secret — that lives in env, never in git.)

**I will:** open a PR setting `client_id` in `dev/october-mi-shopify/shopify.app.toml` and document `SHOPIFY_API_SECRET` in the deploy env vars.

---

## Step 2 — Provision the subdomain (you + me, ~1 hour)

The Remix app needs to run somewhere with a real domain + TLS. Cheapest is alongside the existing platform backend on the same box.

### What you do

1. **DNS** — at your DNS provider, add an `A` record:
   - `shopify-app.octobercomms.com` → same IP as `platform.octobercomms.com`
2. Wait a few mins for it to propagate (`dig shopify-app.octobercomms.com +short` should return the IP).

### What I do (one PR)

I'll ship a PR that adds:
- An nginx vhost for `shopify-app.octobercomms.com` proxying to a new PM2 process on port `3002`
- A second PM2 app entry in `dev/platform/ecosystem.config.js` (or a sibling config) that runs `dev/october-mi-shopify` via Remix's production server
- A snippet for `update.sh` so the Shopify app gets installed / built / reloaded alongside the platform
- TLS via Let's Encrypt (assuming `certbot` is already on the box — same pattern as `platform.octobercomms.com`)

### Env vars to set on the box (you, in `/opt/october-source/dev/october-mi-shopify/.env`)

```
SHOPIFY_API_KEY=<the Client ID from step 1>
SHOPIFY_API_SECRET=<the Client secret from step 1>
SHOPIFY_APP_URL=https://shopify-app.octobercomms.com
SCOPES=read_orders,read_customers,read_products,read_inventory,read_themes
OMI_PLATFORM_URL=https://platform.octobercomms.com
OMI_FORWARD_SECRET=<generate a random 64-char hex string with: openssl rand -hex 32>
DATABASE_URL=file:./prisma/prod.db
```

The same `OMI_FORWARD_SECRET` value must also be set on the platform backend (`/opt/october-source/dev/platform/backend/.env`) so HMAC verification matches.

**Send back to me:** confirmation that `dig shopify-app.octobercomms.com` returns the right IP and the env file is in place.

**I will:** ship the nginx + PM2 + update.sh PR. Once merged and `update.sh` is run, the Remix app will be reachable at `https://shopify-app.octobercomms.com/`.

---

## Step 3 — Privacy policy (me, then you publish)

Shopify requires a privacy policy URL on the listing.

**I will:** draft a markdown file `docs/october-mi-shopify/PRIVACY.md` (~500 words) covering:
- What data the app collects (orders, customers, products, inventory, themes)
- What we do with it (forward to the October MI platform for marketing analysis)
- Where it's stored (UK, your platform DB)
- How clients can request deletion (mandatory GDPR webhooks already handle this)
- Contact for data requests (`privacy@octobercomms.com` or similar)

**You will:**
- Publish the policy at `https://octobercomms.com/privacy-shopify` (or wherever fits your existing site)
- Send me the final URL so I can drop it into the listing copy

---

## Step 4 — Listing copy (me)

**I will:** draft listing copy as `docs/october-mi-shopify/LISTING.md`:
- **Tagline** (~80 chars) — one line under the app name on the listing page
- **Detailed description** (~500 words) — what the app does, who it's for, what AMs and clients get out of it
- **Support page copy** — what to put at `https://octobercomms.com/support/shopify` (or similar)

You review, tweak voice, send back the final.

---

## Step 5 — Listing assets (you, design work — ~2-3 hours)

Shopify requires visual assets you'll need to produce in Figma / Photoshop / Canva:

| Asset | Spec | Notes |
|---|---|---|
| **App icon** | 1200×1200 PNG, transparent or solid | The "O" mark on a brand colour background works |
| **Feature image** | 1600×900 PNG | Hero image at the top of the listing — "Marketing intelligence for Shopify stores" with a screenshot of the platform |
| **Screenshots** | 1600×900 PNG, 3-5 of them | Show: (1) pairing screen in Shopify admin, (2) connected state with sync stats, (3) the data flowing into the October MI dashboard, (4) a sample report, (5) the Integrations hub |

You take the screenshots from:
1. A dev-store install of the app (after step 6 is set up)
2. Your existing `platform.octobercomms.com` UI

Save them all into `docs/october-mi-shopify/assets/` so we have them in the repo for resubmission later.

---

## Step 6 — End-to-end test on a development store (you, 30 mins)

Once steps 1–2 are done and the app is live at `shopify-app.octobercomms.com`:

1. In Partners → your app → **Test on development store** → create a dev store called e.g. `omi-test-store.myshopify.com`.
2. Install the app on the dev store via the Partners "Install on test store" button.
3. You should be redirected through Shopify OAuth, land on the embedded admin showing the pairing screen.
4. In the platform UI, generate a pairing token for a test client (use the Integrations hub from PR #437).
5. Paste the token into the Shopify embedded admin, click **Connect**. Should flip to "Connected to [client name]".
6. In the dev store admin, place a test order. Check the platform — the order should land in the relevant connector data within seconds (or check the `wp_connect_events`-equivalent table for `shopify_app` events).
7. Uninstall the app from the dev store. Confirm the `StorePairing` row is gone on the Shopify-app side and the platform side correctly handles the `app/uninstalled` webhook (the connector should flip to disconnected).

**Send back to me:** any failures from this run. If everything works, screenshots from the install / pairing flow that you can use as listing assets (step 5).

---

## Step 7 — Final pre-submission checks (you, 15 mins)

In the Shopify Partner dashboard for the app:

- [ ] **App URL** set to `https://shopify-app.octobercomms.com`
- [ ] **Redirect URLs** — all three listed in step 1
- [ ] **GDPR webhook URLs** — Shopify auto-detects these from `shopify.app.toml`, confirm they're showing
- [ ] **Privacy policy URL** — pointing at the page you published in step 3
- [ ] **Support URL** — pointing at your support page
- [ ] **Emergency developer contact** — email + phone in the Partner settings
- [ ] **Listing assets** uploaded (step 5)
- [ ] **Listing copy** filled in (step 4)
- [ ] **Pricing** — set to Free
- [ ] **Distribution** — Public

---

## Step 8 — Submit for review (you, 5 mins click + 1-2 weeks wait)

In Partners → your app → **App Store listing** → **Submit for review**.

Shopify's review process:
- Typical first response in 5-10 business days
- They'll either approve, or send a list of changes needed
- Common reasons for kickback: GDPR webhook handlers returning the wrong status code, missing scopes justification, listing screenshots showing UI that doesn't match the live app, privacy policy too vague

If they ask for changes: paste the feedback to me, I'll fix in a PR, you redeploy via `update.sh`, then resubmit.

---

## Cheat sheet — what to send me back, in order

1. After step 1: **Client ID** (and confirmation `SHOPIFY_API_SECRET` is set in the box's env)
2. After step 2 DNS: confirmation the subdomain resolves
3. After step 2 env: confirmation the env file is in place
4. After step 3: the published privacy policy URL
5. After step 4: edits to the draft listing copy
6. After step 6: any failures from the dev-store test
7. After Shopify reviews: any kickback feedback

I'll ship a PR after each of (1), (2-infra), (3-draft), (4-draft), and any review kickback.

## What you can do in parallel

Steps **3 (privacy)**, **4 (listing copy)**, and **5 (assets)** don't depend on the subdomain being live. You can:
- Ask me to draft the privacy policy + listing copy right now (independent of any infra)
- Start the design work for icons + feature image (the screenshots have to wait until step 6)

---

## Time budget

| Step | Your time | My time | Wall clock |
|---|---|---|---|
| 1. Partner app | 15 min | 5 min (one PR) | 30 min |
| 2. Subdomain + deploy | 30 min | 1 hour (one PR) | 2 hours |
| 3. Privacy policy | 10 min (review) | 30 min (draft) | 1 hour |
| 4. Listing copy | 20 min (review) | 30 min (draft) | 1 hour |
| 5. Listing assets | 2-3 hours | — | 2-3 hours |
| 6. Dev-store test | 30 min | — | 30 min |
| 7. Pre-submission checks | 15 min | — | 15 min |
| 8. Submit + Shopify review | 5 min | depends on kickback | 1-2 weeks |

**Realistic launch date:** 2-3 weeks from today, gated mostly on Shopify's review queue.
