#!/usr/bin/env bash
# Build an installable plugin zip from this folder.
#
# Produces: <out>/oct-bulk-editor-<version>.zip
#
# The zip's top-level folder is the WordPress plugin slug (oct-bulk-editor),
# which is what WordPress installs and what the self-updater expects.
#
# Usage: bin/build-zip.sh [output_dir]
set -euo pipefail

PLUGIN_SLUG="oct-bulk-editor"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$SRC_DIR/../../releases}"

# Read version from the plugin header.
VERSION="$(grep -m1 -E '^\s*\*\s*Version:' "$SRC_DIR/$PLUGIN_SLUG.php" | sed -E 's/.*Version:\s*//' | tr -d '[:space:]')"
if [[ -z "$VERSION" ]]; then
	echo "Could not read Version from plugin header" >&2
	exit 1
fi

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
ZIP_PATH="$OUT_DIR/$PLUGIN_SLUG-$VERSION.zip"
rm -f "$ZIP_PATH"

# Stage into a correctly-named folder, then drop dev-only files.
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
