#!/bin/sh
# One lossy generation, and only one. The 1-bit picture goes PNG -> FFV1 lossless master -> a single
# H.264 encode tuned for flat two-ink pictures. core/render/video.mjs (JPEG -> x264) plus mux.sh
# (x264 again) is three generations, and each one smears dot edges into grey.
#   sh encode.sh master.mkv mix.wav out.mp4 [fps=30]
set -e
LC_ALL=C; export LC_ALL
V="$1"; A="$2"; O="$3"; FPS="${4:-30}"
[ -f "$V" ] && [ -f "$A" ] || { echo "usage: sh encode.sh master.mkv mix.wav out.mp4 [fps]"; exit 1; }
TMP="${O}.tmp.mp4"

echo "encode.sh: measuring the mix"
J=$(ffmpeg -hide_banner -nostats -i "$A" -af loudnorm=I=-14:TP=-1.2:LRA=11:print_format=json -f null - 2>&1)
MI=$(echo "$J" | tr -d ' \t",' | sed -n 's/^input_i:\(.*\)$/\1/p' | tail -1)
[ -n "$MI" ] || { echo "encode.sh: could not measure the audio"; exit 1; }
GAIN=$(awk -v i="$MI" 'BEGIN { printf "%.2f", -14.0 - i }')
CEIL=0.74
i=1
while [ $i -le 4 ]; do
  echo "encode.sh: pass $i — gain ${GAIN} dB, ceiling ${CEIL}"
  ffmpeg -hide_banner -nostats -loglevel error -y -r "$FPS" -i "$V" -i "$A" \
    -map 0:v:0 -map 1:a:0 \
    -c:v libx264 -crf 14 -preset slow -tune animation -pix_fmt yuv420p -x264-params "aq-mode=0" \
    -af "volume=${GAIN}dB,alimiter=limit=${CEIL}:attack=5:release=60:level=disabled,aresample=48000" \
    -c:a aac -b:a 320k -movflags +faststart -shortest "$TMP"
  R=$(ffmpeg -hide_banner -nostats -i "$TMP" -af ebur128=peak=true -f null - 2>&1 | tail -20)
  OI=$(echo "$R" | sed -n 's/.*I: *\(-\{0,1\}[0-9.]*\) LUFS.*/\1/p' | tail -1)
  OTP=$(echo "$R" | sed -n 's/.*Peak: *\(-\{0,1\}[0-9.]*\) dBFS.*/\1/p' | tail -1)
  echo "encode.sh: encoded at $OI LUFS, true peak $OTP dBFS"
  OK=$(awk -v l="$OI" -v p="$OTP" 'BEGIN { print (l > -14.6 && l < -13.4 && p <= -1.0) ? 1 : 0 }')
  [ "$OK" = 1 ] && break
  GAIN=$(awk -v g="$GAIN" -v l="$OI" 'BEGIN { printf "%.2f", g + (-14.0 - l) }')
  CEIL=$(awk -v c="$CEIL" -v p="$OTP" 'BEGIN { if (p > -1.0) c = c * (10 ^ ((-1.4 - p) / 20)); printf "%.3f", c }')
  i=$((i + 1))
done
mv "$TMP" "$O"
echo "encode.sh: $O  ($OI LUFS, true peak $OTP dBFS)"
