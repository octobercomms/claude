#!/bin/sh
# One command: picture, sound events, score and foley, master.
#   sh build.sh
# Set LIB to the Lemo-Opuscar library if it is not at ~/lemo-opuscar
# (the path `sh <skill>/scripts/setup.sh` prints on its last line).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=${LIB:-$HOME/lemo-opuscar}
export LIB
[ -f "$LIB/core/render/video.mjs" ] || { echo "set LIB to the Lemo-Opuscar library folder"; exit 1; }
mkdir -p "$HERE/out"
cd "$LIB"

node core/render/events.mjs "$HERE"
node core/render/readcheck.mjs "$HERE"
node core/render/video.mjs "$HERE" --fps 24 --workers 4 --out "$HERE/out/video.mp4"
"$LIB/.venv/bin/python" "$HERE/mix.py"

# This style takes no grain (flat vector surfaces), so the master adds none.
FFV=$(ffmpeg -version 2>/dev/null | sed -n '1s/^ffmpeg version n\{0,1\}\([0-9][0-9]*\)\..*/\1/p')
if [ -n "$FFV" ] && [ "$FFV" -ge 7 ]; then
  sh core/render/mux.sh "$HERE/out/video.mp4" "$HERE/out/mix.wav" "$HERE/a-festival-convenes.mp4" 24 0
else
  echo "build.sh: ffmpeg $FFV found; mux.sh needs 7+. Using the local two-pass master instead."
  sh "$HERE/master.sh" "$HERE/out/video.mp4" "$HERE/out/mix.wav" "$HERE/a-festival-convenes.mp4" 24
fi

node core/render/still.mjs "$HERE" 7.4 --out "$HERE" --prefix poster_
mv "$HERE/poster_7.4.jpg" "$HERE/poster.jpg" 2>/dev/null || true
echo "build.sh: $HERE/a-festival-convenes.mp4"
