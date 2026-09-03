#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# TWRP/recovery → back to postmarketOS.  `set_active b` → lk2nd (boot_b) → pmOS.
# (pmOS qbootctl-openrc mark_boot_successful → slot b retry-count is restored.)
#
# Current dual-slot layout (VERIFIED by reading the partitions, 2026-07-28):
#   boot_a = Ubuntu Touch Halium boot image   -> `slot.sh set a` boots UT
#   boot_b = lk2nd                            -> `slot.sh set b` boots pmOS
# Switching OS needs NO flashing; see
#   https://github.com/llg179org/Claude-skills-Fairphone3#installing-the-two-oses
#   ("Both at once: the dual-slot setup" — the one-time `setup-dualslot.sh`).
# This wrapper only adds the "get out of TWRP first" step around that.
#
# ⚠️ FIXED 2026-07-28: this script used to `set_active a`, which was correct in the
#    pre-dual-slot layout (pmOS on slot a) but on the current device boots UT.
#
# usage: to-pmos.sh       (from TWRP/recovery or from fastboot)
set -uo pipefail
source "$(dirname "$0")/fp3-env.sh"

# If pmOS is already running, nothing to do
if ping -c1 -W2 "$FP3_SSH_IP" >/dev/null 2>&1; then
  echo "pmOS already running (ping OK)."; exit 0
fi

# TWRP/recovery → bootloader
if have_recovery; then
  log "to-pmos: TWRP → reboot bootloader (adb)"
  adbr reboot bootloader 2>&1 | tail -1
fi

if ! have_fastboot; then
  echo "waiting for fastboot (max 60s)…"
  wait_state fastboot 60 || { echo "fastboot did NOT appear. Manually: bootloader mode."; exit 1; }
fi

log "to-pmos: set_active b ; reboot"
fb set_active b 2>&1 | tail -1
fb reboot       2>&1 | tail -1
echo
echo "✅ lk2nd(boot_b) → pmOS starting. (~60-90s, USB-net $FP3_DEV_IP)"
echo "   Note: in pmOS the battery does NOT charge (no mainline charger driver)."
