# October Mail — build & deploy the branded fork

The stock MailFlow you deployed runs from **prebuilt images**. The October
branding (logo, favicon, theme) and the **cross-account move** feature change the
source, so the branded app must be **built from source**. This runbook switches
the running Hetzner CX23 (`mail.octobercomms.com`) from the prebuilt stack to the
branded build.

The customizations live as a single patch in
[`dev/oc-mail/fork/`](../../dev/oc-mail/fork/) — see that folder's README for
what changed and why. `apply.sh` turns pinned upstream + the patch into a
ready-to-build checkout.

## 0. One-time: the fork (Option A)

Repo creation isn't available to the automation, so this is the one manual step:

1. On GitHub, **fork `maathimself/mailflow` → `octobercomms/mailflow`** (public).
2. Push the branded branch to it (from a machine with the repo + patch):
   ```bash
   dev/oc-mail/fork/apply.sh mailflow-oct
   cd mailflow-oct
   git remote set-url origin https://github.com/octobercomms/mailflow.git
   git checkout -b october && git commit -am "October branding + cross-account move"
   git push -u origin october
   ```

You can skip this entirely and build straight from the patch (§1B) — the fork is
just a nicer home for the changes and satisfies AGPL if you ever host for clients.

## 1. Get the branded source onto the server

SSH in, then either:

**1A — from the fork (after §0):**
```bash
cd /opt
git clone -b october https://github.com/octobercomms/mailflow.git mailflow-oct
```

**1B — from the patch (works today, no fork):** copy `dev/oc-mail/fork/` to the
server (e.g. `scp -r dev/oc-mail/fork root@mail.octobercomms.com:/opt/oct-fork`)
then:
```bash
cd /opt
/opt/oct-fork/apply.sh mailflow-oct
```

Either way you now have `/opt/mailflow-oct` with the full buildable source.

## 2. Carry over your existing config

Reuse the `.env` from the running stack so the secrets, `APP_URL`, `DOMAIN`, and
`ACME_EMAIL` stay identical (no cert re-issue, no data-key change):
```bash
cp /opt/mailflow/.env /opt/mailflow-oct/.env
# confirm these are set (they were, from the first deploy):
grep -E '^(DOMAIN|ACME_EMAIL|APP_URL)=' /opt/mailflow-oct/.env
#   DOMAIN=mail.octobercomms.com
#   ACME_EMAIL=admin@octobercomms.com
#   APP_URL=https://mail.octobercomms.com
```

> **Note — no braces bug here.** The build stack mounts the repo's `Caddyfile`
> (which uses Caddy's own `{$DOMAIN}` env syntax), so Docker Compose never
> interpolates it. The `{mail.octobercomms.com}` literal-braces problem was
> specific to the prebuilt `docker-compose.ghcr.yml`'s inline Caddy config and
> does not recur here.

## 3. Build & bring it up (HTTPS)

To **reuse the current database** (keep your added accounts + local index), build
under the **same Compose project name** as the running stack so the named volumes
are shared. The running stack's project is its directory name, `mailflow`:

```bash
cd /opt/mailflow && docker compose -f docker-compose.ghcr.yml --profile https down   # stop old stack (keeps volumes)
cd /opt/mailflow-oct
docker compose -p mailflow -f docker-compose.yml -f docker-compose.https.yml --profile https up -d --build
```

`-p mailflow` points the build stack at the existing `mailflow_postgres_data` /
`mailflow_caddy_data` volumes, so accounts, sessions, and the Let's Encrypt cert
carry straight over. First build takes a few minutes (compiles frontend + backend).

> Don't need the old data? Drop `-p mailflow` and just re-add accounts — October Mail
> is a *window, not a warehouse*, so nothing but credentials is re-entered; no
> mail is ever lost (it lives on Gmail/20i). See `brief.md`.

## 4. Verify

```bash
docker compose -p mailflow ps            # frontend, backend, postgres, redis, caddy up
curl -sI https://mail.octobercomms.com | head -1     # 200/302 over TLS
```

Then open the site: the login screen shows the **two-bar October logomark** on
white, the tab favicon is the **envelope + gold asterisk**, the UI is the October
theme, and right-clicking a message offers **"Move to account →"**.

## 5. Updating later

Change the branded tree, regenerate the patch (see `dev/oc-mail/fork/README.md`),
and on the server `git pull` (fork) or re-run `apply.sh` into a fresh dir, then
repeat §3. Because the DB volume is external to the build, rebuilds never touch
your accounts.

> **Gotcha — asset-only changes need `--no-cache`.** A plain
> `docker compose … up -d --build` can hit the Docker layer cache for
> `COPY . /repo` / `npm run build` / `COPY dist → nginx` and serve the **old**
> build even after `git pull` brought new files — most visibly when you only
> changed static assets (icons, images, favicon). If a rebuild doesn't take,
> force the frontend fresh:
> ```bash
> docker compose -p mailflow -f docker-compose.yml -f docker-compose.https.yml --profile https build --no-cache frontend
> docker compose -p mailflow -f docker-compose.yml -f docker-compose.https.yml --profile https up -d
> ```
> Verify the container actually has the new file (hashes must match):
> ```bash
> sha256sum frontend/public/apple-touch-icon.png
> docker compose -p mailflow exec frontend sha256sum /usr/share/nginx/html/apple-touch-icon.png
> ```
> Note browser + iOS also cache icons hard: check with a fresh cache-buster
> (`…/apple-touch-icon.png?x=<new-number>`), and on iPhone delete + re-add the
> home-screen icon (the `apple-touch-icon` link carries a `?v=` query so a fresh
> add re-fetches).

## Cross-account move — how it behaves

Right-click any message → **Move to account →** → pick a destination account. The
message is `APPEND`ed into that account's **INBOX** and removed from the source
(delete happens only after the copy is confirmed, so a failure leaves the original
in place — never lost). Both accounts' inboxes and unread badges update live. It
moves the **single** right-clicked message (threads can span accounts, so the
whole-thread case is intentionally out of scope for now).
