# Thunderbird CLI + MCP setup

Gives a local Claude Code or Claude Desktop session read, search and draft-write
access to Thunderbird. Thunderbird keeps all IMAP/SMTP credentials; the tooling
never sees a password.

Upstream: https://github.com/vitalio-sh/thunderbird-cli (MIT, single maintainer)

## Why this cannot run in a cloud session

The bridge binds to `127.0.0.1` and talks to a running Thunderbird process. A
claude.ai cloud container has neither, so cloud sessions cannot use these tools.
Run Claude Code locally (`claude` in this repo, or `claude remote-control`) when
you want mailbox access.

## Version floor

Use npm `thunderbird-cli` >= 1.1.0 and extension >= 2.1.0 only.

Releases before September 2026 shipped an unauthenticated bridge HTTP listener
with no CSRF, DNS-rebinding or WebSocket-hijack protection, meaning any web page
you visited could reach your mailbox. The September 2026 release enforces
`TB_AUTH_TOKEN`, blocks browser-originated attacks and clears the then-open
Dependabot alerts. Earlier versions are not safe to run.

## Install

Requires Thunderbird 128+ and Node 20+.

```bash
npm install -g thunderbird-cli thunderbird-cli-bridge
```

Install the extension: download the signed XPI from the releases page, then
Thunderbird → Add-ons → gear icon → Install Add-on From File → `thunderbird_ai_bridge-*.xpi`.

Verify the XPI is signed rather than trusting the README; issue #11 upstream
flagged a release where the signing claim did not match the artefact.

## Generate the auth token

```bash
export TB_AUTH_TOKEN="$(openssl rand -hex 32)"
```

Put the export in your shell profile so the bridge, the CLI and the MCP server
all read the same value. Without it the bridge accepts unauthenticated local
requests.

The token is a credential. It does not belong in this repo, in `.mcp.json`, or
in any committed file.

## Start the bridge

```bash
tb-bridge
tb health && tb stats
```

Run it only while you are using it. A long-lived local daemon with mailbox
access is a standing risk, so do not background it permanently via pm2 or
`nohup` on a machine that handles client work.

## MCP config

Claude Code reads `.mcp.json` at the repo root. Add this server entry alongside
the existing ones:

```json
"thunderbird": {
  "command": "npx",
  "args": ["-y", "thunderbird-cli-mcp"],
  "env": {
    "TB_BRIDGE_HOST": "127.0.0.1",
    "TB_BRIDGE_PORT": "7700",
    "TB_AUTH_TOKEN": "${TB_AUTH_TOKEN:-}"
  }
}
```

`${TB_AUTH_TOKEN:-}` resolves from your shell environment, which keeps the
credential out of git. The MCP server also inherits the parent environment, so
the `env` block mainly documents intent; if the server rejects an empty token
value when the variable is unset, drop the `TB_AUTH_TOKEN` line and rely on
inheritance alone.

Claude Desktop on macOS uses `~/Library/Application Support/Claude/claude_desktop_config.json`
with the same server entry under `mcpServers`. Desktop launched from the GUI does
not inherit a shell profile, so the token must be set in the `env` block there,
which means a plaintext credential in that file. Prefer Claude Code.

Environment variables the tooling reads:

| Variable | Default | Purpose |
|---|---|---|
| `TB_BRIDGE_HOST` | `127.0.0.1` | Bridge host |
| `TB_BRIDGE_PORT` | `7700` | Bridge HTTP port |
| `TB_AUTH_TOKEN` | none | Bearer token for bridge requests |

Config file alternative: `~/.config/thunderbird-cli/config.json`
(`host`, `httpPort`, `authToken`). The WebSocket port is 7701.

## The 12 MCP tools

Read: `email_stats`, `email_search`, `email_list`, `email_read`, `email_thread`,
`email_folders`, `email_attachments`

Write: `email_compose`, `email_reply`, `email_forward`, `email_mark`,
`email_archive`

Compose, reply and forward save drafts unless called with `mode: "send"`.
Permanent delete requires `confirm: true`. Search excludes junk and spam.

There is no read-only mode upstream. If you want a read-only trial period, the
only reliable control is a Claude Code deny rule on the five write tools.

## Known upstream issues to expect

| Issue | Effect |
|---|---|
| #28 | Timestamps returned in UTC, not local. Check London scheduling by hand. |
| #12 | Body search unreliable or times out on large mailboxes. |
| #29 | `tb reply --html` silently ignored, so replies go out plain text. |
| #23 | No attachment support on compose, reply or forward. |
| #15, #24 | Results truncated before sorting, so "latest 20" may not be the latest 20. |
| #30 | `email_compose` needs an identity ID that no MCP tool exposes. |

## Verification

```bash
tb health          # bridge reachable
tb stats           # unread counts per account
```

In a local Claude Code session in this repo, `/mcp` should list `thunderbird`
as connected.
