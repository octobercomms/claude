# Node 22 on the box

The platform box runs **Node 20.20.2**. The AWS SDK v3 — which every R2
operation goes through — prints this on every script run:

```
versions published after the first week of January 2027 will require node >=22
```

Nothing is broken. Nothing stops working on that date either: the SDK already
installed keeps running. What stops is *updates* — bug fixes and security
patches for the library that signs every playback URL. That is the reason to
do this, and the reason it is a scheduled job rather than an emergency.

**Deadline: early January 2027.** Written 31 Oct 2026.

## Why this is low risk

Each of these was checked rather than assumed, on 31 Oct 2026:

| | |
|---|---|
| CI already runs Node 22 | `.github/workflows/platform-checks.yml` pins `node-version: '22'`. Every PR for months has built the frontend and run the backend suite on 22. |
| Nothing compiles from source | No `binding.gyp` anywhere in `backend/node_modules`. A Node major bump breaks native addons that build against V8's ABI; there are none. |
| The one native binary is N-API | `@rspack/binding` (Remotion's bundler), a prebuilt `.node`. N-API is ABI-stable across Node majors by design. |
| The usual suspects are pure JS | `bcryptjs` and `pg` are JavaScript, not C++. These are the two that historically broke on a Node bump. |
| The whole backend suite passes on 22 | Run in the dev container, which is itself on v22.22.0. |

So the risk is not in the application. It is in the upgrade mechanics on the
box: pm2 holding a reference to the old binary, or `node_modules` built
against the old one.

## Doing it

Find out how Node was installed first, because that decides everything after:

```bash
which node && node --version
ls -d ~/.nvm 2>/dev/null && echo "nvm"
dpkg -l | grep -i nodejs && echo "apt / NodeSource"
```

### If nvm

```bash
nvm install 22
nvm alias default 22
node --version          # expect v22.x
```

### If apt / NodeSource

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
```

### Then, either way

`node_modules` was installed by Node 20. Reinstall rather than trusting it:

```bash
cd /opt/october-source/dev/platform/backend
rm -rf node_modules
npm ci --omit=dev
```

pm2 keeps running under the interpreter it was started with, so it needs more
than a reload:

```bash
pm2 kill
pm2 start /opt/october-source/dev/platform/backend/ecosystem.config.js
pm2 save
pm2 info october-platform | grep -i "node.js version"
```

`pm2 kill` stops the daemon, so the site is down for the few seconds between
those two commands. Do it when nobody is watching a share link.

## Checking it worked

```bash
cd /opt/october-source/dev/platform/backend
node --version                              # v22.x
node scripts/media-store-status.js          # driver r2, everything present
node scripts/r2-preflight.js                # 7 of 7, and no SDK warning
pm2 logs october-platform --lines 40        # no startup errors
```

Then open the platform, play a client video, and send a share link to
yourself. The preflight proves the SDK; only a real watch proves the route.

## If it goes wrong

The old Node is still installed under nvm (`nvm use 20.20.2`) or recoverable
from NodeSource's `setup_20.x`. The sequence is the same in reverse: switch
the interpreter, `rm -rf node_modules && npm ci --omit=dev`, `pm2 kill` and
start again.

Nothing in this upgrade touches the database, `.env`, or R2. The only state
that changes is `node_modules`, which is rebuilt from `package-lock.json`
either way.
