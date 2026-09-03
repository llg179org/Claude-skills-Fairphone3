#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# fg-verify.sh — fuel-gauge (pmi632-battery) check in pmOS over SSH.
# Reads the battery-psy capacity/voltage/status fields and the charger-psy,
# so they can be compared with the SoC seen in TWRP.
# Usage: ./fg-verify.sh   (the phone must be running pmOS, USB-net up)
set -u
cd "$(dirname "$0")"; source ./fp3-env.sh

SSH(){ sshpass -p "$FP3_PW" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 \
        "fp3@$FP3_SSH_IP" "$@"; }

echo "=== SSH reachability ($FP3_SSH_IP) ==="
if ! SSH true 2>/dev/null; then
  echo "NO SSH — is the phone running pmOS? (from TWRP: ./to-pmos.sh)"; exit 1
fi

echo "=== power_supply nodes ==="
SSH 'ls /sys/class/power_supply/'

echo
echo "=== pmi632-battery (fuel-gauge) ==="
SSH 'for p in present status capacity voltage_now technology health; do
       f=/sys/class/power_supply/pmi632-battery/$p
       [ -e "$f" ] && printf "  %-12s = %s\n" "$p" "$(cat $f)"
     done'

echo
echo "=== pmi632-charger (reference) ==="
SSH 'for p in status current_now usb_type online; do
       f=/sys/class/power_supply/pmi632-charger/$p
       [ -e "$f" ] && printf "  %-12s = %s\n" "$p" "$(cat $f)"
     done'

echo
echo "=== dmesg charger/battery ==="
SSH 'echo '"$FP3_PW"' | sudo -S dmesg 2>/dev/null | grep -iE "smb|pmi632|charger|battery|ocv" | tail -15'
