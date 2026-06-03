#!/bin/bash
# October Platform — VPS deploy script
# Run once on a fresh Ubuntu 22.04 Hetzner VPS

set -e

echo "=== October Performance Marketing Platform — Deploy ==="

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
cp -r /home/user/claude/platform/backend/* .
npm install --production

# 7. Copy env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "WARNING: Copy .env.example to .env and fill in all values before starting!"
fi

# 8. Run migrations
node migrations/run.js

# 9. Build frontend
cd /home/user/claude/platform/frontend
npm install
npm run build
mkdir -p /var/www/platform
cp -r dist/* /var/www/platform/

# 10. Nginx config
cp /home/user/claude/platform/nginx/platform.conf /etc/nginx/sites-available/platform.octobercomms.com
ln -sf /etc/nginx/sites-available/platform.octobercomms.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 11. SSL
certbot --nginx -d platform.octobercomms.com --non-interactive --agree-tos -m daniel@octobercomms.com

# 12. PM2
cd /opt/october-platform
pm2 start src/index.js --name october-platform
pm2 startup
pm2 save

echo ""
echo "=== Deploy complete ==="
echo "Edit /opt/october-platform/.env with your credentials then: pm2 restart october-platform"
