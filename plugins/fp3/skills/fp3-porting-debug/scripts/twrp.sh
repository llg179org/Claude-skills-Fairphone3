#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# TWRP start. Since `fastboot boot twrp.img` FAILED on the FP3 aboot ('unknown reason'),
# there are two reliable ways:
#   1) flash to the boot_b slot + set_active b + reboot  (lk2nd can stay on boot_a!)  -> twrp.sh flash-b
#   2) flash to boot_a (overwrites lk2nd) + reboot                                -> twrp.sh flash-a
# Switching back to pmOS: slot.sh set a  (if lk2nd is on boot_a).
set -uo pipefail
source "$(dirname "$0")/fp3-env.sh"
cmd=${1:-help}
[ -f "$TWRP_IMG" ] || { echo "no TWRP image: $TWRP_IMG"; exit 1; }
case "$cmd" in
  flash-b)
    have_fastboot || { echo "fastboot mode required"; exit 1; }
    log "flash twrp -> boot_b ; set_active b ; reboot"
    fb flash boot_b "$TWRP_IMG" 2>&1 | tail -3
    fb set_active b 2>&1 | tail -1
    fb reboot 2>&1 | tail -1
    ;;
  flash-a)
    have_fastboot || { echo "fastboot mode required"; exit 1; }
    log "flash twrp -> boot_a (OVERWRITES lk2nd) ; reboot"
    fb flash boot_a "$TWRP_IMG" 2>&1 | tail -3
    fb reboot 2>&1 | tail -1
    ;;
  *) echo "usage: $0 flash-b | flash-a   (boot_b recommended: keeps lk2nd on boot_a)";;
esac
