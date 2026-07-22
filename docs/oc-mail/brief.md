# OC Mail — Project Brief

**One web-based email client for all of October's accounts** — some Gmail, some
IMAP — with Gmail-quality threading, search, and unified inbox, plus an AI
assistant. A replacement for juggling Airmail, StackMail webmail, and the Gmail
UI: one window into everything.

## The core principle: window, not warehouse

OC Mail is a **client**, not a mail host. Mail continues to live where it
already does (Gmail, 20i/StackMail, etc.). OC Mail connects to those mailboxes
over IMAP and sends through each account's own SMTP. We replace the *interface*,
not the *hosting* — which means:

- We never open Airmail / StackMail webmail / the Gmail UI again.
- Sending stays reliable (mail still leaves via the real provider's SMTP).
- No mail-server operations, MX/DNS, spam filtering, or deliverability burden.

Moving off the underlying providers entirely (running our own mail server) is a
separate, much larger project and explicitly out of scope.

## Why MailFlow as the base

[MailFlow](https://github.com/maathimself/mailflow) (AGPL-3.0) is the only
open-source project that already solves the exact trio of problems that make
IMAP accounts painful in Airmail:

- **Unified inbox** across Gmail + any IMAP account, per-account colour + badges
- **Conversation threading** (sent grouped with inbound)
- **Full-text search** across all connected accounts

Stack: Node 22 + React + PostgreSQL + Redis, Docker-native. It also ships a
built-in AI assistant that accepts "any OpenAI-compatible provider," so Claude
drops in with no code.

## Architecture at a glance

```
  Browser ──HTTPS──> nginx (frontend, React SPA)
                        │  proxies /api
                        ▼
                     Node backend ──> PostgreSQL  (accounts, message index, search)
                        │             Redis        (sessions)
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                 ▼
     Gmail IMAP   StackMail IMAP    other IMAP   ...  (mail stays here)
     + SMTP        + SMTP            + SMTP
```

## What we get free vs. what we build

| Free from MailFlow | We add (the fork) |
|---|---|
| Unified inbox, threading, search, sent-grouping | **Cross-account move** — drag/move a message from one account into another |
| Compose / reply / forward, per-account SMTP | Claude API key wired in (config, not code) |
| Folders, rules, snooze, inbox tabs, themes | (later) any October-specific polish |
| Built-in AI hooks, multi-user + SSO | |

### The cross-account move feature

This is the one Airmail capability MailFlow lacks today, and the main reason to
fork. MailFlow's `moveMessage(account, uid, fromFolder, toFolder)` is
single-account only. But the primitive we need already exists in its codebase:
`appendToFolder(account, folder, rawMessage, flags)`. So the feature is small
and well-bounded:

> fetch the raw message from account **A** → `appendToFolder(**B**, targetFolder, raw)` → delete from **A**.

All the IMAP read/write plumbing per account is already there.

## Claude integration

MailFlow's AI assistant (summarise threads, draft replies, ask about a message,
AI-reclassify inbox tabs) takes an OpenAI-compatible endpoint. Point it at
Anthropic's compatible API with an Anthropic key — no code required. A sensible
split: a fast, cheap model for constant background sorting; a top-tier model for
"draft me a reply." Exact model IDs live in the deploy runbook / setup chat, not
in this brief.

## Phased plan

1. **Stand up stock MailFlow** on a Hetzner box (test env). Add real accounts,
   confirm the unified inbox / threading / search feel right. *(← current step)*
2. **Wire in Claude** via the AI settings. Confirm summaries/drafts.
3. **Fork** MailFlow into `dev/oc-mail/`, add the cross-account **move** feature.
4. Deploy the fork; optionally add a real domain + Let's Encrypt.
5. (Optional, later) multi-tenant so clients can use it for their own mail —
   note the AGPL source-offer obligation when hosting for third parties.

## Repo layout (two-folder rule)

- Code + deploy tooling → `dev/oc-mail/`
- Docs (this brief, deploy runbook) → `docs/oc-mail/`

## Licensing note

MailFlow is dual-licensed **AGPL-3.0** + a commercial licence. Self-hosting for
ourselves is free. If we ever host it *for third parties* (clients logging in),
AGPL requires offering them the source, or buying the commercial licence
(one-time). Fine for a personal/internal tool; a decision point before any
client-facing service.
