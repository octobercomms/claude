# October Mail — Hetzner Deploy Runbook (test environment)

Stand up a stock MailFlow instance on a single Hetzner Cloud server. Designed so
the whole install is **one self-running script** — you (or a browser agent like
Claude for Chrome) only create the server; it installs and launches itself on
first boot.

> **You do _not_ connect a GitHub repo for this.** Stock MailFlow runs from
> prebuilt Docker images pulled from GHCR. The repo/fork matters only later, when
> we add the cross-account move feature.

## Which path do I want?

There are two ways to deploy, covered in this runbook:

- **Option A — fresh Hetzner box (§1–§9).** The original plan: create a new
  `oc-mail-test` server whose cloud-init script installs everything on first
  boot. Cleanest and most disposable. **Caveat (July 2026):** the cost-optimised
  Shared vCPU line (CX22 and its CX2x successors) is intermittently showing
  **"unavailable"** at provisioning time. If you can't create one, use Option B.
- **Option B — repurpose the existing `email` box (§10).** Reuse the CX33 in
  Helsinki (`65.108.219.243`) that currently runs the soon-to-be-retired Mautic.
  MailFlow runs alongside Mautic behind a reverse proxy during a short transition
  window, then Mautic is decommissioned and MailFlow keeps the box. No new server,
  no waiting on capacity, no extra cost. **This is the recommended path while the
  cost-optimised types are unavailable.**

Options A and B install the *same* MailFlow stack — they differ only in *where*
it runs and how the public 80/443 ports are handled.

# Option A — fresh Hetzner box

## 1. Server spec

| Setting | Value |
|---|---|
| Image | **Ubuntu 24.04** |
| Type | **CX22** (x86, 2 vCPU / 4 GB / 40 GB) — ~€4–5/mo. Use x86, not Arm, to avoid image-arch surprises. If CX22 shows **unavailable**, its direct successor **CX23** (same 2 vCPU / 4 GB / 40 GB) is fine; if the whole Shared vCPU line is unavailable, switch to **Option B** (§10). |
| Location | Any EU region (e.g. Nuremberg / Falkenstein / Helsinki) |
| Public IPv4 | **Yes** (required) |
| SSH key | Attach yours if you have one in Hetzner (lets you SSH in later). Optional — without it, Hetzner emails a root password. |
| Cloud config | Paste the bootstrap script (section 2) into this field |
| Firewall | Optional but recommended — allow inbound **22, 80, 443** (see §7) |
| Name | `oc-mail-test` |

Bump to CX32 (8 GB) only if syncing many large mailboxes feels heavy — unlikely
for a first test.

## 2. The bootstrap script

The exact script lives at
[`dev/oc-mail/deploy/cloud-init.sh`](../../dev/oc-mail/deploy/cloud-init.sh).
Paste its **entire contents** into the server's **"Cloud config"** (user-data)
field at creation time. It:

1. installs Docker + the compose plugin,
2. downloads MailFlow's prebuilt-image compose file + env template,
3. **generates all three secrets on the server** (`SESSION_SECRET`,
   `DB_PASSWORD`, `ENCRYPTION_KEY`) — never typed by hand or pasted anywhere,
4. sets `APP_URL` to the server's own public IP,
5. runs `docker compose up -d` (Postgres + Redis + backend + nginx frontend).

It contains **no secrets and no email credentials**. HTTPS is served on `:443`
with an automatic self-signed certificate (browser will warn — expected for a
test).

## 3. Brief for a browser agent (Claude for Chrome)

Paste this to your Claude-for-Chrome, with the bootstrap script from §2 pasted
in where noted. It only performs console clicks — it should never type secrets.

> **Task:** In the Hetzner Cloud Console (`console.hetzner.cloud`), create a test
> server and let its cloud-init script self-install the app. Steps:
>
> 1. Open my Hetzner Cloud project (or create one named `oc-mail`).
> 2. **Servers → Add Server.**
> 3. **Location:** an EU region (Nuremberg or Falkenstein is fine).
> 4. **Image:** Ubuntu 24.04.
> 5. **Type:** Shared vCPU (x86) → **CX22**.
> 6. Keep **Public IPv4** enabled.
> 7. **SSH keys:** select my existing key if one is listed; otherwise continue
>    without one.
> 8. **Cloud config:** paste the following script verbatim into the Cloud config
>    / user-data field:
>
>    ```
>    <PASTE THE CONTENTS OF dev/oc-mail/deploy/cloud-init.sh HERE>
>    ```
>
> 9. (Recommended) Create/attach a **Firewall** allowing inbound TCP **22, 80,
>    443**.
> 10. **Name:** `oc-mail-test`. Create the server.
> 11. Wait ~2–3 minutes for first-boot install, then open `https://<SERVER_IP>`
>     and report the IP back to me.
>
> **Do not** enter any passwords, API keys, or email credentials anywhere — the
> script generates its own secrets, and email-account logins are added by me
> later inside the app. If a step needs a real secret, stop and ask.

## 4. First login + add accounts

1. Browse to `https://<SERVER_IP>` and accept the self-signed cert warning.
2. Create your MailFlow **account** (this is the app login, not an email account).
3. **Settings → Accounts → Add account.** For each mailbox:
   - **Gmail / Workspace:** OAuth, or an **app password** (with 2FA on) as
     IMAP/SMTP.
   - **StackMail / 20i and other IMAP:** that mailbox's IMAP host + SMTP host +
     username + password (20i shows these in its mail settings).
4. Let it sync; the unified inbox fills in. This is the "does it feel right" test.

## 5. Enabling Claude (AI assistant)

In MailFlow's AI settings, choose the **OpenAI-compatible provider** option and
set:

- **Base URL:** `https://api.anthropic.com/v1/`
- **API key:** an Anthropic API key
- **Model:** a current Claude model ID *(exact strings provided in setup chat —
  a top-tier model for drafting replies, a fast/cheap one for bulk inbox
  sorting)*

Then try "summarise this thread" / "draft a reply" on a real message.

## 6. Optional — real domain + trusted HTTPS

To drop the self-signed warning:

1. Point an A record (e.g. `mail.octobercomms.com`) at the server IP.
2. On the server, edit `/opt/mailflow/.env`: set `APP_URL=https://mail.octobercomms.com`,
   `DOMAIN=mail.octobercomms.com`, `ACME_EMAIL=…`.
3. Restart with the HTTPS profile:
   `docker compose -f docker-compose.yml -f docker-compose.https.yml --profile https up -d`
   (Caddy fetches a Let's Encrypt cert automatically; ports 80/443 must be open.)

## 7. Optional — firewall

Attach a Hetzner Cloud Firewall allowing inbound TCP **22** (SSH), **80**, and
**443**. MailFlow is login-gated and encrypts stored credentials at rest, but a
firewall is good hygiene even for a test box. Restrict 22 to your own IP if you
can.

## 8. Security notes

- Secrets are generated on the box by the bootstrap script — keep `ENCRYPTION_KEY`
  stable (losing/changing it makes stored email credentials unreadable).
- Never paste real email passwords into a browser-agent transcript or any file —
  they go into MailFlow's own Settings UI only.
- This is a test box: use throwaway/app-specific passwords first if you're
  cautious, then add the real accounts once it's proven.

## 9. Teardown

`docker compose -f /opt/mailflow/docker-compose.yml down -v` on the server, or
just delete the server in the Hetzner console. Nothing here is load-bearing —
mail lives at the providers, not on this box.

---

# Option B — repurpose the existing `email` box

Use this when you can't (or don't want to) provision a fresh server. It reuses
the existing **`email`** box — a CX33 in Helsinki, `65.108.219.243` — which today
runs a Mautic install that is being retired. MailFlow runs **alongside** Mautic
behind a single reverse proxy for a short transition window, then Mautic is
decommissioned and MailFlow keeps the box.

**Why not just paste the cloud-init script onto it?** Two reasons, and they're the
whole design of this option:

1. **Port collision.** `cloud-init.sh` (and MailFlow's compose defaults) bind the
   frontend to the host's public **:80 and :443** — which Mautic already holds.
   Two things can't own those ports. So on this box MailFlow's frontend is bound
   to **localhost** (`127.0.0.1:8443` / `:8080`) and a host reverse proxy routes
   traffic to it by hostname.
2. **Subdomain, not subpath.** MailFlow is a React SPA that expects to live at a
   web root, so it gets its own hostname — **`mail.octobercomms.com`** — rather
   than a `/mail` subpath. (Mautic is a traditional PHP app and *can* live under a
   subpath, but during the transition it's simplest to leave it exactly where it
   is on `email.octobercomms.com`.)

Files for this path live in
[`dev/oc-mail/deploy/`](../../dev/oc-mail/deploy/):
[`install-existing.sh`](../../dev/oc-mail/deploy/install-existing.sh) and
[`Caddyfile`](../../dev/oc-mail/deploy/Caddyfile).

### 10.1 Before you touch the box

- **Snapshot it.** Hetzner Console → the `email` server → **Snapshots → Take
  snapshot**. This box has live Mautic data; a snapshot is your undo button.
- **Check headroom.** SSH in and confirm there's room for a second stack
  (Postgres + Redis + Node + nginx) next to Mautic (PHP + MySQL):
  `free -m` (want ≳1.5 GB free) and `df -h /` (want a few GB free).
- **See what owns 80/443:** `ss -ltnp '( sport = :80 or sport = :443 )'`. That's
  the web server you'll put behind the new proxy in §10.4.

### 10.2 DNS

Add an **A record** for `mail.octobercomms.com` → `65.108.219.243`. Leave the
existing `email.octobercomms.com` record pointing at the same box (Mautic keeps
it during the transition). Wait for it to resolve before requesting certs in
§10.4 (Let's Encrypt validates over HTTP).

### 10.3 Install MailFlow (localhost-bound)

SSH into the box as root and run the existing-server installer. It installs
Docker only if missing, binds the frontend to localhost, and — critically — is
**re-run safe**: it never overwrites an existing `.env`, so `ENCRYPTION_KEY`
stays stable.

```bash
curl -fsSL -o install-existing.sh \
  https://raw.githubusercontent.com/octobercomms/claude/main/dev/oc-mail/deploy/install-existing.sh
MAIL_DOMAIN=mail.octobercomms.com bash install-existing.sh
```

At this point MailFlow is up but only reachable on `127.0.0.1:8443` — not yet
public. That's intentional; the proxy in the next step exposes it.

### 10.4 Reverse proxy (pick one)

**Recommended — a host Caddy fronts both apps** (clean end state, real certs for
both):

1. Move Mautic's own web server off the public ports onto a localhost port, e.g.
   have Apache/nginx listen on `127.0.0.1:8081` instead of `:80/:443`. (Since
   Mautic is being retired, this reconfiguration is temporary.)
2. Install Caddy and drop in [`Caddyfile`](../../dev/oc-mail/deploy/Caddyfile):
   ```bash
   cp dev/oc-mail/deploy/Caddyfile /etc/caddy/Caddyfile
   systemctl reload caddy
   ```
   It terminates TLS for both hostnames and routes `mail.` → MailFlow
   (`127.0.0.1:8443`, self-signed, verification skipped) and `email.` → Mautic
   (`127.0.0.1:8081`). Each gets an automatic Let's Encrypt cert — the
   self-signed warning from Option A is gone.

**Zero-touch-Mautic alternative** — if Mautic is on native Apache and you'd
rather not move it, keep it on `:80/:443` and just add **one proxy vhost** to its
existing Apache for `mail.octobercomms.com` → `https://127.0.0.1:8443/`
(`SSLProxyEngine on`, `SSLProxyVerify none`), with a certbot cert for the new
hostname. No new proxy layer; you're only adding a vhost to the server that's
already terminating TLS.

> **Which one?** It depends on how Mautic runs today (native LAMP vs Docker) —
> check with the `ss` command in §10.1. The Caddy path is the cleaner end state
> and what the retirement is heading toward; the Apache-vhost path is the least
> invasive if you want to touch Mautic as little as possible.

### 10.5 First login, accounts, Claude

Identical to **§4** and **§5** above, except you browse to
`https://mail.octobercomms.com` (a real, trusted cert — no warning to accept).

### 10.6 Cut over, then retire Mautic

Once MailFlow has your accounts connected and feels right:

1. Export/back up anything still wanted from Mautic.
2. Stop Mautic and its DB (e.g. `docker compose down` in its dir, or
   `systemctl stop` its services + MySQL).
3. **Delete the `email.octobercomms.com` block from the `Caddyfile`** and
   `systemctl reload caddy`. Optionally repoint `mail`'s role onto the bare host
   or move DNS as you like — MailFlow now has the box to itself.
4. Keep the pre-change snapshot from §10.1 until you're certain nothing from
   Mautic is needed.

### 10.7 Notes specific to co-hosting

- **Don't re-run the installer expecting a reset** — it deliberately preserves
  `.env`. To truly start over, `docker compose down -v` in `/opt/mailflow` and
  remove the dir first.
- **Firewall:** if a Hetzner Cloud Firewall is attached to this box, make sure
  inbound **80** and **443** are allowed (Caddy needs 80 for ACME challenges).
- Everything in **§8 Security notes** still applies — especially keeping
  `ENCRYPTION_KEY` stable.
