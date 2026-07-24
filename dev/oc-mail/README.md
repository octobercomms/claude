# dev/oc-mail

Code + deploy tooling for **OC Mail** — October's self-hosted, multi-account
web email client. See [`docs/oc-mail/`](../../docs/oc-mail/) for the project
brief and deploy runbooks.

## Current contents

| Path | What it is |
|------|------------|
| `deploy/cloud-init.sh` | **Fresh Hetzner box (x86 or Arm).** One-shot cloud-init bootstrap — installs Docker and stands up stock MailFlow from prebuilt images. Paste into the "Cloud config" field at server creation. Runbook: [`hetzner-deploy.md`](../../docs/oc-mail/hetzner-deploy.md) (Option A). |
| `deploy/oracle-cloud-init.sh` | **Oracle Cloud Always-Free (Ampere A1, ARM).** Same bootstrap, and also opens host iptables 80/443 (an Oracle-specific gotcha). Runbook: [`oracle-deploy.md`](../../docs/oc-mail/oracle-deploy.md). |
| `deploy/install-existing.sh` | **Existing box already using 80/443** (e.g. the `email` box that runs Mautic). Binds MailFlow's frontend to localhost and is re-run safe (never clobbers `ENCRYPTION_KEY`). Runbook: [`hetzner-deploy.md`](../../docs/oc-mail/hetzner-deploy.md) (Option B). |
| `deploy/Caddyfile` | Host reverse proxy for the existing-box path — routes `mail.` → MailFlow and (during a transition) `email.` → Mautic by hostname, with automatic Let's Encrypt certs. |

Pick by situation: a **fresh box** (`cloud-init.sh`) is cleanest when the
cost-optimised Hetzner types are available; the **free ARM** path
(`oracle-cloud-init.sh`) avoids per-month cost; the **existing-box** path
(`install-existing.sh` + `Caddyfile`) co-hosts on a server you already run when
you'd rather not provision a new one. The cloud-init scripts paste into the
provider's user-data field; none contain secrets — they're generated on the box.

## Status

OC Mail is built on [MailFlow](https://github.com/maathimself/mailflow)
(AGPL-3.0) — the "window, not warehouse" model: it connects to your existing
Gmail and IMAP mailboxes; it does not host mail itself. Images are multi-arch
(amd64 + arm64), so cheap/free ARM hosts (Oracle A1, Hetzner CAX) are viable.

The application code itself is **not yet vendored here** — phase 1 runs stock
MailFlow to validate it. Once confirmed, a fork lands under this directory to
add the cross-account **move** feature (Airmail parity) and wire in Claude.
See the brief for the phased plan.
