#!/bin/sh
# Fallback master: measure, apply gain, limit, mux, then verify on the encoded file and
# correct until the film is at -14 LUFS with a true peak at or under -1 dBTP.
#
# The library's core/render/mux.sh needs ffmpeg 7+ and refuses older builds, because 6.x
# under-reports audio length through loudnorm and mux.sh then reads the file as cut off.
# Here loudnorm is used only to MEASURE: the correction is a linear gain plus a look-ahead
# limiter, which returns every sample it was given, so the tail of the film survives.
# On a machine with ffmpeg 7+, build.sh calls mux.sh instead and this script is not used.
#
#   sh master.sh video.mp4 mix.wav out.mp4 [fps=24]
set -e
LC_ALL=C; export LC_ALL
V="$1"; A="$2"; O="$3"; FPS="${4:-24}"
[ -n "$V" ] && [ -n "$A" ] && [ -n "$O" ] || { echo "usage: sh master.sh video.mp4 mix.wav out.mp4 [fps]"; exit 1; }
[ -f "$V" ] || { echo "master.sh: video not found: $V"; exit 1; }
[ -f "$A" ] || { echo "master.sh: audio not found: $A"; exit 1; }

TMP="${O}.tmp.mp4"
rm -f "$TMP"

echo "master.sh: measuring the mix"
J=$(ffmpeg -hide_banner -nostats -i "$A" -af loudnorm=I=-14:TP=-1.2:LRA=11:print_format=json -f null - 2>&1)
get() { echo "$J" | tr -d ' \t",' | sed -n "s/^$1:\(.*\)$/\1/p" | tail -1; }
MI=$(get input_i)
[ -n "$MI" ] || { echo "master.sh: could not measure the audio"; exit 1; }
echo "master.sh: mix measures $MI LUFS"

GAIN=$(awk -v i="$MI" 'BEGIN { g = -14.0 - i; if (g > 18) g = 18; printf "%.2f", g }')
CEIL=0.76                       # -2.4 dBFS, leaving room for the peaks AAC adds

i=1
while [ $i -le 4 ]; do
  echo "master.sh: pass $i — gain ${GAIN} dB, ceiling ${CEIL}"
  ffmpeg -hide_banner -nostats -loglevel error -y \
    -r "$FPS" -i "$V" -i "$A" \
    -map 0:v:0 -map 1:a:0 -c:v copy \
    -af "volume=${GAIN}dB,alimiter=limit=${CEIL}:attack=5:release=60:level=disabled,aresample=48000" \
    -c:a aac -b:a 320k -movflags +faststart -shortest "$TMP"
  [ -s "$TMP" ] || { echo "master.sh: nothing was written"; rm -f "$TMP"; exit 1; }

  R=$(ffmpeg -hide_banner -nostats -i "$TMP" -af ebur128=peak=true -f null - 2>&1 | tail -20)
  OI=$(echo "$R" | sed -n 's/.*I: *\(-\{0,1\}[0-9.]*\) LUFS.*/\1/p' | tail -1)
  OTP=$(echo "$R" | sed -n 's/.*Peak: *\(-\{0,1\}[0-9.]*\) dBFS.*/\1/p' | tail -1)
  echo "master.sh: encoded at $OI LUFS, true peak $OTP dBFS"

  OK=$(awk -v l="$OI" -v p="$OTP" 'BEGIN { print (l > -14.6 && l < -13.4 && p <= -1.0) ? 1 : 0 }')
  [ "$OK" = 1 ] && break
  GAIN=$(awk -v g="$GAIN" -v l="$OI" 'BEGIN { printf "%.2f", g + (-14.0 - l) }')
  CEIL=$(awk -v c="$CEIL" -v p="$OTP" 'BEGIN { if (p > -1.0) c = c * (10 ^ ((-1.4 - p) / 20)); printf "%.3f", c }')
  i=$((i + 1))
done

mv "$TMP" "$O"
echo "master.sh: $O  ($OI LUFS, true peak $OTP dBFS)"
