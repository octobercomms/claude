#!/bin/sh
# Render the evidence frames from the two client decks.
#   sh tools_pages.sh <direction-deck.pdf> <bernard-deck.pdf>
# Writes raw/*.png beside this script. The PDFs are the client's and are not in the repo.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
A="$1"; B="$2"
[ -f "$A" ] && [ -f "$B" ] || { echo "usage: sh tools_pages.sh <ADF-2027-Direction.pdf> <ADF-Bernard-Six.pdf>"; exit 1; }
mkdir -p "$HERE/raw"
cd "$HERE/raw"
pdftoppm -png -r 150 -f 1  -l 1  "$B" b1
pdftoppm -png -r 150 -f 2  -l 2  "$B" b2
pdftoppm -png -r 150 -f 6  -l 6  "$B" b6
pdftoppm -png -r 150 -f 4  -l 4  "$A" a4
pdftoppm -png -r 150 -f 5  -l 5  "$A" a5
pdftoppm -png -r 150 -f 18 -l 18 "$A" a18
echo "tools_pages.sh: wrote $HERE/raw"
