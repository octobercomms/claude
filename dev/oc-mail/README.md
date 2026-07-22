# dev/oc-mail

Code + deploy tooling for **OC Mail** — October's self-hosted, multi-account
web email client. See [`docs/oc-mail/`](../../docs/oc-mail/) for the project
brief and deploy runbook.

## Current contents

| Path | What it is |
|------|------------|
| `deploy/cloud-init.sh` | **Option A (fresh box).** One-shot server bootstrap for a new Hetzner Cloud box — installs Docker and stands up a stock MailFlow instance from prebuilt images. Paste it into the "Cloud config" field when creating the server. |
| `deploy/install-existing.sh` | **Option B (existing box).** Installs MailFlow onto a server already running something on 80/443 (e.g. the `email` box that runs Mautic). Binds the frontend to localhost and is re-run safe (never clobbers `ENCRYPTION_KEY`). |
| `deploy/Caddyfile` | **Option B.** Host reverse proxy that terminates TLS and routes `mail.` → MailFlow and (during the transition) `email.` → Mautic by hostname, with automatic Let's Encrypt certs. |

See [`docs/oc-mail/hetzner-deploy.md`](../../docs/oc-mail/hetzner-deploy.md) for
when to use each option — Option B is the recommended path while Hetzner's
cost-optimised Shared vCPU types show "unavailable".

## Status

OC Mail is built on [MailFlow](https://github.com/maathimself/mailflow)
(AGPL-3.0) — the "window, not warehouse" model: it connects to your existing
Gmail and IMAP mailboxes; it does not host mail itself.

The application code itself is **not yet vendored here** — the first phase runs
stock MailFlow to validate it. Once confirmed, a fork lands under this directory
to add the cross-account **move** feature (Airmail parity) and wire in Claude.
See the brief for the phased plan.
