#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# OC Mail — one-shot server bootstrap (Hetzner Cloud "Cloud config" / user data)
#
# Paste the entire contents of this file into the "Cloud config" field when
# creating a Hetzner Cloud server (Ubuntu 24.04). It runs once, as root, on
# first boot and stands up a stock MailFlow instance:
#
#   1. installs Docker + the compose plugin
#   2. downloads MailFlow's prebuilt-image compose file + env template
#   3. generates all three required secrets ON THE SERVER (never typed by hand)
#   4. points APP_URL at the server's own public IP
#   5. brings the stack up (Postgres + Redis + backend + nginx frontend)
#
# It contains NO secrets and NO account credentials. Secrets are generated here;
# your email-account passwords are entered later inside the MailFlow web UI.
#
# When it finishes (~2–3 min), browse to  https://<SERVER_IP>  (accept the
# self-signed certificate warning) and create your MailFlow login.
# ─────────────────────────────────────────────────────────────────────────────
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

# 1. Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh

# 2. Application directory
install -d -m 700 /opt/mailflow
cd /opt/mailflow

# 3. Prebuilt-image compose file + env template (from MailFlow upstream)
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/maathimself/mailflow/main/docker-compose.ghcr.yml
curl -fsSL -o .env               https://raw.githubusercontent.com/maathimself/mailflow/main/.env.example

# 4. Configure: public IP + freshly generated secrets
PUBLIC_IP="$(curl -fsS https://checkip.amazonaws.com 2>/dev/null || hostname -I | awk '{print $1}')"
sed -i "s|^APP_URL=.*|APP_URL=https://${PUBLIC_IP}|"                 .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=$(openssl rand -hex 16)|"       .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env

# 5. Launch (self-signed HTTPS on :443, HTTP on :80)
docker compose up -d

echo "OC Mail bootstrap complete — browse to https://${PUBLIC_IP}"
