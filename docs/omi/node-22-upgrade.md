# Node 22 on the box (and ffmpeg while you are there)

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

## ffmpeg 4.4 is the other old package, and it costs something today

`ffmpeg -version` on the box reports libavformat 58.76, which is ffmpeg 4.4 —
2021. It is not merely old:

**`-cues_to_front` does not exist before ffmpeg 6.0.** That flag moves a WebM's
seek index from the tail of the file to the front. `services/recordingRemux.js`
probes for it and falls back when it is missing, so nothing fails, but three
recordings in the library currently have their index at the tail:

| | |
|---|---|
| Adding Captions to Blog post images | 13464815 |
| Falcon Asset Bank | 1b82dce3 |
| Your Architect Tutorial | b7f3d0c4 |

A player has to fetch the end of the file before it can scrub one of those.
Measured on a 5-minute capture: index at byte 465 with the flag, at byte
16,329,148 without.

Every WebM recorded or imported from here on has the same limitation until
ffmpeg is newer, so this is not a backlog of three — it grows.

```bash
ffmpeg -version | head -1
ffmpeg -hide_banner -h muxer=webm | grep cues_to_front   # silent on 4.4
```

Ubuntu 22.04 ships 4.4; 24.04 ships 6.1. If the box is not being upgraded
wholesale, a static build dropped somewhere on PATH and pointed at by
`FFMPEG_PATH` in `.env` is enough — every ffmpeg call in the platform resolves
through that variable.

**After upgrading, redo the three:**

```bash
cd /opt/october-source/dev/platform/backend
node scripts/remux-backfill.js --commit --force
node scripts/media-store-status.js
```

`--force` is what redoes recordings that already have a playback copy. Without
it they are skipped as done, which they are, just not as well as they could be.

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

**The box runs two pm2 apps, not one.** List them before you touch anything,
because `pm2 kill` stops the daemon and therefore every app under it:

```bash
pm2 list
```

| App | Port | Serves | Code |
|-----|------|--------|------|
| `october-platform` | 3001 | platform.octobercomms.com | `dev/platform/backend` |
| `october-mi-shopify` | 3002 | omi.octobercomms.com | `dev/october-mi-shopify` |

If `pm2 list` shows anything else, add it to the restart block below before
you run it. A missing app comes back only when someone notices it is gone.

Both apps' `node_modules` were installed by Node 20. Reinstall rather than
trusting them:

```bash
cd /opt/october-source/dev/platform/backend
rm -rf node_modules
npm ci --omit=dev

cd /opt/october-source/dev/october-mi-shopify
rm -rf node_modules
npm ci                      # full install: the Remix build needs dev deps
npx --yes prisma generate
npm run build
npm prune --omit=dev
```

pm2 keeps running under the interpreter it was started with, so it needs more
than a reload. Start **both** apps back up:

```bash
pm2 kill
pm2 start /opt/october-source/dev/platform/backend/ecosystem.config.js
pm2 start /opt/october-source/dev/october-mi-shopify/ecosystem.config.cjs
pm2 save
pm2 info october-platform   | grep -i "node.js version"
pm2 info october-mi-shopify | grep -i "node.js version"
pm2 list                    # both online, 0 restarts
```

`pm2 kill` stops the daemon, so both sites are down for the few seconds
between those commands. Do it when nobody is watching a share link.

This cost us an outage on 31 October 2026: the runbook named only
`october-platform`, so `october-mi-shopify` stayed dead after the kill until
someone checked omi.octobercomms.com. `update.sh` restarts both; a manual
`pm2 kill` does not.

## Checking it worked

```bash
cd /opt/october-source/dev/platform/backend
node --version                              # v22.x
node scripts/media-store-status.js          # driver r2, everything present
node scripts/r2-preflight.js                # 7 of 7, and no SDK warning
pm2 logs october-platform --lines 40        # no startup errors
pm2 logs october-mi-shopify --lines 40      # no startup errors
curl -s -o /dev/null -w "%{http_code}\n" localhost:3002   # 200
```

Then open the platform, play a client video, and send a share link to
yourself. The preflight proves the SDK; only a real watch proves the route.

## If it goes wrong

The old Node is still installed under nvm (`nvm use 20.20.2`) or recoverable
from NodeSource's `setup_20.x`. The sequence is the same in reverse: switch
the interpreter, rebuild both apps' `node_modules`, `pm2 kill` and start both
again.

Nothing in this upgrade touches the database, `.env`, or R2. The only state
that changes is `node_modules`, which is rebuilt from `package-lock.json`
either way.
