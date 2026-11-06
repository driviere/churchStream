#!/usr/bin/env bash
# Stream picture quality benchmark: ChurchStream's encoder settings (before / now) against
# OBS Studio's x264 settings, on the same footage at the same bitrate.
#
# Quality is measured with VMAF (Netflix's perceptual score, 0–100; ~93+ looks transparent
# on a TV, a 3–6 point difference is visible) and PSNR (dB). Speed = frames encoded per
# second on this machine (real time needs ≥ 30).
#
# Needs an FFmpeg with libx264 and libvmaf (e.g. a BtbN "gpl" build): FFMPEG=/path/to/ffmpeg.
# Writes results.md in the current directory. Runs on GitHub Actions (internet for the clips).
set -euo pipefail
FF="${FFMPEG:-ffmpeg}"
W="${WORK:-bench}"
mkdir -p "$W"
SECS=10
THREADS="$(nproc)"

log() { echo "▸ $*" >&2; }

# ---------- reference footage (lossless, 30 fps, 10 s) ----------
XIPH=https://media.xiph.org/video/derf/y4m
ref() { # name url size   (QUICK=1: synthetic footage instead, for checking the script)
  local out="$W/ref-$1.mkv"
  [ -s "$out" ] && return
  if [ -n "${QUICK:-}" ]; then
    "$FF" -hide_banner -loglevel error -y -f lavfi -i "testsrc2=s=${3/:/x}:r=30:d=$SECS" -vf format=yuv420p -c:v ffv1 "$out"; return
  fi
  local src="$W/src-$(basename "$2")"
  [ -s "$src" ] || { log "downloading $2"; curl -sSfL --retry 3 -o "$src" "$2"; }
  log "reference $1 ($3)"
  "$FF" -hide_banner -loglevel error -y -i "$src" -vf "fps=30,scale=$3:flags=lanczos,format=yuv420p" -t "$SECS" -c:v ffv1 "$out"
}
ref crowd-720  "$XIPH/crowd_run_1080p50.y4m" 1280:720
ref crowd-1080 "$XIPH/crowd_run_1080p50.y4m" 1920:1080
ref town-720   "$XIPH/old_town_cross_420_720p50.y4m" 1280:720

# A projected-lyrics clip: white text on a dark gradient, with a slide change after 5 s.
FONT="$(fc-match -f '%{file}' 'DejaVu Sans:bold' 2>/dev/null || true)"
lyric() { # name size
  local out="$W/ref-$1.mkv" size="$2"
  [ -s "$out" ] && return
  log "reference $1 (projected lyrics, $size)"
  local fs=$(( ${size#*x} * 7 / 100 ))
  "$FF" -hide_banner -loglevel error -y -f lavfi -i "gradients=s=$size:c0=0x1b2440:c1=0x05070c:x0=0:y0=0:x1=0:y1=${size#*x}:d=$SECS:r=30" \
    -vf "drawtext=fontfile=$FONT:fontsize=$fs:fontcolor=white:line_spacing=$(( fs / 4 )):x=(w-tw)/2:y=(h-th)/2:text='Holy, holy, holy! Lord God Almighty!
Early in the morning our song shall rise to Thee':enable='lt(t,5)',drawtext=fontfile=$FONT:fontsize=$fs:fontcolor=white:line_spacing=$(( fs / 4 )):x=(w-tw)/2:y=(h-th)/2:text='Holy, holy, holy! All the saints adore Thee,
Casting down their golden crowns around the glassy sea':enable='gte(t,5)',format=yuv420p" \
    -c:v ffv1 "$out"
}
lyric lyrics-720 1280x720
lyric lyrics-1080 1920x1080

# ---------- encoder settings at the same bitrate ----------
# $1 = setting, $2 = kbps, $3 = fps
settings() {
  local b="$2k" buf="$(( $2 * 2 ))k" gop="$(( $3 * 2 ))"
  case "$1" in
    before) echo "-c:v libx264 -preset veryfast -tune zerolatency -b:v $b -maxrate $b -bufsize $buf -g $gop -keyint_min $gop -sc_threshold 0 -profile:v main" ;;
    now)    echo "-c:v libx264 -preset veryfast -b:v $b -maxrate $b -bufsize $buf -g $gop -bf 2 -keyint_min $gop -sc_threshold 0 -profile:v high" ;;
    obs)    echo "-c:v libx264 -preset veryfast -b:v $b -maxrate $b -bufsize $b -g $gop" ;;           # OBS x264 defaults: CBR, veryfast, 2 s keyframes
    obs-medium) echo "-c:v libx264 -preset medium -b:v $b -maxrate $b -bufsize $b -g $gop" ;;      # OBS with the "medium" preset (more CPU)
  esac
}
LABEL_before="ChurchStream before (veryfast, zero-latency)"
LABEL_now="**ChurchStream now** (veryfast, B-frames)"
LABEL_obs="OBS default (x264 veryfast, CBR)"
LABEL_obsmedium="OBS, x264 \"medium\" preset"

HAS_VMAF=$("$FF" -hide_banner -filters 2>/dev/null | grep -c ' libvmaf ' || true)
vmaf() { # distorted reference → "vmaf_mean vmaf_min psnr"
  local js="$1.vmaf.json"
  if [ "$HAS_VMAF" = 0 ]; then # no libvmaf: PSNR only
    local p; p=$("$FF" -hide_banner -i "$1" -i "$2" -lavfi "[0:v]setpts=PTS-STARTPTS[d];[1:v]setpts=PTS-STARTPTS[r];[d][r]psnr" -f null - 2>&1 | sed -n 's/.* y:\([0-9.]*\).*/\1/p' | tail -1)
    printf "n/a n/a %.1f\n" "${p:-0}"; return
  fi
  "$FF" -hide_banner -loglevel error -i "$1" -i "$2" -lavfi \
    "[0:v]setpts=PTS-STARTPTS[d];[1:v]setpts=PTS-STARTPTS[r];[d][r]libvmaf=log_fmt=json:log_path=$js:n_threads=$THREADS:feature=name=psnr" -f null -
  python3 - "$js" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))["pooled_metrics"]
print(f'{d["vmaf"]["mean"]:.1f} {d["vmaf"]["min"]:.1f} {d["psnr_y"]["mean"]:.1f}')
PY
}

encode() { # ref setting kbps → prints "vmaf_mean vmaf_min psnr fps"
  local refv="$W/ref-$1.mkv" out="$W/$1-$2.mp4"
  local t0 t1 frames
  t0=$(date +%s.%N)
  # shellcheck disable=SC2046
  "$FF" -hide_banner -loglevel error -y -i "$refv" $(settings "$2" "$3" 30) -an "$out"
  t1=$(date +%s.%N)
  frames=$(( SECS * 30 ))
  local fps; fps=$(python3 -c "print(f'{$frames/($t1-$t0):.0f}')")
  echo "$(vmaf "$out" "$refv") $fps"
}

{
  echo "## Stream picture quality: ChurchStream vs OBS Studio (x264)"
  echo
  echo "Same footage, same bitrate, same keyframe interval; software x264 on a GitHub machine with $THREADS CPU threads."
  echo "VMAF 0–100 (higher is better; a 3–6 point gap is visible). Speed in frames per second (real time = 30)."
  echo "FFmpeg: $("$FF" -hide_banner -version | head -1)"
  echo
  for spec in "crowd-720:2500:People moving (crowd_run), 720p @ 2.5 Mbps" "town-720:2500:Camera pan (old_town_cross), 720p @ 2.5 Mbps" \
              "lyrics-720:2500:Projected lyrics, 720p @ 2.5 Mbps" "crowd-1080:4500:People moving, 1080p @ 4.5 Mbps" "lyrics-1080:4500:Projected lyrics, 1080p @ 4.5 Mbps"; do
    IFS=: read -r clip kbps title <<< "$spec"
    log "$title"
    echo "### $title"
    echo
    echo "| Settings | VMAF (mean) | VMAF (worst frame) | PSNR (dB) | Speed (fps) |"
    echo "| --- | --- | --- | --- | --- |"
    for s in before now obs obs-medium; do
      read -r vm vmin ps fps <<< "$(encode "$clip" "$s" "$kbps")"
      lab="LABEL_${s//-/}"
      echo "| ${!lab} | $vm | $vmin | $ps | $fps |"
    done
    echo
  done

  # The slide picture sent to FFmpeg: before = drawn at 1280×720, JPEG ~0.88, stretched to 1080p;
  # now = drawn at 1920×1080, JPEG ~0.94. Then both encoded at 1080p @ 4.5 Mbps.
  log "slide picture path at 1080p"
  R="$W/ref-lyrics-1080.mkv"
  "$FF" -hide_banner -loglevel error -y -i "$R" -vf "scale=1280:720:flags=bicubic" -c:v mjpeg -q:v 4 -f matroska "$W/jpg-old.mkv"
  "$FF" -hide_banner -loglevel error -y -i "$W/jpg-old.mkv" -vf "scale=1920:1080:flags=bicubic,format=yuv420p" $(settings now 4500 30) -an "$W/slide-old.mp4"
  "$FF" -hide_banner -loglevel error -y -i "$R" -c:v mjpeg -q:v 2 -f matroska "$W/jpg-new.mkv"
  "$FF" -hide_banner -loglevel error -y -i "$W/jpg-new.mkv" -vf "format=yuv420p" $(settings now 4500 30) -an "$W/slide-new.mp4"
  read -r o1 o2 o3 <<< "$(vmaf "$W/slide-old.mp4" "$R")"
  read -r n1 n2 n3 <<< "$(vmaf "$W/slide-new.mp4" "$R")"
  echo "### Slide text on a 1080p stream (the picture ChurchStream sends to FFmpeg)"
  echo
  echo "| Slide picture | VMAF (mean) | VMAF (worst frame) | PSNR (dB) |"
  echo "| --- | --- | --- | --- |"
  echo "| Before: drawn at 1280×720, JPEG ~0.88, stretched to 1080p | $o1 | $o2 | $o3 |"
  echo "| **Now: drawn at 1920×1080, JPEG ~0.94** | $n1 | $n2 | $n3 |"
  echo
  echo "_JPEG quality is approximated with FFmpeg's encoder (-q:v 4 ≈ 0.88, -q:v 2 ≈ 0.94); the browser's encoder differs slightly._"
  echo
  echo "_Hardware encoders (Intel Quick Sync, NVIDIA, AMD, Apple) aren't available on GitHub's machines, so they aren't measured here; ChurchStream gives them the matching quality-first settings._"
} | tee results.md
