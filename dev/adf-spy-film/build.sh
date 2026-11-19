#!/bin/sh
# One command: voice, picture, score, master, subtitles.
#   sh build.sh
# Set LIB to the Lemo-Opuscar library if it is not at ~/lemo-opuscar.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=${LIB:-$HOME/lemo-opuscar}
export LIB
[ -f "$LIB/core/render/video.mjs" ] || { echo "set LIB to the Lemo-Opuscar library folder"; exit 1; }
mkdir -p "$HERE/out"
cd "$LIB"

[ -f "$HERE/voices/dur.json" ] || "$LIB/.venv/bin/python" core/tts/tts.py "$HERE/lines.json" "$HERE/voices"
"$LIB/.venv/bin/python" core/tts/asr_check.py "$HERE/lines.json" "$HERE/voices" --lang en || \
  echo "build.sh: speech check could not run (model unreachable); the subtitles carry the wording"

node core/render/events.mjs "$HERE"
node core/render/readcheck.mjs "$HERE" --step 0.08
python3 -I "$HERE/tools_cues.py"
"$LIB/.venv/bin/python" core/render/srt.py "$HERE/cues.json" "$HERE/the-quarter.srt"

node core/render/video.mjs "$HERE" --fps 24 --workers 4 --out "$HERE/out/video.mp4"
"$LIB/.venv/bin/python" "$HERE/mix.py"

# Flat inks plus film grain: the style asks for a little grain in the mux, and a higher CRF
# looks the same while keeping the file sane.
FFV=$(ffmpeg -version 2>/dev/null | sed -n '1s/^ffmpeg version n\{0,1\}\([0-9][0-9]*\)\..*/\1/p')
if [ -n "$FFV" ] && [ "$FFV" -ge 7 ]; then
  sh core/render/mux.sh "$HERE/out/video.mp4" "$HERE/out/mix.wav" "$HERE/the-quarter.mp4" 24 6
else
  echo "build.sh: ffmpeg $FFV found; mux.sh needs 7+. Using the local two-pass master instead."
  sh "$HERE/master.sh" "$HERE/out/video.mp4" "$HERE/out/mix.wav" "$HERE/the-quarter.mp4" 24
fi

node core/render/still.mjs "$HERE" 67.5 --out "$HERE" --prefix poster_
mv "$HERE/poster_67.5.jpg" "$HERE/poster.jpg" 2>/dev/null || true
echo "build.sh: $HERE/the-quarter.mp4"
