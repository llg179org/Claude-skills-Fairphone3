#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Writing an image to a partition via TWRP adb (because `fastboot boot` is disabled/unreliable on the FP3 aboot).
# Writes a sparse Android image with simg2img; a raw image with dd.
# usage: twrp-dd.sh <local.img> <by-name-part|/dev/block/...> [raw|sparse]
#   e.g.: twrp-dd.sh twrp-fp3.img boot_b raw
#       twrp-dd.sh sailfish.img001 userdata sparse
set -uo pipefail
source "$(dirname "$0")/fp3-env.sh"
IMG=${1:?local image required}; PART=${2:?partition required (e.g. boot_b or userdata)}; MODE=${3:-raw}
have_recovery || { echo "Not in TWRP/recovery. Run twrp.sh boot first."; exit 1; }
[ -f "$IMG" ] || { echo "no such file: $IMG"; exit 1; }
case "$PART" in /dev/*) DST=$PART;; *) DST=/dev/block/bootdevice/by-name/$PART;; esac
B=/tmp/$(basename "$IMG")
log "push $IMG -> phone:$B"
adbr push "$IMG" "$B"
if [ "$MODE" = sparse ]; then
  log "simg2img $B -> $DST"
  adbr shell "simg2img $B $DST && sync && echo WROTE_SPARSE_OK"
else
  log "dd $B -> $DST"
  adbr shell "dd if=$B of=$DST bs=4096 && sync && echo WROTE_RAW_OK"
fi
adbr shell "rm -f $B"
