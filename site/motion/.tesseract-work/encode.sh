#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tsrct_bin="${TESSERACT_BIN:-$HOME/Library/Application Support/Tesseract/bin/tsrct}"
"$tsrct_bin" preview --project Janitor.tsrct --time 3 --output Previews/Poster.png
"$tsrct_bin" filmstrip --project Janitor.tsrct --timestamps-ms 0,1500,3000,4500,6000,7500,9000,10500,11967 --tile-width 480 --tile-height 270 --items-per-row 3 --output Previews/Filmstrip.png
"$tsrct_bin" export --project Janitor.tsrct --output Janitor.mp4
mkdir -p ../public/media
cwebp -quiet -lossless Previews/Poster.png -o ../public/media/continuity-poster.webp
ffmpeg -hide_banner -loglevel error -y -i Janitor.mp4 -an -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -movflags +faststart ../public/media/continuity.mp4
ffmpeg -hide_banner -loglevel error -y -i Janitor.mp4 -an -c:v libvpx-vp9 -b:v 0 -crf 24 -row-mt 1 ../public/media/continuity.webm
