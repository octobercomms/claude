#!/bin/bash
# October Platform — pull latest and redeploy
set -e

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

echo "==> Building WordPress plugin package..."
# The platform is the plugin's distribution point: it serves this zip to new
# installs and to the self-updater. Building it on deploy means a merge that
# bumps the plugin version rolls out to every paired site. Non-fatal — if 'zip'
# isn't installed the backend rebuilds it on demand instead.
mkdir -p "$SOURCE_DIR/dev/platform/backend/assets/plugin"
( cd "$SOURCE_DIR/dev/october-mi-wp" && bash bin/build-zip.sh "$SOURCE_DIR/dev/platform/backend/assets/plugin" ) \
  || echo "    (plugin package build skipped — ensure 'zip' is installed on the host)"

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

echo ""
echo "Done. $(date)"
pm2 list --no-color | grep october-platform
