#!/bin/bash
# October Platform — VPS deploy script
# Run once on a fresh Ubuntu 22.04 Hetzner VPS

set -e

# Resolve paths from this script's own location so the deploy works wherever
# the repo is checked out (e.g. /opt/october-source/dev/platform), rather than
# a hard-coded path. This script lives in dev/platform, so SRC is that dir.
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== October Performance Marketing Platform — Deploy ==="
echo "Source: $SRC"

# 1. System packages
apt-get update -y
apt-get install -y curl wget git nginx certbot python3-certbot-nginx postgresql postgresql-contrib

# 2. Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 3. PM2
npm install -g pm2

# 4. PostgreSQL setup
sudo -u postgres psql <<SQL
CREATE USER octoberplatform WITH PASSWORD '${DB_PASSWORD:-changeme}';
CREATE DATABASE octoberplatform OWNER octoberplatform;
GRANT ALL PRIVILEGES ON DATABASE octoberplatform TO octoberplatform;
SQL

echo "PostgreSQL configured."

# 5. App directory
mkdir -p /opt/october-platform
cd /opt/october-platform

# 6. Copy backend
cp -r "$SRC/backend/"* .
npm install --production

# 7. Copy env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "WARNING: Copy .env.example to .env and fill in all values before starting!"
fi

# 8. Run migrations
node migrations/run.js

# 9. Build frontend
cd "$SRC/frontend"
npm install
npm run build
mkdir -p /var/www/platform
cp -r dist/* /var/www/platform/

# 10. Nginx config. Also remove a stray sites-enabled/platform.conf if present —
# an older setup left one alongside the symlink, which nginx loaded as a second
# server block for the same name (the "conflicting server name … ignored" warning)
# and could win with a smaller client_max_body_size, capping uploads.
cp "$SRC/nginx/platform.conf" /etc/nginx/sites-available/platform.octobercomms.com
rm -f /etc/nginx/sites-enabled/platform.conf
ln -sf /etc/nginx/sites-available/platform.octobercomms.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 11. SSL
certbot --nginx -d platform.octobercomms.com --non-interactive --agree-tos -m daniel@octobercomms.com

# 12. PM2 — launched via ecosystem.config.js so the process inherits
# TZ=Europe/London (otherwise scheduler.js crons fire an hour late
# during BST because the OS is in UTC).
cd /opt/october-platform
pm2 start ecosystem.config.js
pm2 startup
pm2 save

echo ""
echo "=== Deploy complete ==="
echo "Edit /opt/october-platform/.env with your credentials then: pm2 restart october-platform"
