#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# OC Mail — install onto an EXISTING server (not a fresh cloud-init box)
#
# Use this instead of deploy/cloud-init.sh when you are standing MailFlow up on a
# server that is ALREADY running something on ports 80/443 — e.g. the `email`
# box that currently serves Mautic. The difference from cloud-init.sh is the two
# things that make co-hosting safe:
#
#   * MailFlow's frontend is bound to LOCALHOST (127.0.0.1:8443 / :8080), so it
#     never fights the existing web server for the public 80/443 ports. A
#     host-level reverse proxy (see deploy/Caddyfile) terminates TLS and routes
#     mail.octobercomms.com -> this instance by hostname.
#   * It is re-run safe: if /opt/mailflow/.env already exists it is left
#     UNTOUCHED, so re-running never regenerates ENCRYPTION_KEY (which would make
#     already-stored email credentials unreadable).
#
# It contains NO secrets and NO account credentials — the three secrets are
# generated on the box the first time it runs; your email-account passwords are
# entered later inside the MailFlow web UI.
#
# Run as root:  MAIL_DOMAIN=mail.octobercomms.com bash install-existing.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

MAIL_DOMAIN="${MAIL_DOMAIN:-mail.octobercomms.com}"   # public hostname for OC Mail
APP_DIR="${APP_DIR:-/opt/mailflow}"
HTTPS_BIND="${HTTPS_BIND:-127.0.0.1:8443}"            # localhost-only :443 mapping
HTTP_BIND="${HTTP_BIND:-127.0.0.1:8080}"             # localhost-only :80  mapping

echo "==> OC Mail install onto existing server"
echo "    domain      : ${MAIL_DOMAIN}"
echo "    app dir     : ${APP_DIR}"
echo "    frontend    : https ${HTTPS_BIND} / http ${HTTP_BIND} (localhost only)"

# 1. Docker Engine + compose plugin (skip if already present)
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "==> Docker + compose already installed — skipping."
else
  echo "==> Installing Docker Engine + compose plugin..."
  curl -fsSL https://get.docker.com | sh
fi

# 2. Application directory
install -d -m 700 "${APP_DIR}"
cd "${APP_DIR}"

# 3. Prebuilt-image compose file (fetch only if missing)
if [ ! -f docker-compose.yml ]; then
  echo "==> Fetching MailFlow compose file..."
  curl -fsSL -o docker-compose.yml \
    https://raw.githubusercontent.com/maathimself/mailflow/main/docker-compose.ghcr.yml
else
  echo "==> docker-compose.yml already present — leaving it as-is."
fi

# 4. Environment file — created ONCE, then never overwritten
if [ ! -f .env ]; then
  echo "==> Creating .env (first run) — generating secrets on the box..."
  curl -fsSL -o .env https://raw.githubusercontent.com/maathimself/mailflow/main/.env.example

  # Public URL is the real hostname (Caddy terminates TLS in front of us).
  sed -i "s|^APP_URL=.*|APP_URL=https://${MAIL_DOMAIN}|" .env

  # Keep the frontend off the host's public 80/443 — bind to localhost only.
  # These keys feed the compose port mappings: "${APP_PORT:-443}:443" etc.
  if grep -q '^APP_PORT=' .env; then
    sed -i "s|^APP_PORT=.*|APP_PORT=${HTTPS_BIND}|" .env
  else
    printf 'APP_PORT=%s\n' "${HTTPS_BIND}" >> .env
  fi
  if grep -q '^APP_HTTP_PORT=' .env; then
    sed -i "s|^APP_HTTP_PORT=.*|APP_HTTP_PORT=${HTTP_BIND}|" .env
  else
    printf 'APP_HTTP_PORT=%s\n' "${HTTP_BIND}" >> .env
  fi

  # Secrets — generated here, never typed or pasted.
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=$(openssl rand -hex 16)|"       .env
  sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env
else
  echo "==> .env already exists — leaving it UNTOUCHED (preserving ENCRYPTION_KEY)."
fi

# 5. Launch. NOTE: no --profile https — we do NOT want MailFlow's bundled Caddy
#    grabbing the host's 80/443. TLS is handled by the host reverse proxy.
echo "==> Bringing the stack up..."
docker compose up -d

echo
echo "OC Mail is up on ${HTTPS_BIND} (localhost only)."
echo "Next: point a host reverse proxy at it — see deploy/Caddyfile — and add a"
echo "DNS A record for ${MAIL_DOMAIN} -> this server's public IP."
