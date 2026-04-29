#!/usr/bin/env bash
# Builds a distributable architourian-pdf.zip
# Run from the plugin directory: bash build.sh

set -e
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_NAME="architourian-pdf"
DIST="$PLUGIN_DIR/../$PLUGIN_NAME.zip"

echo "→ Installing dependencies..."
cd "$PLUGIN_DIR"
composer install --no-dev --optimize-autoloader

echo "→ Building zip: $DIST"
cd "$(dirname "$PLUGIN_DIR")"
zip -r "$DIST" "$PLUGIN_NAME" \
  --exclude "$PLUGIN_NAME/.git*" \
  --exclude "$PLUGIN_NAME/build.sh" \
  --exclude "$PLUGIN_NAME/composer.lock" \
  --exclude "*.DS_Store"

echo "✓ Done: $DIST"
