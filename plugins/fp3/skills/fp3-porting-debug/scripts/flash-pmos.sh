#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# pmOS flash sequence (in fastboot mode). Includes the vbmeta-disable step,
# which is REQUIRED because of the hybris/AVB suspicion ("Fairphone powered by android -> fastboot" symptom).
# usage: flash-pmos.sh [full|lk2nd|vbmeta|rootfs]   (default: full)
#   full  = vbmeta(disable) + lk2nd + rootfs(userdata) + reboot
# lk2nd goes to the boot partition (PARTITION_KERNEL), rootfs to userdata; boot is NOT flashed SEPARATELY.
set -uo pipefail
source "$(dirname "$0")/fp3-env.sh"
step=${1:-full}
have_fastboot || { echo "fastboot mode required. (from TWRP: adbr reboot bootloader)"; exit 1; }
do_vbmeta(){ log "flash_vbmeta (AVB verify OFF)"; yes '' | $PMB flasher flash_vbmeta 2>&1 | tail -8; }
do_lk2nd(){  log "flash_lk2nd -> boot"; yes '' | $PMB flasher flash_lk2nd 2>&1 | tail -8; }
do_rootfs(){ log "flash_rootfs -> userdata"; yes '' | $PMB flasher flash_rootfs --partition userdata 2>&1 | tail -10; }
case "$step" in
  vbmeta) do_vbmeta;;
  lk2nd)  do_lk2nd;;
  rootfs) do_rootfs;;
  full)   do_vbmeta; do_lk2nd; do_rootfs; log "reboot"; fb reboot 2>&1|tail -1;;
  *) echo "usage: $0 [full|lk2nd|vbmeta|rootfs]"; exit 2;;
esac
