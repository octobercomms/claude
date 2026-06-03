#!/bin/bash
# LOLO Deck — double-click to build a presentation PDF from a folder of
# character subfolders. Keep this file in the SAME folder as generate_deck.py.
#
# First time only: right-click this file -> Open (to get past macOS security),
# and if it won't run, open Terminal and paste:  chmod +x "<drag this file in>"

DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$DIR/generate_deck.py"

clear
echo "============================================"
echo "   LOLO  Costume Character Deck Generator"
echo "============================================"
echo

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is not installed."
  echo "Download it from https://www.python.org/downloads/ , install it,"
  echo "then run this again."
  echo
  read -n 1 -s -r -p "Press any key to close. "
  exit 1
fi

if [ ! -f "$SCRIPT" ]; then
  echo "Couldn't find generate_deck.py next to this file."
  echo "Put generate_deck.py in this same folder:"
  echo "   $DIR"
  echo
  read -n 1 -s -r -p "Press any key to close. "
  exit 1
fi

# Install libraries on first run only
python3 -c "import reportlab, PIL" 2>/dev/null || {
  echo "First-time setup: installing reportlab + Pillow ..."
  python3 -m pip install --quiet --user reportlab Pillow
  echo
}

echo "Drag your character folder (e.g. 'Hollywood') into this window,"
echo "then press Return:"
echo
printf "Folder: "
read -r FOLDER

# Tidy up the dragged-in path: strip surrounding quotes and outer whitespace
FOLDER="${FOLDER%\"}"; FOLDER="${FOLDER#\"}"
FOLDER="${FOLDER%\'}"; FOLDER="${FOLDER#\'}"
FOLDER="$(printf '%s' "$FOLDER" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

if [ ! -d "$FOLDER" ]; then
  echo
  echo "That doesn't look like a folder:"
  echo "   $FOLDER"
  echo
  read -n 1 -s -r -p "Press any key to close. "
  exit 1
fi

TITLE="$(basename "$FOLDER")"
OUT="$HOME/Desktop/$TITLE.pdf"

echo
echo "Building \"$TITLE\" ..."
echo
python3 "$SCRIPT" "$FOLDER" --title "$TITLE" --reference-first -o "$OUT"

echo
echo "Done!  Saved to: $OUT"
open "$OUT"
echo
read -n 1 -s -r -p "Press any key to close. "
