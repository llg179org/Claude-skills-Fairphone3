#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# SD-card debug-log workflow: when the phone writes its boot/debug log to its SD card,
# the (vfat) "dirty bit" makes it mount elsewhere badly or not at all. This umounts + fscks.
# Two modes:
#   phone  : the phone's SD (in TWRP, e.g. mmcblk1p1) — umount + fsck ON THE PHONE
#   host   : the SD in the host's card reader (e.g. /dev/sdX1) — umount + fsck ON THE HOST
# usage: sd-fsck.sh phone [mmcblk1p1] | host /dev/sdX1
set -uo pipefail
source "$(dirname "$0")/fp3-env.sh"
mode=${1:?phone|host}
case "$mode" in
  phone)
    dev=${2:-mmcblk1p1}
    have_recovery || { echo "TWRP required for this."; exit 1; }
    log "phone SD fsck: /dev/block/$dev"
    adbr shell "umount /dev/block/$dev 2>/dev/null; umount /external_sd 2>/dev/null; \
                busybox fsck -y /dev/block/$dev 2>&1 || fsck.fat -a -w /dev/block/$dev 2>&1; sync; echo FSCK_DONE"
    ;;
  host)
    dev=${2:?/dev/sdX1 required}
    log "host SD fsck: $dev (clearing dirty bit)"
    sudo umount "$dev" 2>/dev/null || true
    sudo fsck.fat -a -w "$dev" 2>&1 || sudo fsck -y "$dev" 2>&1 || true
    sync; echo FSCK_DONE
    ;;
  *) echo "usage: $0 phone [mmcblk1p1] | host /dev/sdX1"; exit 2;;
esac
