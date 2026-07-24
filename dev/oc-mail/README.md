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
| `fork/october-branding-and-cross-account-move.patch` | **The October fork, as one patch** (`git diff --binary` vs pinned upstream). October theme + logomark + favicon + app icons, and the **cross-account move** feature. |
| `fork/apply.sh` | Clones pinned upstream and applies the patch → a ready-to-build branded checkout. |
| `fork/README.md` | What the patch changes and the two ways to ship it (public fork vs build-from-patch). Deploy: [`fork-build.md`](../../docs/oc-mail/fork-build.md). |

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

Phase 1 (stock MailFlow) is deployed and validated on the Hetzner CX23. The
October **fork** now lives in [`fork/`](fork/) as a self-contained patch: it
rebrands the app (theme, two-bar logomark, mail favicon, app icons) and adds the
cross-account **move** feature (Airmail parity) — right-click a message →
"Move to account →". Build & switch the running server with
[`docs/oc-mail/fork-build.md`](../../docs/oc-mail/fork-build.md). Tighter Claude
wiring (prompt caching, your-voice drafting) is the next phase; the AI assistant
already works today via the OpenAI-compatible endpoint. See the brief for the
phased plan.
