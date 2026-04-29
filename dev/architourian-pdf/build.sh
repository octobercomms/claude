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

# Delete old zip so we always build fresh (zip -r updates in place otherwise)
rm -f "$DIST"

# Prune all mPDF fonts except FreeMono ('courier') and DejaVu (mPDF fallback).
# The full font set is 87MB — remove them before zipping, restore via composer after.
TTFONTS="$PLUGIN_DIR/vendor/mpdf/mpdf/ttfonts"
KEEP_PATTERN="^(DejaVu|FreeMono|FreeMonoBold|FreeMonoBoldOblique|FreeMonoOblique|FreeSans|FreeSansBold|FreeSansBoldOblique|FreeSansOblique|FreeSerif|FreeSerifBold|FreeSerifBoldItalic|FreeSerifItalic)"
find "$TTFONTS" -maxdepth 1 -name "*.ttf" -o -name "*.otf" | while read f; do
  basename=$(basename "$f")
  if ! echo "$basename" | grep -qE "$KEEP_PATTERN"; then
    rm "$f"
  fi
done

zip -r "$DIST" "$PLUGIN_NAME" \
  --exclude "$PLUGIN_NAME/.git*" \
  --exclude "$PLUGIN_NAME/build.sh" \
  --exclude "$PLUGIN_NAME/composer.lock" \
  --exclude "*.DS_Store"

echo "→ Restoring pruned fonts..."
git -C "$PLUGIN_DIR" restore vendor/mpdf/mpdf/ttfonts/ 2>/dev/null || true

echo "✓ Done: $DIST"
