# OC Mail — Hetzner Deploy Runbook (test environment)

Stand up a stock MailFlow instance on a single Hetzner Cloud server. Designed so
the whole install is **one self-running script** — you (or a browser agent like
Claude for Chrome) only create the server; it installs and launches itself on
first boot.

> **You do _not_ connect a GitHub repo for this.** Stock MailFlow runs from
> prebuilt Docker images pulled from GHCR. The repo/fork matters only later, when
> we add the cross-account move feature.

## 1. Server spec

| Setting | Value |
|---|---|
| Image | **Ubuntu 24.04** |
| Type | **CX22** (x86, 2 vCPU / 4 GB / 40 GB) — ~€4–5/mo. Use x86, not Arm, to avoid image-arch surprises. |
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
