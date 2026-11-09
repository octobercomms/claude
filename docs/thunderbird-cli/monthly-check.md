# Thunderbird CLI: monthly check

Five minutes, once a month. Two halves: update what is installed, then check the
project is still alive.

The second half matters as much as the first. Running the bridge continuously is
only reasonable while someone is patching it. A no-op update command looks the
same whether the project is healthy or abandoned.

Install and configuration: `walkthrough.md`. Reference: `setup.md`.

---

## Part 1: Update

```bash
npm update -g thunderbird-cli thunderbird-cli-bridge thunderbird-cli-mcp
npm list -g --depth=0 | grep thunderbird
```

**Restart the bridge.** Updating the package does not replace the copy already
running, so skipping this leaves the old code in memory:

```bash
launchctl kickstart -k gui/$(id -u)/com.thunderbird-cli.bridge
```

Without the LaunchAgent, `mail-off` then `mail-on` instead.

**Verify, both lines:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7700/health
tb health
```

Expect `401` from the first: auth still enforced after the restart. Expect
`"ok": true` from the second, and note the `version` it reports. That is the
**extension** version, not the npm one.

If `tb health` reports `EXTENSION_DISCONNECTED`, wait a few seconds and run it
again. The add-on reconnects on its own after a bridge restart.

---

## Part 2: Check the project is alive

Three pages, ten seconds each.

| Page | What you are looking for |
|---|---|
| [Releases](https://github.com/vitalio-sh/thunderbird-cli/releases) | A tag newer than the one you have |
| [Commits](https://github.com/vitalio-sh/thunderbird-cli/commits/main) | Date of the most recent commit |
| [Advisories](https://github.com/vitalio-sh/thunderbird-cli/security/advisories) | Anything published at all |

---

## What to do about what you find

**An advisory is published.** Stop the bridge now, before reading further:

```bash
mail-off
```

Leave it off until a release fixes it. Email access through Claude is worth less
than a known hole with a mailbox behind it.

**A new release exists.** `npm update` handles the CLI, bridge and MCP server.
It does **not** touch the Thunderbird add-on. Compare the extension version from
`tb health` against the version in the release assets. If they differ, download
the new `.xpi` and install it: Thunderbird, Tools, Add-ons and Themes, gear
icon, Install Add-on From File.

**Commits have stopped.** This is the judgement call, so here is the line:

- Under 6 months quiet: normal for a solo project. Carry on.
- Over 6 months quiet, with open issues untouched: treat it as unmaintained.
  Unmaintained code holding mailbox access is a different proposition from young
  code being actively fixed. Remove the LaunchAgent and go back to starting the
  bridge only when you use it:

```bash
launchctl bootout gui/$(id -u)/com.thunderbird-cli.bridge
rm ~/Library/LaunchAgents/com.thunderbird-cli.bridge.plist
```

**Nothing has changed.** Done. The command was a no-op and that is a fine
result.

---

## Reference point

Record what you are on, so next month compares against something:

| | Version | As of |
|---|---|---|
| npm packages | 1.1.0 | published 14 Sep 2026 |
| Extension | 2.1.0 | signed release, 14 Sep 2026 |
| Last commit | 14 Sep 2026 | checked 9 Nov 2026 |
| Advisories | none | checked 9 Nov 2026 |

At the November check the project had been quiet for eight weeks with ten open
issues. Normal at that length. Worth watching rather than acting on.

Update this table each month so the quiet period is measured rather than
guessed.
