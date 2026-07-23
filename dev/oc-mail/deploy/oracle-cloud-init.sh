#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# OC Mail — one-shot bootstrap for Oracle Cloud "Always Free" (Ampere A1, ARM)
#
# Paste this into the instance's cloud-init / user-data field
# (Create Instance → Advanced options → Management → "cloud-init script")
# when creating an Ubuntu A1 VM. It runs once, as root, on first boot.
#
# It differs from the Hetzner script in ONE important way: Oracle's Ubuntu
# images ship host-level iptables rules that DROP everything except SSH — so
# this opens TCP 80/443 in iptables. You must ALSO open 80/443 in the VCN
# Security List from the console (see docs/oc-mail/oracle-deploy.md §3);
# opening only one of the two leaves the app unreachable.
#
# Contains NO secrets and NO account credentials. Secrets are generated here;
# email-account passwords are entered later inside the MailFlow web UI.
# When done (~2–3 min), browse to  https://<PUBLIC_IP>  (accept the self-signed
# certificate) and create your MailFlow login.
# ─────────────────────────────────────────────────────────────────────────────
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

# 0. Open the host firewall (Oracle Ubuntu blocks non-SSH inbound by default)
iptables -I INPUT -p tcp --dport 80  -j ACCEPT
iptables -I INPUT -p tcp --dport 443 -j ACCEPT
netfilter-persistent save 2>/dev/null || {
  apt-get update && apt-get install -y iptables-persistent
  netfilter-persistent save
}

# 1. Docker Engine + compose plugin (works on arm64)
curl -fsSL https://get.docker.com | sh

# 2. Application directory
install -d -m 700 /opt/mailflow
cd /opt/mailflow

# 3. Prebuilt-image compose file + env template (images are multi-arch: amd64+arm64)
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
