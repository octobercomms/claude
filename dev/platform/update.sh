#!/bin/bash
# October Platform — pull latest and redeploy
set -e

# The whole deploy lives in main() for one reason: the `git reset --hard`
# below overwrites THIS FILE while bash is still reading it. Bash reads a
# script incrementally by byte offset, so inserting or removing lines shifts
# everything past the read head and the rest of the deploy runs from the wrong
# offsets — silently skipping whatever moved, or dying on half a word.
#
# Deploy 700 (31 Oct 2026) proved it: a new step that verifies puppeteer's
# browser never ran, the log jumping from "Installing backend dependencies"
# straight to "Building WordPress plugin package" a second later, so the fix
# for broken PDF generation could not take effect on the deploy that carried
# it. Reproduced outside the box too, where the corruption surfaced as
# `line 6: rt: command not found` — bash resuming mid-way through `export`.
#
# A function body must be parsed to its closing brace before any of it runs,
# so the entire script is in memory before the reset happens. The call and the
# exit share a line on purpose: as separate lines, bash reads the exit from
# the rewritten file at the stale offset and dies looking for a quote.
main() {

SOURCE_DIR="/opt/october-source"
FRONTEND_DIST="/var/www/platform"

echo "==> Syncing source to origin/main..."
cd "$SOURCE_DIR"
git fetch origin main
git reset --hard origin/main
echo "    HEAD is now: $(git log --oneline -1)"


echo "==> Running migrations..."
cd "$SOURCE_DIR/dev/platform/backend"
node migrations/run.js

echo "==> Installing backend dependencies..."
cd "$SOURCE_DIR/dev/platform/backend"
npm install --omit=dev --silent

# ─── puppeteer's browser ───────────────────────────────────────────────
# npm install runs puppeteer's postinstall, which downloads Chrome. That can
# fail — or finish half-written — while npm still exits 0, and --silent hides
# it. On 31 Oct 2026 a puppeteer 22 -> 25 bump did exactly that: the deploy
# reported success and every PDF (PR portal, overview, AI visibility, chat
# export) failed at runtime with "Could not find Chrome", because the version
# folder existed with no executable in it.
#
# The cause was extraction, not the download: puppeteer 22 bundled extract-zip
# (one of the advisories this upgrade cleared) and 25 dropped it, so it needs
# a system `unzip` or the optional `yauzl` package. `yauzl` is now a backend
# dependency, which fixes it in the repo rather than on one box — but a
# verified browser is still cheaper than a surprised account manager.
#
# Not fatal on failure: the backend is reloaded below and PDFs are one
# feature. A loud warning in the deploy log is the right weight.
echo "==> Checking puppeteer's browser..."
# executablePath() returns a PROMISE in puppeteer 25 (it was a string in 22),
# so this awaits it. Writing the sync value straight to stdout printed
# "[object Promise]" and reported every healthy box as broken.
CHROME_BIN="$(node -e "Promise.resolve(require('puppeteer').executablePath()).then(p=>process.stdout.write(String(p))).catch(()=>{})" 2>/dev/null || true)"
if [ -n "$CHROME_BIN" ] && [ -x "$CHROME_BIN" ]; then
  echo "    Chrome present: $CHROME_BIN"
else
  echo "    Chrome missing or incomplete — reinstalling."
  # A part-written download leaves its folder behind and blocks the retry, so
  # the cache is cleared first. Deliberately `browsers clear` rather than an
  # rm -rf of a derived path: `dirname` of an empty variable is ".", so a
  # constructed delete here can point at the working directory. Clearing the
  # whole browser cache costs one re-download of something already
  # re-downloadable, and cannot delete anything else.
  #
  # `yes |` because that command always asks "permanently and recursively
  # delete ... (yes/No)?" with no force flag, and a deploy has no TTY. Given
  # no answer it prints "Cancelled.", leaves the broken folder in place, and
  # the reinstall below fails exactly as before — a fix that quietly does
  # nothing. Measured both ways rather than assumed.
  yes | npx --yes puppeteer browsers clear >/dev/null 2>&1 || true
  npx --yes puppeteer browsers install chrome \
    && echo "    Chrome installed." \
    || echo "    WARNING: Chrome install failed — PDF generation will not work. Check 'df -h' and that yauzl installed."
fi

echo "==> Building WordPress plugin package..."
# The platform is the plugin's distribution point: it serves this zip to new
# installs and to the self-updater. Built in pure Node (no `zip` CLI needed) so
# a merge that bumps the plugin version rolls out to every paired site on
# deploy. Non-fatal — the backend also builds it on demand.
node -e "require('./src/services/wpPluginPackage').ensurePluginZip()" \
  || echo "    (plugin package prebuild skipped — backend will build it on first request)"

echo "==> Rebuilding frontend..."
cd "$SOURCE_DIR/dev/platform/frontend"
npm install --silent
npm run build

echo "==> Publishing frontend..."
rsync -a --delete "$SOURCE_DIR/dev/platform/frontend/dist/" "$FRONTEND_DIST/"
echo "    Published: $(ls "$FRONTEND_DIST"/assets/*.js 2>/dev/null | xargs -n1 basename | tr '\n' ' ')"

echo "==> Restarting backend..."
# --update-env so the latest ecosystem.config.js values (e.g. TZ) are
# picked up. Plain `pm2 restart` retains the original process env.
pm2 reload "$SOURCE_DIR/dev/platform/backend/ecosystem.config.js" --update-env \
  || pm2 restart october-platform --update-env

# ─── nginx config sync ─────────────────────────────────────────────
# update.sh historically rebuilt the frontend and reloaded pm2 but never
# touched nginx, so changes to dev/platform/nginx/platform.conf (new
# location blocks, headers, body limits) never reached the box on
# auto-deploy — they needed a manual copy + reload that was easy to
# forget. That's exactly how the /coverage-attachments proxy shipped in
# the repo yet rendered a blank screen in production. Sync it here so a
# merged nginx change deploys like everything else.
#
# Guarded so it's safe and never rolls back a good deploy:
#   - only acts when the repo file differs from what's on the box,
#   - validates with `nginx -t` BEFORE reloading,
#   - on a bad config, restores the previous file and warns (the pm2
#     restart above already succeeded; a typo in nginx must not abort it),
#   - uses sudo only if needed/available, degrading to a warning if the
#     deploy user can't write to /etc/nginx.
NGINX_SRC="$SOURCE_DIR/dev/platform/nginx/platform.conf"
NGINX_DST="/etc/nginx/sites-available/platform.octobercomms.com"
SUDO=""; [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
if [ -f "$NGINX_SRC" ] && ! $SUDO cmp -s "$NGINX_SRC" "$NGINX_DST" 2>/dev/null; then
  echo "==> nginx config changed — syncing and reloading..."
  $SUDO cp "$NGINX_DST" "$NGINX_DST.bak" 2>/dev/null || true
  if $SUDO cp "$NGINX_SRC" "$NGINX_DST" && $SUDO nginx -t; then
    $SUDO systemctl reload nginx && echo "    nginx reloaded." \
      || echo "    WARNING: nginx reload failed — check 'systemctl status nginx'."
  else
    echo "    WARNING: nginx -t failed — restoring previous config, NOT reloading."
    $SUDO cp "$NGINX_DST.bak" "$NGINX_DST" 2>/dev/null || true
  fi
else
  echo "==> nginx config unchanged — skipping reload."
fi

# ─── Shopify app (October MI on omi.octobercomms.com) ──────────────
# Skipped if the app's .env is missing (host not yet provisioned). Keeps
# this script safe to run on a partially-set-up box.
SHOPIFY_APP_DIR="$SOURCE_DIR/dev/october-mi-shopify"
if [ -f "$SHOPIFY_APP_DIR/.env" ]; then
  echo "==> Installing Shopify app dependencies (full, for build)..."
  cd "$SHOPIFY_APP_DIR"
  npm install --silent

  echo "==> Running Shopify app Prisma migrations..."
  npx --yes prisma generate >/dev/null
  npx --yes prisma migrate deploy

  echo "==> Building Shopify app (Remix)..."
  npm run build
  # Prune dev deps after build to keep the runtime install small.
  npm prune --omit=dev --silent

  echo "==> Restarting Shopify app..."
  pm2 reload "$SHOPIFY_APP_DIR/ecosystem.config.cjs" --update-env \
    || pm2 restart october-mi-shopify --update-env
else
  echo "==> Skipping Shopify app deploy (no .env at $SHOPIFY_APP_DIR/.env)"
fi

echo ""
echo "Done. $(date)"
pm2 list --no-color | grep -E "october-platform|october-mi-shopify"
}

main "$@"; exit $?
