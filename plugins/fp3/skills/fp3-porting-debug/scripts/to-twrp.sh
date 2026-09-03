#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# IDLE → CHARGING IN TWRP.  The mainline pmOS kernel has NO FP3/PMI632 charger+fuelgauge
# driver (only qcom,pmi632-typec is visible, CURRENT_NOW=0) → in pmOS the battery does NOT charge.
# The downstream TWRP (4.9 kernel, qpnp-smb5+qpnp-qg) charges properly. So: when you are
# not using the phone, switch to TWRP with this (boot_b), where it charges.
#
# Mechanism: TWRP onto boot_b (boot_a/lk2nd/pmOS UNTOUCHED) + set_active b + reboot.
# Back to pmOS:  ./to-pmos.sh
#
# usage: to-twrp.sh        (can be started from pmOS or from fastboot)
set -uo pipefail
source "$(dirname "$0")/fp3-env.sh"
[ -f "$TWRP_IMG" ] || { echo "no TWRP image: $TWRP_IMG"; exit 1; }

ssh_pmos(){ sshpass -p "$FP3_PW" ssh -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null -o ConnectTimeout=6 "fp3@$FP3_SSH_IP" "$@" 2>/dev/null; }

# 1+2) Getting into fastboot — pmOS→fastboot is FLAKY (lk2nd sometimes boots back into pmOS), so
#       MULTIPLE ATTEMPTS: reboot bootloader → wait 90s for fastboot; if pmOS came back, retry.
get_fastboot(){
  local attempt
  for attempt in 1 2 3 4; do
    have_fastboot && return 0
    if ping -c1 -W2 "$FP3_SSH_IP" >/dev/null 2>&1; then
      log "to-twrp: pmOS running → reboot bootloader (SSH, attempt $attempt)"
      ssh_pmos "echo $FP3_PW | sudo -S reboot bootloader" || true
    elif have_recovery; then
      log "to-twrp: TWRP/recovery → reboot bootloader (adb, attempt $attempt)"
      adbr reboot bootloader 2>&1 | tail -1
    fi
    # 90s window for fastboot (lk2nd fastboot is fine too)
    wait_state fastboot 90 && return 0
    log "to-twrp: attempt $attempt did not reach fastboot; if pmOS came back, retrying"
    # if pmOS booted back, wait until it is reachable for the next SSH reboot
    local i; for i in $(seq 1 30); do ping -c1 -W2 "$FP3_SSH_IP" >/dev/null 2>&1 && break; sleep 2; done
  done
  return 1
}
if ! get_fastboot; then
  echo "Could NOT reach fastboot in 4 attempts. Manually: bootloader mode, then run again."
  exit 1
fi

# 3) TWRP → boot_b (freshly flashed, the slot becomes bootable), activate, reboot
log "to-twrp: flash TWRP→boot_b ; set_active b ; reboot"
fb flash boot_b "$TWRP_IMG" 2>&1 | tail -3
fb set_active b   2>&1 | tail -1
fb reboot         2>&1 | tail -1
echo
echo "✅ TWRP starting from boot_b → the battery CHARGES there (downstream charger)."
echo "   Back to pmOS:  ./to-pmos.sh   (or: in fastboot set_active a + reboot)"
