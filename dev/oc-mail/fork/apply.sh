#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Build the October-branded MailFlow source tree from pinned upstream + our patch.
#
# Produces a ready-to-build checkout you can bring up with:
#   docker compose -f docker-compose.yml -f docker-compose.https.yml --profile https up -d --build
#
# This is the "works today" path — it does NOT require the octobercomms/mailflow
# fork to exist yet. It pins the exact upstream commit the patch was cut against,
# then applies october-branding-and-cross-account-move.patch on top (which carries
# the October theme, logomark, favicon, app icons, and the cross-account move
# feature — both text and binary changes).
#
# Once octobercomms/mailflow (the public fork, Option A) exists, push this same
# tree/patch to it and `git clone` that instead of running this script.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

UPSTREAM="https://github.com/maathimself/mailflow.git"
PIN="62ead1e1850246ba064bf10f1b66229c20db0eed"   # upstream commit the patch targets
DEST="${1:-mailflow-oct}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH="$HERE/october-branding-and-cross-account-move.patch"

if [ -e "$DEST" ]; then
  echo "Destination '$DEST' already exists — remove it or pass a different path." >&2
  exit 1
fi

echo "→ Cloning upstream MailFlow…"
git clone --quiet "$UPSTREAM" "$DEST"
cd "$DEST"
echo "→ Pinning to $PIN…"
git checkout -q "$PIN"
echo "→ Applying the October patch…"
git apply --index "$PATCH"

cat <<EOF

✅ October-branded MailFlow ready in: $DEST
   (upstream ${PIN:0:10} + October branding & cross-account move)

Next:
  cd $DEST
  cp .env.example .env          # set DOMAIN, ACME_EMAIL, APP_URL + generate secrets
  docker compose -f docker-compose.yml -f docker-compose.https.yml --profile https up -d --build

See docs/oc-mail/fork-build.md for the full deploy runbook.
EOF
