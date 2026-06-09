# Deploying the October MI Shopify app to `shopify-app.octobercomms.com`

One-time setup to host the app at the production URL. After this, every `bash /opt/october-source/dev/platform/update.sh` rebuilds and reloads the Shopify app alongside the platform backend.

This is **step 2 of `LAUNCH.md`**. Read top to bottom — about 1 hour of work, mostly waiting.

## Prerequisites

- The production box is already running the platform backend at `platform.octobercomms.com` via PM2 + nginx + certbot — we reuse all of that.
- You've already created the Partner app (step 1) and have the Client ID + Client Secret.

## Step A — DNS

At your DNS provider (whoever holds `octobercomms.com`):

1. Add an **A record**:
   - Name: `shopify-app`
   - Type: `A`
   - Value: same IP as `platform.octobercomms.com` (run `dig platform.octobercomms.com +short` to confirm)
   - TTL: 300 (5 minutes) for the rollout — bump to 3600 after it's stable
2. Wait a few minutes, then verify on the production box:
   ```bash
   dig shopify-app.octobercomms.com +short
   ```
   Should return the platform's IP. If it returns nothing, give it another 5 minutes (DNS propagation).

## Step B — Provision the env file on the box

SSH into the production box, then:

```bash
cd /opt/october-source/dev/october-mi-shopify
nano .env
```

Paste this content, replacing the two placeholder values:

```
DATABASE_URL="file:./prisma/prod.db"
SHOPIFY_API_KEY="d59fb0a14692a91f650978180ef0cde8"
SHOPIFY_API_SECRET="REPLACE_WITH_CLIENT_SECRET_FROM_PARTNER_DASHBOARD"
SHOPIFY_APP_URL="https://shopify-app.octobercomms.com"
SCOPES="read_customers,read_inventory,read_orders,read_products,read_themes"
OMI_PLATFORM_BASE_URL="https://platform.octobercomms.com"
OMI_FORWARD_SECRET="REPLACE_WITH_SAME_VALUE_AS_PLATFORM_BACKEND_ENV"
```

`Ctrl+O`, `Enter`, `Ctrl+X` to save.

`OMI_FORWARD_SECRET` **must match** the value already set in `/opt/october-source/dev/platform/backend/.env` — that's how the platform verifies forwarded webhooks. Check it with:

```bash
grep OMI_FORWARD_SECRET /opt/october-source/dev/platform/backend/.env
```

Copy the value across.

## Step C — Run the deploy script

```bash
bash /opt/october-source/dev/platform/update.sh
```

The script now detects `dev/october-mi-shopify/.env` and goes through:
1. `npm install` (full, with dev deps for the build step)
2. `npx prisma generate && npx prisma migrate deploy` (creates `prisma/prod.db`)
3. `npm run build` (Remix production build)
4. `npm prune --omit=dev` (drops dev deps to save disk)
5. `pm2 reload october-mi-shopify --update-env`

At the end the script prints `pm2 list` filtered to both processes — both should show `online`.

Verify the Node side is up:

```bash
curl http://127.0.0.1:3002/
```

(Should return some HTML or a redirect, not a connection-refused error.)

## Step D — nginx vhost + TLS

The vhost template is checked into the repo at `docs/october-mi-shopify/nginx.conf.example`. Install it:

```bash
sudo cp /opt/october-source/docs/october-mi-shopify/nginx.conf.example \
        /etc/nginx/sites-available/shopify-app.octobercomms.com

sudo ln -s /etc/nginx/sites-available/shopify-app.octobercomms.com \
           /etc/nginx/sites-enabled/

sudo nginx -t
sudo systemctl reload nginx
```

Then issue a TLS cert via certbot (the platform box already has certbot installed):

```bash
sudo certbot --nginx -d shopify-app.octobercomms.com
```

certbot rewrites the vhost to add the 443 listener + HTTP→HTTPS redirect. Reload nginx is automatic.

Verify:

```bash
curl -I https://shopify-app.octobercomms.com/
```

Should return 200 (or 302 redirect to a login flow) — anything that's not a connection error or a cert error means it's live.

## Step E — Re-push the app config to Shopify

The Shopify-side webhook subscriptions need to be updated to point at the new production URL (they may currently point at a stale Cloudflare tunnel from `shopify app dev`). On your **Mac**, in the project folder:

```bash
cd ~/code/claude/dev/october-mi-shopify
shopify app deploy
```

Confirm when it asks. This pushes `shopify.app.october-marketing-intelligence.toml` to Shopify, which uses `application_url = "https://shopify-app.octobercomms.com"` and updates the webhook subscription URIs accordingly.

## Step F — Verify end-to-end against the production URL

In a browser:

1. Go to **partners.shopify.com** → Apps → **October Marketing Intelligence** → **Test on development store**
2. Click **Install on test store** for your existing dev store
3. Shopify takes you through OAuth and lands you in the embedded admin at `https://admin.shopify.com/store/october-communications/apps/october-marketing-intelligence`
4. The pairing screen loads (served by the production app this time, not the Cloudflare tunnel)
5. Generate a fresh Shopify token from the platform UI → Settings → Integrations → Tools
6. Paste, click Pair store
7. Should flip to "Connected to [client name]" exactly like in dev

Then place a test order in the dev store. Watch the production app's logs:

```bash
pm2 logs october-mi-shopify --lines 50
```

You should see lines about incoming Shopify webhooks and the `forwardWebhook` calls to the platform.

## Done

After step F passes, the app is hosted at its real URL, talking to the platform, syncing real webhooks. From there `LAUNCH.md` step 7 (final pre-submission checks in Partner dashboard) + step 8 (submit) are the only things left.

## Rollback / debugging

If something goes wrong:

- **App won't start**: `pm2 logs october-mi-shopify --lines 200` — almost always a missing env var or a Prisma schema mismatch.
- **nginx 502 Bad Gateway**: the Remix process isn't listening on 3002. Check `pm2 list` and the logs above.
- **HMAC mismatch in production**: `OMI_FORWARD_SECRET` mismatch between this app and the platform backend. Re-grep both `.env` files and reconcile.
- **Disable the app entirely** (in an emergency): `pm2 stop october-mi-shopify`. The platform side will mark connections as stale after a few minutes of webhook silence but won't crash.
