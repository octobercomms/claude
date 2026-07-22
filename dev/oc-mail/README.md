# dev/oc-mail

Code + deploy tooling for **OC Mail** — October's self-hosted, multi-account
web email client. See [`docs/oc-mail/`](../../docs/oc-mail/) for the project
brief and deploy runbook.

## Current contents

| Path | What it is |
|------|------------|
| `deploy/cloud-init.sh` | One-shot server bootstrap for a Hetzner Cloud box — installs Docker and stands up a stock MailFlow instance from prebuilt images. Paste it into the "Cloud config" field when creating the server. |

## Status

OC Mail is built on [MailFlow](https://github.com/maathimself/mailflow)
(AGPL-3.0) — the "window, not warehouse" model: it connects to your existing
Gmail and IMAP mailboxes; it does not host mail itself.

The application code itself is **not yet vendored here** — the first phase runs
stock MailFlow to validate it. Once confirmed, a fork lands under this directory
to add the cross-account **move** feature (Airmail parity) and wire in Claude.
See the brief for the phased plan.
