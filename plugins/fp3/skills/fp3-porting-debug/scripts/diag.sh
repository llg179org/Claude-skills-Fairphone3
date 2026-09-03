#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Non-destructive diagnostics from TWRP (does NOT consume a retry).
# - is boot_a really lk2nd?  - last-boot kernel log (pstore/ramoops)
# - userdata valid ext4 + /boot?  - vbmeta state
# usage: diag.sh   (run in TWRP/recovery)
set -uo pipefail
source "$(dirname "$0")/fp3-env.sh"
have_recovery || { echo "TWRP/recovery required. (twrp.sh flash-b)"; exit 1; }
echo "=== boot_a contents (lk2nd or twrp or android?) ==="
adbr shell "dd if=$P_BOOT_A bs=64k count=24 2>/dev/null | strings | grep -iE 'lk2nd|TWRP|teamwin|Linux version|ANDROID' | sort -u | head"
echo "=== boot_b contents ==="
adbr shell "dd if=$P_BOOT_B bs=64k count=24 2>/dev/null | strings | grep -iE 'lk2nd|TWRP|teamwin|Linux version|ANDROID' | sort -u | head"
echo "=== pstore / last-boot kernel ramoops ==="
adbr shell "ls -la /sys/fs/pstore/ 2>/dev/null; echo '---'; cat /sys/fs/pstore/console-ramoops-0 2>/dev/null | tail -40"
echo "=== userdata fs type + /boot ==="
adbr shell "blkid $P_USERDATA 2>/dev/null; mkdir -p /tmp/ud; mount -t ext4 $P_USERDATA /tmp/ud 2>&1 && (echo MOUNT_OK; ls /tmp/ud; echo '--- /boot ---'; ls /tmp/ud/boot 2>/dev/null | head; umount /tmp/ud) || echo MOUNT_FAIL"
echo "=== vbmeta header (AVB) ==="
adbr shell "dd if=$P_VBMETA bs=256 count=1 2>/dev/null | strings | head -3"
