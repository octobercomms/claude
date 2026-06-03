# Paste this into an Automator "Run Shell Script" action.
# Settings:  Shell = /bin/bash   |   Pass input = "as arguments"
#
# It builds one PDF per folder dropped onto the app, saved to your Desktop,
# and opens it automatically. The cover title is the folder's name.

SCRIPT="$HOME/Documents/LOLO Deck/generate_deck.py"

# Make sure common Python locations are on PATH (Automator apps start with a bare PATH)
export PATH="/opt/homebrew/bin:/usr/local/bin:/Library/Frameworks/Python.framework/Versions/Current/bin:/usr/bin:/bin"
PY="$(command -v python3)"

if [ -z "$PY" ]; then
  osascript -e 'display alert "Python 3 not found" message "Install Python 3 from python.org, then try again."'
  exit 1
fi
if [ ! -f "$SCRIPT" ]; then
  osascript -e 'display alert "generate_deck.py not found" message "Put generate_deck.py in a folder called \"LOLO Deck\" inside your Documents folder."'
  exit 1
fi

# Install the two libraries on first run only
"$PY" -c "import reportlab, PIL" 2>/dev/null || "$PY" -m pip install --quiet --user reportlab Pillow

for f in "$@"; do
  [ -d "$f" ] || continue
  title="$(basename "$f")"
  out="$HOME/Desktop/$title.pdf"
  "$PY" "$SCRIPT" "$f" --title "$title" --reference-first -o "$out"
  open "$out"
done
