#!/bin/sh
# One command: events, reading check, lossless picture, score, one encode, poster.
#   LIB=~/lemo-opuscar sh build.sh
# Needs a GPU for a sensible render time; on software WebGL set LEMO_ANGLE=swiftshader (slower).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=${LIB:-$HOME/lemo-opuscar}
export LIB
[ -f "$LIB/core/render/page.mjs" ] || { echo "set LIB to the Lemo-Opuscar library folder"; exit 1; }
mkdir -p "$HERE/out"
cd "$LIB"

node core/render/events.mjs "$HERE"
node core/render/readcheck.mjs "$HERE" --step 0.1
node "$HERE/tools/render.mjs" "$HERE" --fps 30 --workers 4 --out "$HERE/out/master.mkv"
"$LIB/.venv/bin/python" "$HERE/mix.py"
sh "$HERE/encode.sh" "$HERE/out/master.mkv" "$HERE/out/mix.wav" "$HERE/the-desk.mp4" 30

node core/render/still.mjs "$HERE" 3.0 --out "$HERE" --prefix poster_
mv "$HERE/poster_3.0.jpg" "$HERE/poster.jpg" 2>/dev/null || true
echo "build.sh: $HERE/the-desk.mp4"
