#!/bin/bash
# October Platform — pull latest and redeploy
set -e

SOURCE_DIR="/opt/october-source"
BACKEND_DIST="/opt/october-platform"
FRONTEND_DIST="/var/www/platform"

echo "==> Pulling latest from main..."
cd "$SOURCE_DIR"
git pull origin main

echo "==> Running migrations..."
cd "$SOURCE_DIR/platform/backend"
node migrations/run.js

echo "==> Syncing backend..."
rsync -a --exclude=node_modules --exclude=.env "$SOURCE_DIR/platform/backend/" "$BACKEND_DIST/"
cd "$BACKEND_DIST"
npm install --omit=dev --silent

echo "==> Rebuilding frontend..."
cd "$SOURCE_DIR/platform/frontend"
npm install --silent
npm run build

echo "==> Publishing frontend..."
rsync -a --delete "$SOURCE_DIR/platform/frontend/dist/" "$FRONTEND_DIST/"

echo "==> Restarting backend..."
pm2 restart october-platform

echo ""
echo "Done. $(date)"
pm2 list --no-color | grep october-platform
