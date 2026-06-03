#!/usr/bin/env bash
# Build an installable plugin zip from this folder.
#
# Produces: <out>/adf-festival-plugin-<version>.zip
#
# The repo app folder is `dev/adf-festival/` (matches docs/), but the WordPress
# plugin slug is `adf-festival-plugin` (its main file / what WP installs and what
# the self-updater expects). The zip's top-level folder is therefore the slug.
#
# IMPORTANT: this plugin depends on the Stripe PHP SDK via Composer, so the
# release Action runs `composer install --no-dev` first and this script bundles
# the resulting `vendor/` into the zip — sites updating via the self-updater do
# NOT run Composer themselves.
#
# Usage: bin/build-zip.sh [output_dir]
set -euo pipefail

PLUGIN_SLUG="adf-festival-plugin"
MAIN_FILE="adf-festival-plugin.php"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$SRC_DIR/../../releases}"

VERSION="$(grep -m1 -E '^\s*\*\s*Version:' "$SRC_DIR/$MAIN_FILE" | sed -E 's/.*Version:\s*//' | tr -d '[:space:]')"
if [[ -z "$VERSION" ]]; then
	echo "Could not read Version from plugin header" >&2
	exit 1
fi

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
ZIP_PATH="$OUT_DIR/$PLUGIN_SLUG-$VERSION.zip"
rm -f "$ZIP_PATH"

# Stage into a correctly-named folder, then drop dev-only files (keep vendor/).
STAGE="$(mktemp -d)"
DEST="$STAGE/$PLUGIN_SLUG"
mkdir -p "$DEST"
cp -R "$SRC_DIR/." "$DEST/"
rm -rf "$DEST/bin" "$DEST/tests" "$DEST/node_modules"
find "$DEST" -name '.git*' -prune -exec rm -rf {} + 2>/dev/null || true
find "$DEST" -name '*.zip' -delete 2>/dev/null || true
find "$DEST" -name '.DS_Store' -delete 2>/dev/null || true

( cd "$STAGE" && zip -rq "$ZIP_PATH" "$PLUGIN_SLUG" )
rm -rf "$STAGE"

echo "Built: $ZIP_PATH"
