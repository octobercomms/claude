# dev/oc-mail

Code + deploy tooling for **OC Mail** — October's self-hosted, multi-account
web email client. See [`docs/oc-mail/`](../../docs/oc-mail/) for the project
brief and deploy runbooks.

## Current contents

| Path | What it is |
|------|------------|
| `deploy/cloud-init.sh` | One-shot bootstrap for a **Hetzner Cloud** box (x86 or Arm) — installs Docker and stands up stock MailFlow from prebuilt images. Runbook: [`docs/oc-mail/hetzner-deploy.md`](../../docs/oc-mail/hetzner-deploy.md). |
| `deploy/oracle-cloud-init.sh` | Same bootstrap adapted for **Oracle Cloud Always-Free (Ampere A1, ARM)** — also opens host iptables 80/443 (an Oracle-specific gotcha). Runbook: [`docs/oc-mail/oracle-deploy.md`](../../docs/oc-mail/oracle-deploy.md). |

Both paste into the provider's cloud-init / user-data field at server-creation
time. Neither contains secrets — secrets are generated on the server.

## Status

OC Mail is built on [MailFlow](https://github.com/maathimself/mailflow)
(AGPL-3.0) — the "window, not warehouse" model: it connects to your existing
Gmail and IMAP mailboxes; it does not host mail itself. Images are multi-arch
(amd64 + arm64), so cheap/free ARM hosts (Oracle A1, Hetzner CAX) are viable.

The application code itself is **not yet vendored here** — phase 1 runs stock
MailFlow to validate it. Once confirmed, a fork lands under this directory to
add the cross-account **move** feature (Airmail parity) and wire in Claude.
See the brief for the phased plan.
