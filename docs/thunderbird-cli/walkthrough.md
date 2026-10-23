# Thunderbird + Claude: step by step (macOS)

Follow these in order. Every step tells you what to type, what you should see,
and what to do if you see something else.

Total time: about 20 minutes. You will use Terminal. Nothing here touches your
email passwords.

Verified end to end on macOS with Thunderbird 158, Node 24 and bash, against a
14-account setup. The notes marked **In practice** record what actually happened
rather than what the upstream README claims.

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

```bash
node --version
```

**You should see** a version number starting with `v18` or higher.

**If you see "command not found"** you need Node first:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node
```

The first line installs Homebrew and takes a few minutes. It will ask for your
Mac password. Type it (the characters will not appear, that is normal) and press
Enter. Then run `node --version` again.

---

## Step 2: Check your Thunderbird version

Thunderbird → menu bar → Thunderbird → About Thunderbird.

**You need 128 or higher.** Below that, the add-on will refuse to install.

---

## Step 3: Install the three packages

```bash
npm install -g thunderbird-cli thunderbird-cli-bridge thunderbird-cli-mcp
```

**You should see** something like `added 100 packages in 3s`. The count is high
because of dependencies; three packages plus what they pull in.

**If you see an EACCES permission error**, run it again with `sudo` in front.

Confirm what you got:

```bash
npm list -g --depth=0 | grep thunderbird
```

**You should see** `1.1.0` or higher on all three lines.

**If you see 1.0.x**, stop. Those versions have the security hole described at
the bottom of this page. Run
`npm install -g thunderbird-cli@latest thunderbird-cli-bridge@latest thunderbird-cli-mcp@latest`
and check again.

---

## Step 4: Make a security token

This is a long random password that stops anything else on your Mac, and any
website you visit, from talking to the bridge and reading your mail.

**First find out which shell you use.** macOS defaults to zsh, but accounts
created before Catalina often still run bash, and the two read different startup
files. Writing to the wrong one means the token silently never loads.

```bash
echo $SHELL
```

This command writes to whichever file is actually yours:

```bash
PROFILE="$HOME/.zshrc"
[ "$(basename "$SHELL")" = "bash" ] && PROFILE="$HOME/.bash_profile"
echo "export TB_AUTH_TOKEN=\"$(openssl rand -hex 32)\"" >> "$PROFILE"
source "$PROFILE"
echo "written to: $PROFILE"
echo "token is ${#TB_AUTH_TOKEN} characters"
```

**You should see** the profile path and `token is 64 characters`.

**If it says 0 characters**, the `source` did not take. Close Terminal, open a
new window, and run `echo ${#TB_AUTH_TOKEN}` again.

Treat this string like a password. It does not go in any file inside this repo,
in a chat window, in Slack, or in an email. To read it later when you genuinely
need the value, use `echo $TB_AUTH_TOKEN`.

**If you have already exposed it**, replacing it costs nothing as long as the
bridge has not started:

```bash
sed -i '' '/TB_AUTH_TOKEN/d' "$PROFILE"
echo "export TB_AUTH_TOKEN=\"$(openssl rand -hex 32)\"" >> "$PROFILE"
source "$PROFILE"
```

---

## Step 5: Install the Thunderbird add-on

1. Go to https://github.com/vitalio-sh/thunderbird-cli/releases
2. Under the release marked **Latest**, expand **Assets**
3. Download **`thunderbird_ai_bridge-2.1.0-tb.xpi`** (about 9 KB). Your browser
   may warn about the file type. Keep it.
4. Thunderbird → menu bar → **Tools** → **Add-ons and Themes**
5. **Gear icon** near the top right → **Install Add-on From File…**
6. Pick the `.xpi` from your Downloads folder
7. Read the permissions it asks for, then **Add**

**You should see** "Thunderbird AI Bridge" under Extensions with its toggle
switched on.

**If Thunderbird refuses it as unverified or corrupt**, do not force it. The same
release carries `thunderbird-cli-2.1.0.xpi`; try that. If both fail, that points
at a signing problem upstream rather than anything you did.

---

## Step 6: Start the bridge and test it

Leave Thunderbird open.

```bash
tb-bridge
```

**You should see** startup lines mentioning `127.0.0.1`, port `7700` and port
`7701`, then it sits there doing nothing. That is correct. **Leave this window
open.** The bridge only runs while this window runs.

**If you see "port in use"**, the bridge is already running in another window.

Open a **second** Terminal window (Cmd+N):

```bash
tb health
```

**You should see** `"ok": true` with a version and `"thunderbird": true`.

```bash
tb stats
```

**You should see** your accounts with unread and message counts. **This is the
moment it either works or it does not.**

**If `tb health` says connection refused**, the bridge window is not running.

**If it returns 401**, the two windows are not reading the same token. Close
both, open a new one, start again from `tb-bridge`.

**If `tb stats` works but shows no accounts**, the add-on is not installed or
not enabled.

**In practice:** let Thunderbird finish syncing before trusting any counts. Its
status bar shows progress, and mid-sync numbers move under you.

---

## Step 7: Verify the bridge is actually enforcing the token

`tb health` succeeding does not prove authentication is on. This matters: a
bridge running without auth gives anything on your Mac unrestricted access to
every mailbox. Versions before 1.1.0 shipped exactly that.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7700/health
```

That calls the bridge directly with no token attached.

- **`401`** is correct. Auth is on.
- **`200`** means the bridge is open to anything. Ctrl+C it immediately and
  check that `TB_AUTH_TOKEN` was set in the shell you started it from.

Do not skip this step.

---

## Step 8a: Wire up Claude Code (terminal)

Use the CLI rather than editing JSON by hand:

```bash
claude mcp add thunderbird -s user \
  -e TB_BRIDGE_HOST=127.0.0.1 \
  -e TB_BRIDGE_PORT=7700 \
  -- npx -y thunderbird-cli-mcp
```

**You should see** `Added stdio MCP server thunderbird ... to user config`.

`-s user` makes it available in every Claude Code session rather than one
project folder, which suits email since mail is not project-specific.

Note what is absent: the token. The MCP subprocess inherits `TB_AUTH_TOKEN` from
your shell, so it never reaches a config file.

Check it:

```bash
claude
```

Type `/mcp`. **You should see** `thunderbird · connected · 12 tools`.

**If it connects but tool calls return 401**, the token did not inherit. This
fallback works but writes the credential into `~/.claude.json`:

```bash
claude mcp remove thunderbird -s user
claude mcp add thunderbird -s user \
  -e TB_BRIDGE_HOST=127.0.0.1 \
  -e TB_BRIDGE_PORT=7700 \
  -e TB_AUTH_TOKEN="$TB_AUTH_TOKEN" \
  -- npx -y thunderbird-cli-mcp
```

Try the inheriting version first.

---

## Step 8b: Wire up Claude Desktop

Desktop does not read your shell profile, so the token has to sit in the config
file as plain text. That is a real downside. Anything that reads your home
folder will find it.

**Do not paste a config block over this file.** It holds your app preferences
as well, and overwriting loses them. Back it up and let a script insert the key:

```bash
cp ~/Library/Application\ Support/Claude/claude_desktop_config.json \
   ~/Desktop/claude_config_backup.json 2>/dev/null

python3 - <<'EOF'
import json, os
p = os.path.expanduser("~/Library/Application Support/Claude/claude_desktop_config.json")
try:
    d = json.load(open(p))
except (FileNotFoundError, ValueError):
    d = {}
d.setdefault("mcpServers", {})["thunderbird"] = {
    "command": "npx",
    "args": ["-y", "thunderbird-cli-mcp"],
    "env": {
        "TB_BRIDGE_HOST": "127.0.0.1",
        "TB_BRIDGE_PORT": "7700",
        "TB_AUTH_TOKEN": os.environ["TB_AUTH_TOKEN"],
    },
}
os.makedirs(os.path.dirname(p), exist_ok=True)
json.dump(d, open(p, "w"), indent=2)
print("ok, mcpServers now has:", list(d["mcpServers"]))
EOF

chmod 600 ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

It reads the token from your shell, so you never type it. **You should see**
`ok, mcpServers now has: ['thunderbird']`, and a backup on your Desktop.

**Quit Claude Desktop fully** with Cmd+Q, not the red close button, then reopen.
The close button leaves it running and it will not reload the config.

---

## Step 9: Confirm it works end to end

With the bridge running and Thunderbird open, ask Claude:

> Using the thunderbird tools, how many unread emails are in <one small account>,
> and list the 5 most recent subject lines from its inbox.

Scope the first test to a **small** account. On a large one, the truncation bug
below muddies the result and you will not know whether the fault is your setup.

**You should get** real senders, subjects and dates.

---

## Daily use

Three pieces are involved, and only one of them needs your attention:

| Piece | Starts how | Survives reboot |
|---|---|---|
| Thunderbird add-on | With Thunderbird | Yes |
| MCP server | Claude launches it | Yes, nothing to do |
| **Bridge** | You start it | **No. This is the one** |

When the bridge is down, Claude still lists the Thunderbird tools and then
fails the moment you ask it something. Tools present, answers absent.

### Option A: start it at login (recommended)

Write the startup file. Python builds the plist, so it is valid by
construction and the command survives pasting as one line:

```bash
python3 -c "import os,plistlib; p=os.path.expanduser('~/Library/LaunchAgents/com.thunderbird-cli.bridge.plist'); os.makedirs(os.path.dirname(p),exist_ok=True); plistlib.dump({'Label':'com.thunderbird-cli.bridge','ProgramArguments':['/bin/bash','-lc','exec tb-bridge'],'RunAtLoad':True,'KeepAlive':False,'StandardOutPath':'/tmp/tb-bridge.log','StandardErrorPath':'/tmp/tb-bridge.err'},open(p,'wb')); print('written:',p)"
```

Stop any bridge already running, or the next step hits "port in use":

```bash
pkill -f tb-bridge
```

Hand it to macOS:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.thunderbird-cli.bridge.plist
```

It runs through `bash -lc`, so it reads your shell profile and picks up the
token. No second copy of the credential.

`KeepAlive` is false on purpose: the bridge starts at login, and stopping it by
hand keeps it stopped until you next log in. You keep an off switch.

**Expect one transient failure.** Right after the swap, `tb health` returns
`EXTENSION_DISCONNECTED`. The add-on held a WebSocket to the bridge you killed
and needs to find the new one. It reconnects within a few seconds on its own;
run `tb health` again. If it stays disconnected, restart Thunderbird. This
happens only when replacing a running bridge. On a normal login both start
fresh and find each other.

**Then re-run the Step 7 check**, because the startup path has changed from
your shell to launchd and the token has to survive that:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7700/health
```

`401` means the token loaded through `bash -lc`. `200` means launchd started
the bridge with no auth, which is worth knowing immediately.

To undo:

```bash
launchctl bootout gui/$(id -u)/com.thunderbird-cli.bridge
rm ~/Library/LaunchAgents/com.thunderbird-cli.bridge.plist
```

### Option B: start it by hand

Using whichever profile Step 4 reported:

```bash
echo 'alias mail-on="nohup tb-bridge > ~/.tb-bridge.log 2>&1 & echo bridge started"' >> "$PROFILE"
echo 'alias mail-off="pkill -f tb-bridge && echo bridge stopped"' >> "$PROFILE"
echo 'alias mail-status="pgrep -f tb-bridge >/dev/null && echo running || echo stopped"' >> "$PROFILE"
source "$PROFILE"
```

`mail-on` after each reboot, then close Terminal freely. These aliases work
alongside Option A: `mail-off` and `mail-status` apply either way.

### Keeping it current

The case for leaving the bridge running rests on being on a patched version, so
this is the part that matters:

```bash
npm update -g thunderbird-cli thunderbird-cli-bridge thunderbird-cli-mcp
```

Monthly, in your calendar rather than your memory. Also click **Watch** on the
GitHub repo. If a vulnerability is disclosed, stop the bridge that day.

---

## Optional: read-only for the first fortnight

Sensible while you work out whether this earns its place. In
`~/.claude/settings.json`:

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

Claude will then search and read but write nothing. This covers Claude Code
only; Desktop permissions are managed in the app.

Even without it, compose and reply save **drafts**. Nothing sends unless Claude
is explicitly told to send.

---

## Two different 401s

Easy to confuse, and they mean opposite things.

| Token | Authenticates | Lives in | Symptom |
|---|---|---|---|
| `TB_AUTH_TOKEN` | Claude to your local bridge | your shell profile | `tb` commands return 401; MCP tool calls fail |
| Claude OAuth | You to Anthropic | managed by the app | "Please run /login · OAuth access token has been revoked" |

A `/login` message is the second one. Your Thunderbird setup is unaffected; run
`/login` and carry on.

---

## When something breaks

| What you see | What it means | Fix |
|---|---|---|
| `command not found: tb` | Packages not installed, or npm's folder is not on your path | Redo Step 3 |
| `connection refused` | Bridge is not running | Run `tb-bridge` |
| `401` from `tb` | Token mismatch between bridge and client | New Terminal window, restart bridge |
| `200` from the Step 7 curl | Bridge running with no auth | Ctrl+C now; check `TB_AUTH_TOKEN` is set |
| "Please run /login" | Claude's own auth, not the bridge | `/login` |
| `port in use` | Bridge already running elsewhere | Find the other window |
| `tb stats` shows no accounts | Add-on missing or disabled | Check Thunderbird → Add-ons |
| Token prints as 0 characters | Written to the wrong shell profile | Redo Step 4, check `echo $SHELL` |
| Times look an hour or two out | Upstream bug, timestamps come back as UTC | Adjust by hand; do not trust for scheduling |
| Body search hangs or returns nothing | Upstream bug on large mailboxes | Search by sender, subject or date instead |
| Replies arrive as plain text | Upstream bug, HTML flag ignored | Send formatted replies from Thunderbird |

The last three are faults in the tool, not your setup. Logged upstream as issues
28, 12 and 29.

---

## At large scale

On mailboxes in the hundreds of thousands of messages, two upstream bugs stop
being academic:

- **Body search** (#12) times out. Search by sender, subject or date range, and
  always scope to one account.
- **Truncation before sorting** (#15, #24) means "the latest 20" may not be the
  latest 20. Verify anything time-sensitive in Thunderbird itself.

Also worth knowing: `tb stats` reports unread **per account across all folders**,
not per inbox. A four-figure unread count usually includes archive and junk
folders. Ask for the inbox specifically when that is what you mean.

---

## What this is worth being careful about

The tool is one maintainer's project, a few months old, with 62 stars. Versions
before 1.1.0 shipped a bridge that any website you visited was able to reach and
read your mail through. That is fixed, and the maintainer found and fixed it
himself, which counts for something. It still tells you the security model came
second.

What that leaves, once the setup above is done:

**Already handled.** The bridge binds to 127.0.0.1, so nothing on your network
reaches it. Auth is enforced, which Step 7 proves rather than assumes. The
browser attack classes that made the old versions dangerous are patched.

**Not a strong argument.** "A local process might steal the token." Any process
running as you already reads the Thunderbird profile directory and the Claude
Desktop config. The bridge adds little to an attacker who is that far in, so
uptime is not the lever it first appears to be.

**The live one.** Young code from a single maintainer, with one serious flaw
found five weeks before this was written. Unknown bugs are plausible, and a
patched version is what the rest of this rests on.

So the controls that carry the risk, in order:

1. Stay on the current version. Monthly `npm update`, in a calendar.
2. Watch the repo, and stop the bridge the day anything is disclosed.
3. Verify Step 7 again after any update.
4. Keep drafts rather than direct send.

Running the bridge continuously is a reasonable call once those four hold.
Running an outdated copy of it is not, whether it is up for an hour a week or
all month.
