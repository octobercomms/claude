# Thunderbird + Claude: step by step (macOS)

Follow these in order. Every step tells you what to type, what you should see,
and what to do if you see something else.

Total time: about 20 minutes. You will use Terminal. Nothing here touches your
email passwords.

For the condensed reference version, see `setup.md` in this folder.

---

## What you are building

Four pieces, which matters only when something breaks:

1. **An add-on inside Thunderbird.** Reads your mail using Thunderbird's own
   internals.
2. **A bridge.** A small program on your Mac that the add-on talks to. It runs
   in a Terminal window while you use it.
3. **Thunderbird itself.** Stays open. It holds your passwords, and no other
   piece sees them.
4. **Claude.** Talks to the bridge, so it sees whatever Thunderbird sees.

Nothing leaves your Mac except the parts of an email Claude reads to answer you.

**Opening Terminal:** press Cmd+Space, type `Terminal`, press Enter. A window
with a text prompt appears. You type a line, press Enter, and it does the thing.

---

## Step 1: Check you have Node

In Terminal, type this and press Enter:

```bash
node --version
```

**You should see** a version number starting with `v18`, `v20` or higher, for
example `v20.11.0`.

**If you see "command not found"** you need Node first. Easiest route:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node
```

The first line installs Homebrew, a package manager, and takes a few minutes.
It will ask for your Mac password. Type it (the characters will not appear, that
is normal) and press Enter. Then run `node --version` again.

**If you see v16 or lower**, run `brew upgrade node`.

---

## Step 2: Check your Thunderbird version

Thunderbird → menu bar → Thunderbird → About Thunderbird.

**You need 128 or higher.** If the number is lower, update Thunderbird before
going further, otherwise the add-on will refuse to install.

---

## Step 3: Install the three packages

```bash
npm install -g thunderbird-cli thunderbird-cli-bridge thunderbird-cli-mcp
```

**You should see** a few lines ending with something like
`added 3 packages in 4s`.

**If you see an EACCES permission error**, run it again with `sudo` in front and
enter your Mac password:

```bash
sudo npm install -g thunderbird-cli thunderbird-cli-bridge thunderbird-cli-mcp
```

Confirm the version you got:

```bash
npm list -g --depth=0 | grep thunderbird
```

**You should see** `thunderbird-cli@1.1.0` or higher on each line.

**If you see 1.0.x**, stop. Those versions have a security hole described in
`setup.md`. Run `npm install -g thunderbird-cli@latest thunderbird-cli-bridge@latest thunderbird-cli-mcp@latest`
and check again.

---

## Step 4: Make a security token

This is a long random password that stops anything else on your Mac, or any
website you visit, from talking to the bridge and reading your mail. The bridge
and Claude both need the same one.

Generate it and save it to your shell profile in one go:

```bash
echo "export TB_AUTH_TOKEN=\"$(openssl rand -hex 32)\"" >> ~/.zshrc
source ~/.zshrc
```

Now print it, because you will need to paste it into the Claude Desktop config
later:

```bash
echo $TB_AUTH_TOKEN
```

**You should see** 64 characters of letters and numbers. Copy it somewhere
temporarily, your password manager rather than a note.

**If nothing prints**, the `source` line did not take. Close Terminal, open a
new window, and run `echo $TB_AUTH_TOKEN` again.

Treat this string like a password. It does not go in any file inside this repo,
and it does not go in a Slack message or an email.

---

## Step 5: Install the Thunderbird add-on

1. Go to https://github.com/vitalio-sh/thunderbird-cli/releases
2. Under the release marked **Latest** (v1.1.0), click to expand **Assets**.
3. Download **`thunderbird_ai_bridge-2.1.0-tb.xpi`** (about 9 KB). Your browser
   may warn about the file type. Keep it.
4. In Thunderbird: menu bar → Tools → Add-ons and Themes.
5. Click the **gear icon** near the top right, then
   **Install Add-on From File…**
6. Pick the `.xpi` file you downloaded, usually in your Downloads folder.
7. Thunderbird will ask for permission. Read what it asks for, then click **Add**.

**You should see** the add-on listed under Extensions, enabled.

**If Thunderbird refuses it as unverified or corrupt**, do not force it. The
same release also carries `thunderbird-cli-2.1.0.xpi`; try that one. If both
fail, stop and tell me, because that points at a signing problem upstream rather
than anything you did wrong.

---

## Step 6: Start the bridge and test it

Leave Thunderbird open. In Terminal:

```bash
tb-bridge
```

**You should see** a few startup lines mentioning `127.0.0.1`, port `7700` and
port `7701`, then it sits there doing nothing. That is correct. **Leave this
window open.** The bridge only runs while this window runs.

**If you see "port in use"**, the bridge is already running in another window.
Find it, or close the other one.

Now open a **second** Terminal window (Cmd+N) and test:

```bash
tb health
```

**You should see** JSON with a status of ok or healthy.

```bash
tb stats
```

**You should see** your accounts and unread counts. **This is the moment it
either works or it does not.** If you see your real inboxes listed, the hard
part is done.

**If `tb health` says connection refused**, the bridge window is not running.
Go back and start it.

**If it returns 401 Unauthorized**, the token does not match. Close both Terminal
windows, open a new one, and start again from `tb-bridge`. Both windows need to
have read the same `~/.zshrc`.

**If `tb stats` works but shows no accounts**, the add-on is not installed or not
enabled. Check Step 5.

---

## Step 7a: Wire up Claude Code (terminal)

Open `.mcp.json` at the root of this repo in a text editor. Find the `shadcn`
block. Add a comma after its closing brace, then paste the `thunderbird` block
so the file reads like this:

```json
{
  "mcpServers": {
    "magic": {
      "command": "npx",
      "args": ["-y", "@21st-dev/magic@latest"],
      "env": {
        "API_KEY": "..."
      }
    },
    "shadcn": {
      "command": "npx",
      "args": ["-y", "shadcn@latest", "mcp"]
    },
    "thunderbird": {
      "command": "npx",
      "args": ["-y", "thunderbird-cli-mcp"],
      "env": {
        "TB_BRIDGE_HOST": "127.0.0.1",
        "TB_BRIDGE_PORT": "7700",
        "TB_AUTH_TOKEN": "${TB_AUTH_TOKEN:-}"
      }
    }
  }
}
```

Note what is **not** there: the token itself. `${TB_AUTH_TOKEN:-}` means "read it
from the shell", which keeps it out of git.

Check you have not broken the file:

```bash
python3 -c "import json;json.load(open('.mcp.json'));print('valid')"
```

**You should see** `valid`. If you see a JSON error, you have a misplaced comma
or brace. The commas go *between* blocks, never after the last one.

Then start Claude Code from this repo folder:

```bash
cd /path/to/your/claude/repo
claude
```

Type `/mcp` and press Enter.

**You should see** `thunderbird` in the list, marked connected.

---

## Step 7b: Wire up Claude Desktop

Desktop does not read your shell profile, so the token has to sit in the config
file as plain text. That is a real downside. Anything that reads your home
folder will find it.

Open the config file:

```bash
open -a TextEdit ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**If the file does not exist**, create it:

```bash
mkdir -p ~/Library/Application\ Support/Claude
touch ~/Library/Application\ Support/Claude/claude_desktop_config.json
open -a TextEdit ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

If the file is empty, paste this whole thing. If it already has an `mcpServers`
section, add only the `thunderbird` block inside it.

```json
{
  "mcpServers": {
    "thunderbird": {
      "command": "npx",
      "args": ["-y", "thunderbird-cli-mcp"],
      "env": {
        "TB_BRIDGE_HOST": "127.0.0.1",
        "TB_BRIDGE_PORT": "7700",
        "TB_AUTH_TOKEN": "PASTE_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

Replace `PASTE_YOUR_TOKEN_HERE` with the 64-character string from Step 4. Keep
the quote marks around it. Save and close.

Lock the file down so other accounts on the Mac cannot read it:

```bash
chmod 600 ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**Quit Claude Desktop fully** (Cmd+Q, not the red close button) and reopen it.

**You should see** a tools or connectors indicator showing Thunderbird
available. Ask it "how many unread emails do I have?" as a test.

---

## Step 8: Confirm it works end to end

With the bridge window running and Thunderbird open, ask Claude:

> How many unread emails do I have, and what are the five most recent subject lines?

**You should get** real numbers and real subjects.

**If Claude says it has no email tools**, the config did not load. Fully quit and
reopen the app. For Claude Code, check `/mcp`.

**If Claude says the bridge is unreachable**, your `tb-bridge` window has closed.

---

## Daily use

**Starting up:** open Thunderbird, open Terminal, run `tb-bridge`, leave it.

**Shutting down:** click the bridge window and press Ctrl+C. Email access stops
immediately.

Run it only while you are using it. A program with permanent access to every
client mailbox, sitting there for weeks, is a risk worth avoiding for the sake
of one Terminal command.

To save typing, add a shortcut:

```bash
echo 'alias mail-on="tb-bridge"' >> ~/.zshrc
source ~/.zshrc
```

Then `mail-on` starts it.

---

## Optional: read-only for the first fortnight

Sensible while you work out whether this earns its place. Add this to
`.claude/settings.json` in the repo:

```json
{
  "permissions": {
    "deny": [
      "mcp__thunderbird__email_compose",
      "mcp__thunderbird__email_reply",
      "mcp__thunderbird__email_forward",
      "mcp__thunderbird__email_mark",
      "mcp__thunderbird__email_archive"
    ]
  }
}
```

Claude will then search and read but write nothing. Delete the block when you
are ready. Note this covers Claude Code only; Desktop permissions are managed in
the app.

Even without it, compose and reply save **drafts**. Nothing sends unless Claude
is explicitly told to send.

---

## When something breaks

| What you see | What it means | Fix |
|---|---|---|
| `command not found: tb` | Packages not installed, or npm's folder is not on your path | Redo Step 3 |
| `connection refused` | Bridge is not running | Run `tb-bridge` |
| `401 Unauthorized` | Token mismatch between bridge and Claude | New Terminal window, restart bridge; check Desktop config has the right token |
| `port in use` | Bridge already running elsewhere | Find the other window, or Ctrl+C it |
| `tb stats` shows no accounts | Add-on missing or disabled | Check Thunderbird → Add-ons |
| Claude has no email tools | Config not loaded | Fully quit and reopen the app |
| Times look an hour or two out | Known upstream bug, timestamps come back as UTC | Adjust by hand; do not trust it for scheduling |
| Body search hangs or returns nothing | Known upstream bug on large mailboxes | Search by sender, subject or date instead |
| Replies arrive as plain text | Known upstream bug, HTML flag ignored | Send formatted replies from Thunderbird yourself |

The last three are faults in the tool, not in your setup. They are logged
upstream as issues 28, 12 and 29.

---

## What this is worth being careful about

The tool is one maintainer's project, a few months old, with 62 stars. Versions
before 1.1.0 shipped a bridge that any website you visited was able to reach and
read your mail through. That is fixed, and the maintainer found and fixed it
himself, which counts for something. It still tells you the security model came
second.

So: latest version only, token always set, bridge running only when in use, and
drafts rather than direct send. Those four habits carry nearly all the risk.
