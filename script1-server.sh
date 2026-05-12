#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  October Outreach — Setup (1 of 2)   ║"
echo "╚══════════════════════════════════════╝"

DB_NAME="october_outreach"
DB_USER="oo_user"
DB_PASS=$(openssl rand -base64 16 | tr -d '=/+' | head -c 20)
WP_ADMIN_USER="octobercomms"
WP_ADMIN_PASS=$(openssl rand -base64 12 | tr -d '=/+' | head -c 16)
WP_EMAIL="hello@octobercomms.com"
DOMAIN="outreach.octobercomms.com"
WEB_DIR="/var/www/outreach"

mkdir -p /root/.oo
echo "DB_PASS=$DB_PASS" > /root/.oo/creds
echo "WP_ADMIN_PASS=$WP_ADMIN_PASS" >> /root/.oo/creds
echo "WP_ADMIN_USER=$WP_ADMIN_USER" >> /root/.oo/creds
echo "WEB_DIR=$WEB_DIR" >> /root/.oo/creds

echo "[1/5] Updating system..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get upgrade -y -qq

echo "[2/5] Installing Nginx, PHP 8.3, MariaDB..."
apt-get install -y -qq nginx mariadb-server \
  php8.3-fpm php8.3-mysql php8.3-curl php8.3-xml \
  php8.3-mbstring php8.3-zip php8.3-gd php8.3-intl \
  unzip wget curl

echo "[3/5] Configuring database..."
mysql -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
mysql -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

echo "[4/5] Installing WordPress..."
mkdir -p "$WEB_DIR"
wget -q https://wordpress.org/latest.tar.gz -O /tmp/wp.tar.gz
tar -xzf /tmp/wp.tar.gz -C /tmp
cp -r /tmp/wordpress/. "$WEB_DIR/"
chown -R www-data:www-data "$WEB_DIR"
chmod -R 755 "$WEB_DIR"

wget -q https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar -O /usr/local/bin/wp
chmod +x /usr/local/bin/wp

cd "$WEB_DIR"
sudo -u www-data wp config create \
  --dbname="$DB_NAME" --dbuser="$DB_USER" --dbpass="$DB_PASS" \
  --dbhost=localhost --allow-root --quiet

sudo -u www-data wp core install \
  --url="http://$DOMAIN" \
  --title="October Outreach" \
  --admin_user="$WP_ADMIN_USER" \
  --admin_password="$WP_ADMIN_PASS" \
  --admin_email="$WP_EMAIL" \
  --allow-root --quiet

echo "[5/5] Configuring Nginx..."
cat > /etc/nginx/sites-available/outreach << 'NGINX'
server {
    listen 80 default_server;
    server_name _;
    root /var/www/outreach;
    index index.php index.html;
    client_max_body_size 64M;

    location / {
        try_files $uri $uri/ /index.php?$args;
    }
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php8.3-fpm.sock;
    }
    location ~ /\.ht { deny all; }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/outreach /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

ufw allow OpenSSH --quiet
ufw allow 'Nginx Full' --quiet
ufw --force enable --quiet

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  WordPress installed. Now run script 2.  ║"
echo "╠══════════════════════════════════════════╣"
echo "║  WP Admin:  http://195.201.149.223/wp-admin"
echo "║  Username:  $WP_ADMIN_USER"
echo "║  Password:  $WP_ADMIN_PASS"
echo "║  (also saved to /root/.oo/creds)"
echo "╚══════════════════════════════════════════╝"
